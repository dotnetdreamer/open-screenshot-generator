//! The webview inspector behind Settings ▸ Developer tools.
//!
//! Two things make this more than a one-liner on Windows.
//!
//! WebView2 only lets us *open* the inspector. wry's `close_devtools` is an
//! empty function there and `is_devtools_open` always answers `false` (wry
//! 0.55 `webview2/mod.rs`; tauri documents both as "Windows: Unsupported"). A
//! check menu item wired straight to those APIs lies: unchecking it closes
//! nothing, and the check stays on after the user closes the inspector with its
//! own X. So on Windows we treat the inspector as what it is - a top-level OS
//! window owned by one of our WebView2 child processes. We find it by walking
//! our own process tree, close it with `WM_CLOSE`, and poll for its
//! disappearance so the menu check can follow a close we did not initiate.
//! macOS and Linux have real wry implementations and use them.
//!
//! Opening also has to wait for the webview. `open_devtools()` during `setup`
//! is silently dropped - `main` is still hidden behind the splash and has not
//! navigated yet - so the launch-time restore runs from the splash handoff
//! ([`restore`], called by splash.rs) instead of from `setup`.

use tauri::{AppHandle, Runtime};

#[cfg(any(debug_assertions, windows))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(any(debug_assertions, windows))]
use std::thread;
#[cfg(any(debug_assertions, windows))]
use std::time::{Duration, Instant};
#[cfg(any(debug_assertions, windows))]
use tauri::Manager;

#[cfg(any(debug_assertions, windows))]
const MAIN_LABEL: &str = "main";

/// Whether this build can drive the inspector at all.
///
/// The API needs tauri's `devtools` feature outside of debug builds, and that
/// feature is a *private* API on macOS - which the App Store rejects, and this
/// app ships to the Mac App Store. So Cargo.toml only turns it on for Windows,
/// and release builds on macOS/Linux hide the menu item rather than offer a
/// dead one.
pub const SUPPORTED: bool = cfg!(any(debug_assertions, windows));

/// Open or close the inspector to match the Settings toggle.
#[cfg(any(debug_assertions, windows))]
pub fn apply<R: Runtime>(app: &AppHandle<R>, open: bool) {
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return;
    };
    if open {
        main.open_devtools();
        // The user can close the inspector by its own X, which tells us
        // nothing. Watch for that so the menu check does not go stale.
        watch(app);
    } else {
        close(&main);
    }
}

#[cfg(not(any(debug_assertions, windows)))]
pub fn apply<R: Runtime>(_app: &AppHandle<R>, _open: bool) {}

/// Reopen the inspector if the user left it open last session. Called from the
/// splash handoff, once `main` is visible and its page has loaded: an
/// `open_devtools()` issued any earlier is dropped on the floor.
#[cfg(any(debug_assertions, windows))]
pub fn restore<R: Runtime>(app: &AppHandle<R>) {
    if crate::settings::current(app).devtools_open {
        apply(app, true);
    }
}

#[cfg(not(any(debug_assertions, windows)))]
pub fn restore<R: Runtime>(_app: &AppHandle<R>) {}

#[cfg(windows)]
fn close<R: Runtime>(_main: &tauri::WebviewWindow<R>) {
    win::close_devtools_window();
}

#[cfg(all(not(windows), debug_assertions))]
fn close<R: Runtime>(main: &tauri::WebviewWindow<R>) {
    main.close_devtools();
}

#[cfg(windows)]
fn is_open<R: Runtime>(_main: &tauri::WebviewWindow<R>) -> bool {
    win::devtools_window().is_some()
}

#[cfg(all(not(windows), debug_assertions))]
fn is_open<R: Runtime>(main: &tauri::WebviewWindow<R>) -> bool {
    main.is_devtools_open()
}

#[cfg(any(debug_assertions, windows))]
mod watcher {
    use super::*;

