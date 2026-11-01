use rand::RngCore;
use serde::Deserialize;
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

#[derive(Deserialize)]
struct Ready {
    #[serde(rename = "type")]
    kind: String,
    url: String,
}

pub struct Sidecar {
    pub url: String,
    pub token: String,
    pub client: reqwest::Client,
    child: Mutex<Option<Child>>,
}

impl Sidecar {
    pub fn start(resources: &Path) -> Result<Self, String> {
        let backend = resources.join("backend");
        let node = backend.join("node.exe");
        let service = backend.join("desktop").join("service.mjs");
        if !node.is_file() || !service.is_file() {
            return Err(
                "The desktop data service is missing. Rebuild or reinstall toksight.".into(),
            );
        }
        let mut bytes = [0_u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let mut command = Command::new(node);
        command
            .arg(service)
            .current_dir(&backend)
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Cannot start the data service: {e}"))?;
        let errors = Arc::new(Mutex::new(VecDeque::<String>::new()));
        let error_tail = Arc::clone(&errors);
        let error_secret = token.clone();
        let stderr = child.stderr.take().ok_or("Missing data service stderr")?;
        thread::spawn(move || {
            // Bound retained diagnostics; always drain stderr so Node cannot stall.
            let mut reader = BufReader::new(stderr);
            loop {
                let mut chunk = vec![0; 4096];
                match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&chunk[..n])
                            .replace(&error_secret, "[redacted]");
                        if let Ok(mut tail) = error_tail.lock() {
                            tail.push_back(text);
                            while tail.len() > 4 {
                                tail.pop_front();
                            }
                        }
                    }
                }
            }
        });
        let stdout = child.stdout.take().ok_or("Missing data service stdout")?;
        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout)
                .take(16 * 1024)
                .read_line(&mut line)
                .map_err(|e| e.to_string())
                .and_then(|_| serde_json::from_str::<Ready>(&line).map_err(|e| e.to_string()));
            let _ = sender.send(result);
        });
        let mut handshake = serde_json::json!({
            "token": token,
            "offline": std::env::args().any(|arg| arg == "--offline")
        });
        for (name, key) in [
            ("TOKSIGHT_CONFIG_DIR", "configDir"),
            ("TOKSIGHT_DESKTOP_HOME", "home"),
        ] {
            if let Ok(value) = std::env::var(name) {
                // CLI treats an empty override as unset. Resolve relative paths
                // against the host's cwd before the child changes to backend/.
                if value.is_empty() {
                    continue;
                }
                let path = Path::new(&value);
                let absolute = if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    std::env::current_dir()
                        .map_err(|e| e.to_string())?
                        .join(path)
                };
                handshake[key] = serde_json::Value::String(absolute.to_string_lossy().into_owned());
            }
        }
        let started = (|| -> Result<String, String> {
            let input = child.stdin.as_mut().ok_or("Missing data service stdin")?;
            writeln!(input, "{handshake}").map_err(|e| e.to_string())?;
            let ready = receiver
                .recv_timeout(Duration::from_secs(90))
                .map_err(|_| "The data service did not start within 90 seconds".to_string())??;
            validate_ready(&ready.kind, &ready.url)?;
            Ok(ready.url)
        })();
        let url = match started {
            Ok(url) => url,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let diagnostics = errors
                    .lock()
                    .map(|tail| tail.iter().cloned().collect::<String>())
                    .unwrap_or_default();
                return Err(format!("{error}\n{diagnostics}").replace(&token, "[redacted]"));
            }
        };
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string());
        match client {
            Ok(client) => Ok(Self {
                url,
                token,
                client,
                child: Mutex::new(Some(child)),
            }),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(error)
            }
        }
    }

    pub fn stop(&self) {
        let Some(mut child) = self.child.lock().ok().and_then(|mut owned| owned.take()) else {
            return;
        };
        if let Some(mut input) = child.stdin.take() {
            let _ = writeln!(input, "{{\"type\":\"shutdown\"}}");
        }
        let deadline = Instant::now() + Duration::from_millis(5500);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Err(_) => break,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(30)),
                Ok(None) => break,
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        self.stop();
    }
}

fn validate_ready(kind: &str, value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid data service address")?;
    if kind != "ready"
        || url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Invalid data service address".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ready_must_be_a_private_loopback_origin() {
        assert!(validate_ready("ready", "http://127.0.0.1:4729").is_ok());
        for url in [
            "https://127.0.0.1:4729",
            "http://localhost:4729",
            "http://example.com:4729",
            "http://127.0.0.1",
            "http://user@127.0.0.1:4729",
            "http://127.0.0.1:4729/api",
            "http://127.0.0.1:4729?x=1",
        ] {
            assert!(validate_ready("ready", url).is_err(), "{url}");
        }
    }
}
