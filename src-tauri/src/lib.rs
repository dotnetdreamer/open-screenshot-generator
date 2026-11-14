mod claude_code;
mod code_folders;
mod codex;
mod device_capture;
mod devtools;
mod mcp_server;
mod migrate;
mod oauth;
mod panels;
mod settings;
mod splash;
mod updater;
mod store_package;
mod web_session;
mod webview_crash;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    // The Store build keeps its data under its own identifier (see
    // store_package.rs). Tauri derives every per-user path and the WebView2
    // profile from the identifier in this context, so changing it here,
    // before the builder sees it, moves all of them at once.
    let packaged = store_package::is_packaged();
    if packaged {
        context.config_mut().identifier = store_package::STORE_IDENTIFIER.to_string();
    }

    // Before Tauri resolves any path or opens the webview profile: the bundle
    // identifier changed with the rename to Open Screenshot Generator, and
    // every per-user directory hangs off it. The Store build never had the old
    // identifier, and a rename inside a package would move the installer
    // build's folders, so it skips this.
    if !packaged {
        migrate::run();
    }

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        // No capability grants the plugin's own commands, so the page cannot
        // call it directly. updater.rs drives it.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(web_session::WebSessionState::default())
        .manage(mcp_server::McpState::default())
        .manage(claude_code::ClaudeState::default())
        .manage(codex::CodexState::default())
        .manage(oauth::OauthState::default())
        .manage(webview_crash::WebviewCrashState::default())
        .manage(device_capture::CaptureState::default())
        // A reload of the editor must not strand a Claude Code or Codex
        // process that was still starting for the page it replaced.
        .on_page_load(|webview, payload| {
            claude_code::on_page_load(webview, payload);
            codex::on_page_load(webview, payload);
            device_capture::on_page_load(webview, payload);
        });

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
            mcp_server::abs_mcp_bridge_nonce,
            claude_code::abs_claude_detect,
            claude_code::abs_claude_start,
            claude_code::abs_claude_send,
            claude_code::abs_claude_close_input,
            claude_code::abs_claude_stop,
            claude_code::abs_claude_list,
            claude_code::abs_claude_page_epoch,
            claude_code::abs_claude_pick_folder,
            claude_code::abs_claude_forget_folder,
            claude_code::abs_claude_read_project_image,
            claude_code::abs_claude_prompt,
            claude_code::abs_claude_prompt_stop,
            codex::abs_codex_detect,
            codex::abs_codex_start,
            codex::abs_codex_send,
            codex::abs_codex_interrupt,
            codex::abs_codex_stop,
            codex::abs_codex_list,
            codex::abs_codex_page_epoch,
            codex::abs_codex_prompt,
            codex::abs_codex_prompt_stop,
            oauth::abs_oauth_start,
            oauth::abs_oauth_await,
            oauth::abs_oauth_cancel,
            updater::abs_update_state,
            updater::abs_update_check,
            updater::abs_update_install,
            updater::abs_update_flushed,
            device_capture::abs_capture_devices,
            device_capture::abs_capture_start_device,
            device_capture::abs_capture_create_simulator,
            device_capture::abs_capture_apps,
            device_capture::abs_capture_tidy_status_bar,
            device_capture::abs_capture_appearance,
            device_capture::abs_capture_launch,
            device_capture::abs_capture_screenshot,
            device_capture::abs_capture_record_start,
            device_capture::abs_capture_record_stop,
        ])
        .setup(|app| {
            // Settings first: it manages the state the other modules read.
            settings::register(app.handle())?;
            splash::register(app.handle());
            // Works out once whether this install updates itself (updater.rs).
            updater::register(app.handle());
            // The window backgroundColor in tauri.conf.json is there so Windows
            // has something other than black to show before the webview paints.
            // On Linux it also sits behind the GTK menu bar, which draws no
            // background of its own, so a hardcoded light grey stayed put while
            // a dark GTK theme rendered its labels in near-white on top of it:
            // an unreadable menu bar in GNOME dark mode. Clearing it hands the
            // bar back to GTK. Safe to do here because `main` is still hidden
            // behind the splash and has painted nothing yet.
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager as _;
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.set_background_color(None);
                }
            }
            // Put the editor back on the display it was closed on, while it is
            // still hidden behind the splash, and make sure its detached panel
            // windows never outlive it.
            panels::register(app.handle());
            web_session::register(app.handle());
            // Restore the MCP server if the user left it enabled last session.
            mcp_server::register(app.handle());
            // Claude Code and Codex processes the agent started die with the editor.
            claude_code::register(app.handle());
            codex::register(app.handle());
            Ok(())
        })
        .build(context)
        .expect("error while running tauri application")
        .run(|app, event| match event {
            // A window that closes takes the one-shot prompts it asked for with
            // it. A tab window can close before the editor, or outlive it.
            tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } => {
                claude_code::stop_window_prompts(app, &label);
                codex::stop_window_prompts(app, &label);
                device_capture::stop_window(app, &label);
            }
            // The editor window's own Destroyed hook usually gets there first;
            // this covers quitting the app outright (Cmd+Q on macOS).
            tauri::RunEvent::Exit => {
                claude_code::kill_all(app);
                codex::kill_all(app);
                // Recordings stop, and the status bars Capture tidied come back.
                device_capture::stop_all(app);
            }
            _ => {}
        });
}
