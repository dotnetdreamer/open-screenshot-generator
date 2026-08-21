//! Where the windows are, and which of them belong to the main one.
//!
//! Two jobs, both of them about a desk with more than one screen on it.
//!
//! **The editor reopens where you left it.** A Tauri window declared in
//! tauri.conf.json is centred on the primary display every launch, which on a
//! two-display desk means dragging the app across every morning. So the main
//! window's geometry is kept in the app config dir and put back in `setup`,
//! before the window is ever shown (it is `"visible": false` until splash.rs
//! hands over, see splash.rs), so the restore is invisible rather than a jump.
//! A saved position is only honoured while some display still overlaps it: a
//! laptop that was docked to two screens yesterday has one today, and a window
//! restored onto a display that is no longer there is a window nobody can
//! reach.
//!
//! **Panel windows do not outlive the editor.** A detached panel (label
//! `panel-<group>`, opened from the frontend, see src/lib/panels/windows.ts) is
//! a view of the main window's state and has nothing to show without it. It
//! also keeps the process alive: Tauri exits when the last window closes, so an
//! orphan panel window is an app the user cannot quit from the taskbar. Closing
//! them with `main` is not a nicety.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WindowEvent};

const MAIN_LABEL: &str = "main";
/// Every detached panel window's label starts with this. Matches the glob in
/// capabilities/panels.json and `panelWindowLabel` on the frontend.
const PANEL_PREFIX: &str = "panel-";
const STATE_FILE: &str = "window-state.json";

/// Windows reports a minimized window at (-32000, -32000). Anything out here is
/// a placeholder, not a position worth remembering.
const MINIMIZED_SENTINEL: i32 = -30000;

/// How much of the title bar has to stay on a display for the window to be
/// reachable with a mouse.
const GRAB_MARGIN: i32 = 80;

#[derive(Clone, Copy, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct WindowGeometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

/// The last geometry seen, written out when the window closes.
///
/// Kept in memory rather than written per event because a drag across a desk
/// fires `Moved` per pixel, and a config file rewritten sixty times a second is
/// a config file that will eventually be truncated by a power cut.
#[derive(Default)]
struct WindowStateCache(Mutex<Option<WindowGeometry>>);

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(STATE_FILE))
}

fn load<R: Runtime>(app: &AppHandle<R>) -> Option<WindowGeometry> {
    let text = fs::read_to_string(state_path(app)?).ok()?;
    let geometry: WindowGeometry = serde_json::from_str(&text).ok()?;
    if geometry.width < 200 || geometry.height < 200 {
        return None;
    }
    Some(geometry)
}

fn save<R: Runtime>(app: &AppHandle<R>, geometry: &WindowGeometry) {
    let Some(path) = state_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(geometry) {
        let _ = fs::write(path, json);
    }
}

/// Is enough of this rectangle on a display that a person could still grab it?
fn is_reachable<R: Runtime>(window: &tauri::WebviewWindow<R>, geometry: &WindowGeometry) -> bool {
    let Ok(monitors) = window.available_monitors() else {
        // No display list, so no grounds to reject a saved position.
        return true;
    };
    if monitors.is_empty() {
        return true;
    }
    // width here is the client width, so this underestimates the window's real
    // right edge by the border. That errs towards "not reachable", which is the
    // safe direction: the worst case is a centred default instead of a restore.
    let right = geometry.x + geometry.width as i32;
    monitors.iter().any(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        let monitor_right = position.x + size.width as i32;
        let monitor_bottom = position.y + size.height as i32;
        right - GRAB_MARGIN > position.x
            && geometry.x + GRAB_MARGIN < monitor_right
            // The title bar, not the whole window: a window hanging off the
            // bottom is still one you can drag back up.
            && geometry.y + 40 >= position.y
            && geometry.y + 40 < monitor_bottom
    })
}

/// Snapshot the main window, unless it is minimized or maximized.
///
/// A maximized window's rectangle is the display, not the size the user chose,
/// and restoring that as a plain size loses the size they would get back by
/// unmaximizing. The flag is kept instead.
///
/// `outer_position` with `inner_size`, deliberately. They are the pair the
/// setters take back: `set_position` places the window's top left corner, and
/// `set_size` sets the CLIENT area, title bar and border excluded. Saving
/// `outer_size` and restoring it through `set_size` is the creep bug where a
/// window grows by the height of its own title bar on every launch.
fn capture<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Option<WindowGeometry> {
    if window.is_minimized().unwrap_or(false) {
        return None;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    if position.x < MINIMIZED_SENTINEL || position.y < MINIMIZED_SENTINEL {
        return None;
    }
    if maximized {
        // Keep whatever restored geometry we already had and only note the flag.
        return Some(WindowGeometry { maximized: true, ..Default::default() });
    }
    Some(WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized: false,
    })
}

/// Close every detached panel window. Called when the editor is going away.
pub fn close_panel_windows<R: Runtime>(app: &AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(PANEL_PREFIX) {
            let _ = window.close();
        }
    }
}

/// Restore the main window's place, and keep it from leaving orphans behind.
///
/// Call from `setup`, while `main` is still hidden behind the splash.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    app.manage(WindowStateCache::default());

    let Some(main) = app.get_webview_window(MAIN_LABEL) else { return };

    let restored = load(app);
    if let Some(geometry) = restored {
        if geometry.maximized {
            let _ = main.maximize();
        } else if is_reachable(&main, &geometry) {
            let _ = main.set_position(PhysicalPosition::new(geometry.x, geometry.y));
            let _ = main.set_size(PhysicalSize::new(geometry.width, geometry.height));
        }
        // A geometry that is not reachable is dropped on purpose: the window
        // keeps the centred default from tauri.conf.json, which is always on a
        // display that exists.
        if let Some(state) = app.try_state::<WindowStateCache>() {
            *state.0.lock().unwrap() = Some(geometry);
        }
    }

    let handle = app.clone();
    main.on_window_event(move |event| match event {
        // Moved and Resized are the cheap half: note it, write nothing.
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let Some(window) = handle.get_webview_window(MAIN_LABEL) else { return };
            let Some(mut geometry) = capture(&window) else { return };
            if let Some(state) = handle.try_state::<WindowStateCache>() {
                let mut slot = state.0.lock().unwrap();
                if geometry.maximized {
                    // Keep the restored rectangle underneath the flag, so
                    // unmaximizing after a restart lands where it used to.
                    if let Some(previous) = *slot {
                        geometry.x = previous.x;
                        geometry.y = previous.y;
                        geometry.width = previous.width;
                        geometry.height = previous.height;
                    }
                }
                *slot = Some(geometry);
            }
        }
        // The editor is going. Write the position out and take its panels with
        // it, before the runtime decides whether the app should exit.
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
            close_panel_windows(&handle);
            let geometry = handle
                .try_state::<WindowStateCache>()
                .and_then(|state| *state.0.lock().unwrap());
            if let Some(geometry) = geometry {
                save(&handle, &geometry);
            }
        }
        _ => {}
    });
}
