// Splash screen / first-paint handoff.
//
// An OS window exists before its webview has painted anything, and that empty
// client area renders as a black rectangle. So `main` is declared
// `"visible": false` in tauri.conf.json and loads Next.js off-screen while this
// splash stands in for it; `abs_app_ready` then swaps them.
//
// The splash window is built here rather than declared in tauri.conf.json for
// one reason: a config window is mapped the moment it is created, which would
// show the same black rectangle for the ~600ms WebView2 needs to start up and
// paint. Building it lets us keep it hidden until `on_page_load` fires, so the
// window is already painted the first frame the user sees it. Showing nothing
// for half a second beats showing black for half a second.
//
// Note that the frontend cannot use requestAnimationFrame to detect readiness:
// a hidden window produces no compositor frames, so rAF never fires. It signals
// from a React effect instead (see `signalAppReady` in src/lib/desktop.ts).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::utils::config::Color;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const MAIN_LABEL: &str = "main";
const SPLASH_LABEL: &str = "splashscreen";

/// Teal from the logo gradient. Only affects the window layer on Windows (the
/// webview layer ignores it), which is precisely why the splash stays hidden
/// until it has painted. It still spares macOS and Linux a flash.
const SPLASH_BG: Color = Color(0x45, 0x7e, 0x80, 0xff);

/// Once the splash is up, keep it up this long. Without it, a warm start can
/// paint the splash and tear it down inside ~300ms, which reads as a flicker.
const MIN_VISIBLE: Duration = Duration::from_millis(800);

/// Reveal the main window even if the frontend never signals: a JS exception
/// before hydration, or a broken build, must not leave a user staring at a
/// splash screen forever.
const FALLBACK_TIMEOUT: Duration = Duration::from_secs(12);

static REVEALED: AtomicBool = AtomicBool::new(false);
static SHOWN_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// Swap the windows. Idempotent: the frontend signal, the fallback timer, and
/// the splash's own close event all race here.
fn reveal(app: &AppHandle) {
    if REVEALED.swap(true, Ordering::SeqCst) {
        return;
    }

    // Show the main window before closing the splash, otherwise the desktop
    // shows through for a frame.
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        let _ = main.show();
        let _ = main.set_focus();
    }

    if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
        let _ = splash.close();
    }
}

/// Reveal the main window, but never before the splash has had its
/// [`MIN_VISIBLE`] moment on screen.
fn reveal_after_min_visible(app: &AppHandle) {
    if REVEALED.load(Ordering::SeqCst) {
        return;
    }

    let shown_at = SHOWN_AT.lock().ok().and_then(|guard| *guard);
    let remaining = match shown_at {
        // The splash never painted; drop it and go straight to the app.
        None => Duration::ZERO,
        Some(at) => MIN_VISIBLE.saturating_sub(at.elapsed()),
    };

    if remaining.is_zero() {
        reveal(app);
        return;
    }

    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(remaining);
        reveal(&app);
    });
}

/// Called by the frontend once React has mounted and fonts have settled.
#[tauri::command]
pub fn abs_app_ready(app: AppHandle) {
    reveal_after_min_visible(&app);
}

pub fn register(app: &AppHandle) {
    let splash = WebviewWindowBuilder::new(app, SPLASH_LABEL, WebviewUrl::App("splash.html".into()))
        .title("Artboard Studio")
        .inner_size(460.0, 300.0)
        .center()
        .visible(false)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .background_color(SPLASH_BG)
        .on_page_load(|window, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            // The app can win the race on a warm start. Don't flash a splash
            // that is already obsolete - and close it: reveal()'s own close can
            // land while this webview is still initializing and get lost, which
            // leaves a hidden zombie splash webview alive for the whole session.
            if REVEALED.load(Ordering::SeqCst) {
                let _ = window.close();
                return;
            }
            if let Ok(mut shown_at) = SHOWN_AT.lock() {
                *shown_at = Some(Instant::now());
            }
            let _ = window.show();
        })
        .build();

    let splash = match splash {
        Ok(splash) => splash,
        // Without a splash nothing would ever reveal the hidden main window.
        // Webview creation really does fail sometimes (a dying instance still
        // holding the WebView2 user-data folder is enough to do it).
        Err(_) => {
            reveal(app);
            return;
        }
    };

    // If the splash is destroyed some other way (Alt+F4, a window manager
    // closing it), reveal the main window rather than running headless.
    let handle = app.clone();
    splash.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            reveal(&handle);
        }
    });

    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(FALLBACK_TIMEOUT);
        reveal(&handle);
    });
}
