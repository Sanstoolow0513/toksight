use crate::sidecar::Sidecar;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::collections::BTreeMap;

// Keep imports aligned with src/dbtransfer.js. Responses and PNG saves have the
// same cap so an accidental or hostile response cannot exhaust the Rust host.
const MAX_BYTES: usize = 256 * 1024 * 1024;
const MAX_JSON_BYTES: usize = 8192;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body_base64: String,
}

fn validate_request(path: &str, method: &str) -> Result<(), String> {
    if path.len() > 16_384
        || path
            .chars()
            .any(|c| c.is_control() || c == '\\' || c == '#')
    {
        return Err("Invalid desktop API path".into());
    }
    let route = path.split('?').next().unwrap_or_default();
    let allowed = match method {
        "GET" => [
            "/api/data",
            "/api/prices",
            "/api/prices/status",
            "/api/quota",
            "/api/sync/status",
            "/api/export/db",
        ]
        .contains(&route),
        "POST" => [
            "/api/refresh",
            "/api/prices/update",
            "/api/prices/reset",
            "/api/setup",
            "/api/import/db",
            "/api/quota/refresh",
            "/api/sync/config",
            "/api/sync/upload",
            "/api/sync/restore",
        ]
        .contains(&route),
        _ => false,
    };
    if !allowed {
        return Err("Unsupported desktop API route or method".into());
    }
    Ok(())
}

fn decode_body(encoded: &str, limit: usize) -> Result<Vec<u8>, String> {
    if encoded.len() > limit.div_ceil(3) * 4 {
        return Err("Desktop transfer exceeds the size limit".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid desktop transfer encoding")?;
    if bytes.len() > limit {
        return Err("Desktop transfer exceeds the size limit".into());
    }
    Ok(bytes)
}

fn ensure_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("This window cannot access the desktop bridge".into());
    }
    let url = window.url().map_err(|e| e.to_string())?;
    if !is_app_url(&url) {
        return Err("Only the bundled application can use the desktop bridge".into());
    }
    Ok(())
}

