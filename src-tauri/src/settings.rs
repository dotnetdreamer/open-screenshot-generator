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
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The frontend can listen on this channel for live settings updates.
const SETTINGS_EVENT_CHANNEL: &str = "abs-settings-changed";

/// Tells the frontend to open its About dialog (the same one the sidebar's
/// About option shows). Emitted when Help > About is clicked.
const ABOUT_EVENT_CHANNEL: &str = "abs-open-about";

const SETTINGS_FILE: &str = "settings.json";
const MENU_ID_SHOW_ASSISTANT: &str = "abs-settings-show-assistant";
const MENU_ID_MCP_SERVER: &str = "abs-settings-mcp-server";
const MENU_ID_DEVTOOLS: &str = "abs-settings-devtools";
const MENU_ID_RELOAD_WINDOW: &str = "abs-settings-reload-window";
const MENU_ID_ABOUT: &str = "abs-help-about";

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

    /// Keep the webview inspector open on the main window. Off by default;
    /// toggled from the Settings menu (or F12) and reopened at the next launch.
    /// devtools.rs owns the window itself.
    pub devtools_open: bool,
}

pub struct SettingsState(Mutex<AppSettings>);

/// The Developer tools check item, kept so the devtools watcher can uncheck it
/// when the user closes the inspector by hand.
///
/// It has to be *held*: `Menu::get(id)` only searches top-level items and never
/// descends into a submenu, so looking this one up by id inside "Settings"
/// silently returns `None`.
struct DevtoolsMenuItem<R: Runtime>(CheckMenuItem<R>);

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

    let devtools = CheckMenuItemBuilder::with_id(MENU_ID_DEVTOOLS, "Developer tools")
        .checked(settings.devtools_open)
        .accelerator("F12")
        .build(app)?;
    app.manage(DevtoolsMenuItem(devtools.clone()));

    let reload_window = MenuItemBuilder::with_id(MENU_ID_RELOAD_WINDOW, "Reload window")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    let mut settings_menu = SubmenuBuilder::new(app, "Settings")
        .item(&show_assistant)
        .item(&mcp_server)
        .separator()
        .item(&reload_window);
    // A release build on macOS/Linux cannot open the inspector at all, so offer
    // no item rather than a dead one.
    if crate::devtools::SUPPORTED {
        settings_menu = settings_menu.item(&devtools);
    }
    let settings_menu = settings_menu.build()?;

    // The platform-default menus, rebuilt by hand for two differences from
    // Menu::default(): Edit has no Select All (it only selects the page's DOM
    // text, which is meaningless over a canvas app), and Help > About opens
    // the frontend's About dialog instead of the bare native about box.
    let menu = Menu::new(app)?;

    // macOS keeps its conventional app menu; About there stays native since
    // that entry describes the bundle, while Help > About below is ours.
    #[cfg(target_os = "macos")]
    {
        let pkg = app.package_info();
        let about_metadata = tauri::menu::AboutMetadata {
            name: Some(pkg.name.clone()),
            version: Some(pkg.version.to_string()),
            ..Default::default()
        };
        let app_menu = SubmenuBuilder::new(app, pkg.name.clone())
            .about(Some(about_metadata))
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .separator()
            .quit()
            .build()?;
        menu.append(&app_menu)?;
    }

    let file_menu = {
        let file = SubmenuBuilder::new(app, "File").close_window();
        #[cfg(not(target_os = "macos"))]
        let file = file.quit();
        file.build()?
    };

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .build()?;

    #[cfg(target_os = "macos")]
    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

    let window_menu = {
        let window = SubmenuBuilder::new(app, "Window").minimize().maximize();
        #[cfg(target_os = "macos")]
        let window = window.separator();
        window.close_window().build()?
    };

    let about_item = MenuItemBuilder::with_id(MENU_ID_ABOUT, "About Artboard Studio").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help").item(&about_item).build()?;

    menu.append(&file_menu)?;
    menu.append(&edit_menu)?;
    #[cfg(target_os = "macos")]
    menu.append(&view_menu)?;
    menu.append(&window_menu)?;
    menu.append(&help_menu)?;
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
            MENU_ID_DEVTOOLS => {
                let checked = devtools.is_checked().unwrap_or(false);
                update(app, |settings| settings.devtools_open = checked);
                crate::devtools::apply(app, checked);
            }
            // Not a setting, just an action: reload the app webview in place,
            // like a browser refresh. The splash handshake is reload-safe
            // (reveal() is idempotent), so nothing else needs to happen.
            MENU_ID_RELOAD_WINDOW => {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.reload();
                }
            }
            // The dialog lives in the frontend; just ask it to open.
            MENU_ID_ABOUT => {
                let _ = app.emit_to("main", ABOUT_EVENT_CHANNEL, ());
            }
            _ => {}
        }
    });

    // The inspector is NOT restored here: an open_devtools() this early is
    // dropped, because `main` is still hidden behind the splash and has not
    // navigated. splash.rs calls devtools::restore once it hands over.

    Ok(())
}

/// The user closed the inspector by its own X (devtools.rs noticed). Uncheck
/// the menu item and persist, so the toggle keeps telling the truth.
///
/// Must run on the main thread - it touches the menu.
pub fn mark_devtools_closed<R: Runtime>(app: &AppHandle<R>) {
    update(app, |settings| settings.devtools_open = false);
    if let Some(item) = app.try_state::<DevtoolsMenuItem<R>>() {
        let _ = item.0.set_checked(false);
    }
}
