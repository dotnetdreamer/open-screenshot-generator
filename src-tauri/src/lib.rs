mod devtools;
mod mcp_server;
mod migrate;
mod oauth;
mod settings;
mod splash;
mod web_session;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before Tauri resolves any path or opens the webview profile: the bundle
    // identifier changed with the rename to Open Screenshot Generator, and
    // every per-user directory hangs off it.
    migrate::run();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(web_session::WebSessionState::default())
        .manage(mcp_server::McpState::default())
        .manage(oauth::OauthState::default())
        .invoke_handler(tauri::generate_handler![
            settings::abs_get_settings,
            splash::abs_app_ready,
            web_session::abs_web_start,
            web_session::abs_web_cancel,
            web_session::abs_web_login,
            web_session::abs_web_close,
            web_session::abs_web_clear_sessions,
            web_session::abs_web_capture,
            mcp_server::abs_mcp_start,
            mcp_server::abs_mcp_stop,
            mcp_server::abs_mcp_status,
            mcp_server::abs_mcp_respond,
            oauth::abs_oauth_start,
            oauth::abs_oauth_await,
            oauth::abs_oauth_cancel,
        ])
        .setup(|app| {
            // Settings first: it manages the state the other modules read.
            settings::register(app.handle())?;
            splash::register(app.handle());
            web_session::register(app.handle());
            // Restore the MCP server if the user left it enabled last session.
            mcp_server::register(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
