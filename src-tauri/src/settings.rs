//! Persisted app settings and the native "Settings" menu.
//!
//! Settings live in a small JSON file in the per-user app config dir and are
//! mirrored into managed state so other Rust modules (web_session.rs) can read
//! them synchronously. The menu bar gets a "Settings" submenu; toggling an item
//! updates the state, persists the file, and emits `abs-settings-changed` so
//! the frontend can react if it needs to.
//!
//! Adding a future option (dark mode, ...) is three steps: a field on
//! [`AppSettings`], a menu item in [`register`], and an arm in the menu-event
//! handler.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{CheckMenuItemBuilder, Menu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The frontend can listen on this channel for live settings updates.
const SETTINGS_EVENT_CHANNEL: &str = "abs-settings-changed";

const SETTINGS_FILE: &str = "settings.json";
const MENU_ID_SHOW_ASSISTANT: &str = "abs-settings-show-assistant";
const MENU_ID_MCP_SERVER: &str = "abs-settings-mcp-server";

/// `#[serde(default)]` keeps old settings files readable as fields get added.
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    /// Show the provider automation window while a run is in progress instead
    /// of driving it hidden in the background.
    pub show_assistant_window: bool,

    /// Run the local MCP server (mcp_server.rs) so external AI tools can drive
    /// the design app. Off by default; toggled from the Settings menu.
    pub mcp_server_enabled: bool,
}

pub struct SettingsState(Mutex<AppSettings>);

/// Snapshot of the current settings for other Rust modules.
pub fn current<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    app.state::<SettingsState>().0.lock().unwrap().clone()
}

/// Lets the frontend read the settings (e.g. to style around a future dark
/// mode). Pair with the `abs-settings-changed` event for live updates.
#[tauri::command]
pub fn abs_get_settings(state: tauri::State<'_, SettingsState>) -> AppSettings {
    state.0.lock().unwrap().clone()
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(SETTINGS_FILE))
}

fn load<R: Runtime>(app: &AppHandle<R>) -> AppSettings {
    settings_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save<R: Runtime>(app: &AppHandle<R>, settings: &AppSettings) {
    let Some(path) = settings_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = fs::write(path, json);
    }
}

fn update<R: Runtime>(app: &AppHandle<R>, apply: impl FnOnce(&mut AppSettings)) {
    let snapshot = {
        let state = app.state::<SettingsState>();
        let mut settings = state.0.lock().unwrap();
        apply(&mut settings);
        settings.clone()
    };
    save(app, &snapshot);
    let _ = app.emit(SETTINGS_EVENT_CHANNEL, &snapshot);
}

/// Build the menu bar (platform defaults plus our Settings submenu) and start
/// handling its events. Call once from `setup`, before web_session runs.
pub fn register<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let settings = load(app);
    app.manage(SettingsState(Mutex::new(settings.clone())));

    let show_assistant = CheckMenuItemBuilder::with_id(
        MENU_ID_SHOW_ASSISTANT,
        "Show assistant window while it works",
    )
    .checked(settings.show_assistant_window)
    .build(app)?;

    let mcp_server = CheckMenuItemBuilder::with_id(
        MENU_ID_MCP_SERVER,
        "Run MCP server for external AI tools",
    )
    .checked(settings.mcp_server_enabled)
    .build(app)?;

    let settings_menu = SubmenuBuilder::new(app, "Settings")
        .item(&show_assistant)
        .item(&mcp_server)
        .build()?;

    let menu = Menu::default(app)?;
    menu.append(&settings_menu)?;

    // macOS has one app-wide menu bar. On Windows/Linux the menu attaches per
    // window, and only the main window should carry it — not the splash and
    // not the assistant automation windows.
    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;
    #[cfg(not(target_os = "macos"))]
    if let Some(main) = app.get_webview_window("main") {
        main.set_menu(menu)?;
    }

    app.on_menu_event(move |app, event| {
        // The OS toggles the checkmark itself; read it back as the truth.
        match event.id().as_ref() {
            MENU_ID_SHOW_ASSISTANT => {
                let checked = show_assistant.is_checked().unwrap_or(false);
                update(app, |settings| settings.show_assistant_window = checked);
            }
            MENU_ID_MCP_SERVER => {
                let checked = mcp_server.is_checked().unwrap_or(false);
                update(app, |settings| settings.mcp_server_enabled = checked);
                // Start/stop the listener to match, and let the frontend show
                // the connection URL.
                crate::mcp_server::apply_enabled(app, checked);
            }
            _ => {}
        }
    });

    Ok(())
}
