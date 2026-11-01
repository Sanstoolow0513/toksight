#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod sidecar;

use std::path::PathBuf;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn run() -> tauri::Result<()> {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            bridge::desktop_request,
            bridge::desktop_save,
            bridge::desktop_open_url
        ])
        .setup(|app| {
            let resources = app.path().resource_dir()?;
            let service = sidecar::Sidecar::start(&resources).map_err(std::io::Error::other)?;
            app.manage(service);
            let mut window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("toksight")
                    .inner_size(1440., 940.)
                    .min_inner_size(900., 640.)
                    .decorations(true)
                    .resizable(true)
                    .visible(false)
                    .on_navigation(bridge::is_app_url)
                    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                    .on_page_load(|window, payload| {
                        if payload.event() == tauri::webview::PageLoadEvent::Finished {
                            let _ = window.show();
                        }
                    });
            if let Some(state) = std::env::var_os("TOKSIGHT_DESKTOP_STATE_DIR") {
                let directory = PathBuf::from(state).join("webview");
                std::fs::create_dir_all(&directory)?;
                window = window.data_directory(directory);
            }
            // Explicit test mode only. Normal installations never expose a CDP port.
            if std::env::var("TOKSIGHT_DESKTOP_SMOKE").as_deref() == Ok("1") {
                if let Ok(port) = std::env::var("TOKSIGHT_DESKTOP_DEBUG_PORT") {
                    let port = port
                        .parse::<u16>()
                        .map_err(|_| std::io::Error::other("Invalid desktop smoke debug port"))?;
                    if port == 0 {
                        return Err(std::io::Error::other(
                            "Desktop smoke debug port cannot be zero",
                        )
                        .into());
                    }
                    window = window.additional_browser_args(&format!(
                        "--remote-debugging-port={port} --remote-debugging-address=127.0.0.1"
                    ));
                }
            }
            window.build()?;
            Ok(())
        })
        .build(tauri::generate_context!())?;
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(service) = app.try_state::<sidecar::Sidecar>() {
                service.stop();
            }
        }
    });
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        let message = format!("toksight could not start.\n\n{error}");
        eprintln!("{message}");
        if let Some(state) = std::env::var_os("TOKSIGHT_DESKTOP_STATE_DIR") {
            let directory = PathBuf::from(state);
            let _ = std::fs::create_dir_all(&directory);
            let _ = std::fs::write(directory.join("last-error.txt"), &message);
        }
        if std::env::var("TOKSIGHT_DESKTOP_SMOKE").as_deref() != Ok("1") {
            rfd::MessageDialog::new()
                .set_title("toksight")
                .set_description(&message)
                .set_level(rfd::MessageLevel::Error)
                .show();
        }
        std::process::exit(1);
    }
}