    pub(super) static WATCHING: AtomicBool = AtomicBool::new(false);
    pub(super) const POLL: Duration = Duration::from_millis(500);

    /// How long to wait for the inspector to show up before giving up on it.
    /// It is a whole browser window; it does not appear the instant we ask.
    pub(super) const APPEAR_TIMEOUT: Duration = Duration::from_secs(20);
}

/// Poll until the inspector goes away, then let settings.rs uncheck the menu
/// item and persist the change. Exits as soon as the toggle is switched off by
/// hand - that transition belongs to the menu handler, not to us.
#[cfg(any(debug_assertions, windows))]
fn watch<R: Runtime>(app: &AppHandle<R>) {
    // One watcher is enough, and re-toggling must not stack them up.
    if watcher::WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }

    let app = app.clone();
    thread::spawn(move || {
        let started = Instant::now();
        let mut seen = false;

        loop {
            thread::sleep(watcher::POLL);

            if !crate::settings::current(&app).devtools_open {
                break;
            }
            let Some(main) = app.get_webview_window(MAIN_LABEL) else {
                break;
            };

            if is_open(&main) {
                seen = true;
                continue;
            }
            if seen {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    crate::settings::mark_devtools_closed(&handle);
                });
                break;
            }
            // Never showed up. Stop rather than spin for the whole session.
            if started.elapsed() > watcher::APPEAR_TIMEOUT {
                break;
            }
        }

        watcher::WATCHING.store(false, Ordering::SeqCst);
    });
}

/// Finding and closing the inspector window by hand, because WebView2 will not.
#[cfg(windows)]
mod win {
    use std::collections::HashSet;
    use std::mem::size_of;

    use windows::core::BOOL;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, WPARAM};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextW, GetWindowThreadProcessId, PostMessageW, WM_CLOSE,
    };

    /// WebView2 titles the inspector window "DevTools - <url>".
    const TITLE_PREFIX: &str = "DevTools";

    const CONTINUE: BOOL = BOOL(1);
    const STOP: BOOL = BOOL(0);

    struct Search {
        ours: HashSet<u32>,
        found: Option<HWND>,
    }

    /// Our process and everything descended from it. The inspector window
    /// belongs to a WebView2 grandchild, and scoping the search to the tree
    /// keeps a second copy of the app - or any other WebView2 app - out of
    /// range of the `WM_CLOSE` below.
    fn descendants() -> HashSet<u32> {
        let mut ours = HashSet::new();
        ours.insert(std::process::id());

        let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
            return ours;
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut all = Vec::new();
        if unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok() {
            loop {
                all.push((entry.th32ProcessID, entry.th32ParentProcessID));
                if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                    break;
                }
            }
        }
        let _ = unsafe { CloseHandle(snapshot) };

        // A snapshot is in no particular order, so a single pass can miss a
        // grandchild listed before its parent. Sweep until nothing new attaches.
        loop {
            let before = ours.len();
            for (pid, parent) in &all {
                if ours.contains(parent) {
                    ours.insert(*pid);
                }
            }
            if ours.len() == before {
                break;
            }
        }
        ours
    }

    unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = unsafe { &mut *(lparam.0 as *mut Search) };

        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if !search.ours.contains(&pid) {
            return CONTINUE;
        }

        let mut title = [0u16; 64];
        let len = unsafe { GetWindowTextW(hwnd, &mut title) } as usize;
        if String::from_utf16_lossy(&title[..len]).starts_with(TITLE_PREFIX) {
            search.found = Some(hwnd);
            return STOP;
        }
        CONTINUE
    }

    pub(super) fn devtools_window() -> Option<HWND> {
        let mut search = Search {
            ours: descendants(),
            found: None,
        };
        // Returns Err when `visit` stops the enumeration, which is a find, not
        // a failure - read the result out of `search` either way.
        let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) };
        search.found
    }

    pub(super) fn close_devtools_window() {
        if let Some(hwnd) = devtools_window() {
            let _ = unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        }
    }
}
