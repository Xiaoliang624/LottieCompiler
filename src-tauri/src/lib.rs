use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Cursor};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, Emitter};

// ── App State ──

struct AppState {
    figma_port: Mutex<u16>,
    settings: Mutex<Settings>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Settings {
    api_base_url: String,
    api_key: String,
    model_name: String,
    theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            api_base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model_name: "gpt-4.1-mini".to_string(),
            theme: "light".to_string(),
        }
    }
}

fn get_settings_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("settings.json")
}

fn load_settings(app: &AppHandle) -> Settings {
    let path = get_settings_path(app);
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &Settings) {
    let path = get_settings_path(app);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(settings).unwrap_or_default());
}

// ── Tauri Commands ──

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn get_download_dir(app: AppHandle) -> Result<String, String> {
    app.path()
        .download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get download dir: {}", e))
}

#[tauri::command]
fn get_setting(app: AppHandle, key: String) -> serde_json::Value {
    let state = app.state::<AppState>();
    let settings = state.settings.lock().unwrap();
    match key.as_str() {
        "apiBaseUrl" => serde_json::Value::String(settings.api_base_url.clone()),
        "apiKey" => serde_json::Value::String(settings.api_key.clone()),
        "modelName" => serde_json::Value::String(settings.model_name.clone()),
        "theme" => serde_json::Value::String(settings.theme.clone()),
        _ => serde_json::Value::Null,
    }
}

#[tauri::command]
fn set_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut settings = state.settings.lock().unwrap();
    match key.as_str() {
        "apiBaseUrl" => settings.api_base_url = value,
        "apiKey" => settings.api_key = value,
        "modelName" => settings.model_name = value,
        "theme" => settings.theme = value,
        _ => return Err(format!("Unknown setting key: {}", key)),
    }
    save_settings(&app, &settings);
    Ok(())
}

#[tauri::command]
fn get_figma_port(state: State<AppState>) -> u16 {
    *state.figma_port.lock().unwrap()
}

#[tauri::command]
async fn fetch_ai(
    url: String,
    api_key: String,
    body: serde_json::Value,
    method: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let method = method.unwrap_or_else(|| "POST".to_string()).to_uppercase();
    let mut request = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url).header("Content-Type", "application/json"),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    }
    .header("Authorization", format!("Bearer {}", api_key));

    if method == "POST" {
        request = request.json(&body);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    let data: serde_json::Value = if response_text.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(&response_text).unwrap_or_else(|_| {
            serde_json::Value::String(response_text.clone())
        })
    };

    if !(200..300).contains(&status) {
        return Err(format!(
            "{} {}: {}",
            method,
            status,
            describe_api_error(&data)
        ));
    }

    Ok(serde_json::json!({
        "status": status,
        "data": data,
    }))
}

fn describe_api_error(data: &serde_json::Value) -> String {
    if let Some(message) = data
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(|message| message.as_str())
    {
        return message.to_string();
    }

    if let Some(message) = data.get("error").and_then(|error| error.as_str()) {
        return message.to_string();
    }

    if let Some(message) = data.get("message").and_then(|message| message.as_str()) {
        return message.to_string();
    }

    data.to_string()
}

// ── Figma Bridge HTTP Server ──

fn start_figma_bridge(app: AppHandle, preferred_port: u16) {
    std::thread::spawn(move || {
        let mut port = preferred_port;
        let server = loop {
            match tiny_http::Server::http(format!("127.0.0.1:{}", port)) {
                Ok(s) => break s,
                Err(_) => {
                    port += 1;
                    if port > 37535 {
                        eprintln!("Figma bridge: no available port found");
                        return;
                    }
                }
            }
        };

        {
            let state = app.state::<AppState>();
            *state.figma_port.lock().unwrap() = port;
        }
        println!("Figma bridge listening on port {}", port);

        for mut request in server.incoming_requests() {
            let url = request.url().to_string();
            let method = request.method().as_str().to_string();

            let cors_header = tiny_http::Header::from_bytes(
                &b"Access-Control-Allow-Origin"[..],
                &b"*"[..],
            )
            .unwrap();
            let cors_methods_header = tiny_http::Header::from_bytes(
                &b"Access-Control-Allow-Methods"[..],
                &b"GET, POST, OPTIONS"[..],
            )
            .unwrap();
            let cors_headers_header = tiny_http::Header::from_bytes(
                &b"Access-Control-Allow-Headers"[..],
                &b"Content-Type"[..],
            )
            .unwrap();

            if method == "OPTIONS" {
                let response = tiny_http::Response::new(
                    tiny_http::StatusCode(204),
                    vec![
                        cors_header.clone(),
                        cors_methods_header.clone(),
                        cors_headers_header.clone(),
                    ],
                    io::empty(),
                    None,
                    None,
                );
                let _ = request.respond(response);
                continue;
            }

            if method == "GET" && url == "/health" {
                let body = serde_json::json!({"status": "ok", "port": port}).to_string();
                let mut headers = vec![
                    cors_header.clone(),
                    cors_methods_header.clone(),
                    cors_headers_header.clone(),
                ];
                headers.push(
                    tiny_http::Header::from_bytes(
                        &b"Content-Type"[..],
                        &b"application/json"[..],
                    )
                    .unwrap(),
                );
                let response = tiny_http::Response::new(
                    tiny_http::StatusCode(200),
                    headers,
                    Cursor::new(body.as_bytes().to_vec()),
                    Some(body.len()),
                    None,
                );
                let _ = request.respond(response);
                continue;
            }

            if method == "POST" && url == "/import-scene" {
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_ok() {
                    if let Ok(scene) = serde_json::from_str::<serde_json::Value>(&body) {
                        let _ = app.emit("figma-bridge:scene-received", &scene);
                        let resp_body = serde_json::json!({"success": true}).to_string();
                        let mut headers = vec![
                            cors_header.clone(),
                            cors_methods_header.clone(),
                            cors_headers_header.clone(),
                        ];
                        headers.push(
                            tiny_http::Header::from_bytes(
                                &b"Content-Type"[..],
                                &b"application/json"[..],
                            )
                            .unwrap(),
                        );
                        let response = tiny_http::Response::new(
                            tiny_http::StatusCode(200),
                            headers,
                            Cursor::new(resp_body.as_bytes().to_vec()),
                            Some(resp_body.len()),
                            None,
                        );
                        let _ = request.respond(response);
                        continue;
                    }
                }
                let resp_body = serde_json::json!({"success": false, "error": "Invalid JSON"}).to_string();
                let mut headers = vec![
                    cors_header.clone(),
                    cors_methods_header.clone(),
                    cors_headers_header.clone(),
                ];
                headers.push(
                    tiny_http::Header::from_bytes(
                        &b"Content-Type"[..],
                        &b"application/json"[..],
                    )
                    .unwrap(),
                );
                let resp_len = resp_body.len();
                let response = tiny_http::Response::new(
                    tiny_http::StatusCode(400),
                    headers,
                    Cursor::new(resp_body.into_bytes()),
                    Some(resp_len),
                    None,
                );
                let _ = request.respond(response);
                continue;
            }

            let response = tiny_http::Response::new(
                tiny_http::StatusCode(404),
                vec![cors_header],
                io::empty(),
                None,
                None,
            );
            let _ = request.respond(response);
        }
    });
}

// ── App Entry ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let settings = load_settings(&app_handle);

            let state = AppState {
                figma_port: Mutex::new(37531),
                settings: Mutex::new(settings),
            };
            app.manage(state);

            start_figma_bridge(app_handle, 37531);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            get_download_dir,
            get_setting,
            set_setting,
            get_figma_port,
            fetch_ai,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
