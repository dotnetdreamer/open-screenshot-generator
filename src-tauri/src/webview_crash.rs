//! WebContent-process crash handling and observability (GitHub issue #19).
//!
//! On macOS, WKWebView renders every window in a separate WebContent process
//! that the OS terminates freely under memory pressure. When no terminate
//! handler is registered, tauri-runtime-wry installs a *default* one that
//! silently calls `reload()` - to the user the app blanks out and reloads for
//! no visible reason, and reloading the heavy SPA re-pins the very memory
//! that got the process killed, so it can loop ("memory grows, crashes,
//! reloads, repeats").
//!
//! Registering our own handler replaces that default. Tauri 2.x exposes
//! exactly one public hook for this, the app-wide
//! `tauri::Builder::on_web_content_process_terminate` (macOS/iOS only); there
//! is no per-webview builder method, so this module receives terminations for
//! *every* window and dispatches on the label:
//!
//!   - main window (and the short-lived splash): keep the reload recovery,
//!     but log it and record the moment so the frontend can ask (via
//!     `abs_webview_crash_info`) and tell the user what happened.
//!   - assistant provider windows (web_session.rs): destroy instead of
//!     reload. They are hidden background caches; reloading a dead one only
//!     re-pins hundreds of MB for a page nobody is looking at. Their login
//!     state lives in the profile's cookie jar, not the window, so the next
//!     run recreates them signed in.

use std::sync::Mutex;

/// When the main window's WebContent process was last killed, as an ISO-8601
/// UTC timestamp. One-shot on purpose: reading it through
/// `abs_webview_crash_info` clears it, so the frontend surfaces one notice
/// per crash instead of repeating it on every later check.
#[derive(Default)]
pub struct WebviewCrashState {
    last_main_crash: Mutex<Option<String>>,
}

/// One-shot read of the last main-window webview crash. Returns the ISO-8601
/// UTC timestamp of the termination and clears the stored value. Always
/// `None` on Windows/Linux, where the terminate hook does not exist (WebView2
/// and WebKitGTK recover through different mechanisms).
#[tauri::command]
pub fn abs_webview_crash_info(state: tauri::State<'_, WebviewCrashState>) -> Option<String> {
    state.last_main_crash.lock().unwrap().take()
}

/// The app-wide terminate handler, registered on `tauri::Builder` in lib.rs.
/// Runs on the main thread, inside WKWebView's
/// `webViewWebContentProcessDidTerminate` delegate callback.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub fn on_web_content_process_terminate(webview: &tauri::Webview<tauri::Wry>) {
    use tauri::Manager;

    let label = webview.label().to_string();
    let now = now_iso8601();

    if crate::web_session::is_assistant_window(&label) {
        // A background provider window's renderer died - almost certainly the
        // OS reclaiming memory from a hidden window. Destroy it rather than
        // reload it; ensure_window rebuilds it (still signed in, sessions are
        // cookies) the next time a run needs it. Calling destroy() right here
        // is safe: tauri-runtime-wry always routes WindowMessage::Destroy
        // through the event-loop proxy, never inline, so the WKWebView is not
        // torn down while its own delegate callback is on the stack - and the
        // sooner it is queued, the smaller the window in which ensure_window
        // could reuse the dead window. Any job queued on it is reported as
        // cancelled by the Destroyed handler ensure_window installed.
        eprintln!("{label}: web content process terminated at {now}; destroying window");
        if let Some(window) = webview.app_handle().get_webview_window(&label) {
            if let Err(error) = window.destroy() {
                eprintln!("{label}: could not destroy crashed assistant window: {error}");
            }
        }
        return;
    }

    // The main window (or splash): recover exactly like the default handler,
    // by reloading - but observably. Record the moment for the frontend
    // before reloading, so the fresh page's crash check finds it.
    eprintln!("{label}: web content process terminated at {now}; reloading");
    if label == "main" {
        if let Some(state) = webview.app_handle().try_state::<WebviewCrashState>() {
            *state.last_main_crash.lock().unwrap() = Some(now);
        }
    }
    if let Err(error) = webview.reload() {
        eprintln!("{label}: reload after web content process termination failed: {error}");
    }
}

/// Current time as ISO-8601 / RFC 3339 UTC, e.g. "2026-08-18T09:41:23Z".
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn now_iso8601() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown time".to_string())
}
