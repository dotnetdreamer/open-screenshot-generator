mod settings;
mod splash;
mod web_session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(web_session::WebSessionState::default())
        .invoke_handler(tauri::generate_handler![
            settings::abs_get_settings,
            splash::abs_app_ready,
            web_session::abs_web_start,
            web_session::abs_web_cancel,
            web_session::abs_web_login,
            web_session::abs_web_close,
            web_session::abs_web_clear_sessions,
            web_session::abs_web_capture,
        ])
        .setup(|app| {
            // Settings first: it manages the state the other modules read.
            settings::register(app.handle())?;
            splash::register(app.handle());
            web_session::register(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