pub fn is_app_url(url: &reqwest::Url) -> bool {
    #[cfg(debug_assertions)]
    if url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(3000)
        && url.username().is_empty()
        && url.password().is_none()
    {
        return true;
    }
    let origin_ok = (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"));
    origin_ok && url.port().is_none() && url.username().is_empty() && url.password().is_none()
}

#[tauri::command]
pub async fn desktop_request(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Sidecar>,
    path: String,
    method: String,
    body_base64: Option<String>,
    content_type: Option<String>,
) -> Result<ApiResponse, String> {
    ensure_main(&window)?;
    validate_request(&path, &method)?;
    let route = path.split('?').next().unwrap_or_default();
    let limit = if route == "/api/import/db" {
        MAX_BYTES
    } else {
        MAX_JSON_BYTES
    };
    let body = decode_body(body_base64.as_deref().unwrap_or_default(), limit)?;
    if method == "GET" && !body.is_empty() {
        return Err("GET requests cannot contain data".into());
    }
    let expected_type = if route == "/api/import/db" {
        "application/vnd.sqlite3"
    } else {
        "application/json"
    };
    if let Some(value) = &content_type {
        if value != expected_type {
            return Err("Unsupported desktop request content type".into());
        }
    }
    let mut request = state
        .client
        .request(
            reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "Unsupported method")?,
            format!("{}{}", state.url.trim_end_matches('/'), path),
        )
        .header("X-Toksight-Desktop-Token", &state.token)
        .header("Origin", &state.url);
    if method == "POST" {
        request = request.header("Content-Type", expected_type).body(body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "The desktop data service is unavailable. Restart toksight.".to_string())?;
    let status = response.status().as_u16();
    let headers = ["content-type", "content-disposition", "cache-control"]
        .into_iter()
        .filter_map(|name| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect();
    if response
        .content_length()
        .is_some_and(|size| size > MAX_BYTES as u64)
    {
        return Err("Desktop response exceeds 256 MiB".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "The desktop response was interrupted")?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_BYTES {
            return Err("Desktop response exceeds 256 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(ApiResponse {
        status,
        headers,
        body_base64: STANDARD.encode(bytes),
    })
}

fn validate_filename(filename: &str) -> Result<&str, String> {
    if filename.is_empty()
        || filename.len() > 200
        || filename
            .chars()
            .any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
    {
        return Err("Invalid export filename".into());
    }
    if filename.ends_with(".png") {
        Ok("png")
    } else if filename.ends_with(".sqlite") {
        Ok("sqlite")
    } else {
        Err("Only PNG and SQLite exports are supported".into())
    }
}

#[tauri::command]
pub async fn desktop_save(
    window: tauri::WebviewWindow,
    filename: String,
    body_base64: String,
) -> Result<bool, String> {
    ensure_main(&window)?;
    let extension = validate_filename(&filename)?.to_string();
    let bytes = decode_body(&body_base64, MAX_BYTES)?;
    tauri::async_runtime::spawn_blocking(move || {
        let selection = rfd::FileDialog::new()
            .set_parent(&window)
            .set_file_name(&filename)
            .add_filter(
                if extension == "png" {
                    "PNG image"
                } else {
                    "SQLite database"
                },
                &[extension.as_str()],
            )
            .save_file();
        let Some(path) = selection else {
            return Ok(false);
        };
        std::fs::write(path, bytes).map_err(|e| format!("Could not save the export: {e}"))?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn external_url(value: &str) -> Result<reqwest::Url, String> {
    if value.len() > 16_384 || value.chars().any(char::is_control) {
        return Err("Invalid external link".into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid external link")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only HTTP and HTTPS links can open in your browser".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn desktop_open_url(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    ensure_main(&window)?;
    let url = external_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || {
        open::that(url.as_str()).map_err(|e| format!("Could not open the browser: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_routing_cannot_escape_the_owned_api() {
        assert!(validate_request("/api/data?since=2026-01-01&clients=claude", "GET").is_ok());
        assert!(validate_request("/api/import/db", "POST").is_ok());
        for path in [
            "https://example.com/api/data",
            "//example.com/api/data",
            "/api/../api/data",
            "/api/%64ata",
            "/api/data#ignored",
            "/api/data\r\nHost:evil",
            "/api/data\\anything",
            "/api/not-a-route",
        ] {
            assert!(validate_request(path, "GET").is_err(), "{path}");
        }
        assert!(validate_request("/api/data", "POST").is_err());
        assert!(validate_request("/api/refresh", "GET").is_err());
        assert!(validate_request("/api/data", "DELETE").is_err());
    }
    #[test]
    fn transfers_enforce_size_and_base64() {
        assert_eq!(decode_body("AQID", 3).unwrap(), vec![1, 2, 3]);
        assert!(decode_body("AQID", 2).is_err());
        assert!(decode_body("????", 5).is_err());
    }
    #[test]
    fn external_links_cannot_launch_custom_protocols_or_credentials() {
        assert!(external_url("https://github.com/Sanstoolow0513/toksight").is_ok());
        for value in [
            "file:///C:/Windows/System32/cmd.exe",
            "javascript:alert(1)",
            "ms-settings:test",
            "https://user:secret@example.com",
            "https://example.com\n",
        ] {
            assert!(external_url(value).is_err(), "{value}");
        }
    }
    #[test]
    fn save_names_cannot_suggest_arbitrary_paths_or_executables() {
        assert_eq!(
            validate_filename("toksight-backup.sqlite").unwrap(),
            "sqlite"
        );
        assert_eq!(validate_filename("toksight-report.png").unwrap(), "png");
        for value in ["../x.png", "C:\\x.sqlite", "x.exe", "x.png:secret", ""] {
            assert!(validate_filename(value).is_err());
        }
    }
    #[test]
    fn navigation_stays_in_bundled_origin() {
        assert!(is_app_url(
            &reqwest::Url::parse("http://tauri.localhost/").unwrap()
        ));
        for value in [
            "https://example.com",
            "http://tauri.localhost:2222",
            "http://user@tauri.localhost",
            "http://127.0.0.1:4729",
        ] {
            assert!(!is_app_url(&reqwest::Url::parse(value).unwrap()));
        }
    }
}
