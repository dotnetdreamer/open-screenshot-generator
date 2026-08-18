mod devtools;
mod mcp_server;
mod migrate;
mod oauth;
mod settings;
mod splash;
mod web_session;
mod webview_crash;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before Tauri resolves any path or opens the webview profile: the bundle
    // identifier changed with the rename to Open Screenshot Generator, and
    // every per-user directory hangs off it.
    migrate::run();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(web_session::WebSessionState::default())
        .manage(mcp_server::McpState::default())
        .manage(oauth::OauthState::default())
        .manage(webview_crash::WebviewCrashState::default());

    // On macOS, the OS kills WKWebView WebContent processes under memory
    // pressure; without a handler here Tauri's default silently reloads the
    // webview, which is the invisible crash-reload loop of issue #19. This is
    // Tauri's only public hook (app-wide, per-webview handlers are not
    // exposed), so webview_crash.rs dispatches on the window label: main gets
    // an observable reload, hidden assistant windows are destroyed instead.
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    let builder = builder.on_web_content_process_terminate(|webview| {
        webview_crash::on_web_content_process_terminate(webview)
    });

    builder
        .invoke_handler(tauri::generate_handler![
            settings::abs_get_settings,
            splash::abs_app_ready,
            web_session::abs_web_start,
            web_session::abs_web_cancel,
            web_session::abs_web_login,
            web_session::abs_web_close,
            web_session::abs_web_clear_sessions,
            web_session::abs_web_capture,
            webview_crash::abs_webview_crash_info,
            mcp_server::abs_mcp_start,
            mcp_server::abs_mcp_stop,
            mcp_server::abs_mcp_status,
            mcp_server::abs_mcp_respond,
            mcp_server::abs_mcp_write_png,
            mcp_server::abs_write_export_png,
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
