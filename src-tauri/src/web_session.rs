//! Embedded-webview assistant sessions ("the chromium part").
//!
//! Instead of a separate browser extension, the desktop app opens each provider
//! (Claude, ChatGPT, Gemini, ...) in its own hidden in-app window. The user
//! signs in there once; the session persists in the app's own WebView2 /
//! WKWebView profile. An initialization script (assistant/agent.js, built from
//! src/lib/ai/webAssistantAgent.ts) is injected into that window and drives the
//! page on-device. Same idea as gpt4free's nodriver providers, but the real
//! Chromium is the one the app already ships: no server, no bundled browser, no
//! cookies leaving the machine.
//!
//! Two channels:
//!   - shell -> page: `window.eval` calls `window.__absAgent.dispatch/.cancel`.
//!   - page -> shell: Tauri events on `WEB_EVENT_CHANNEL`. The main window's
//!     frontend listens to the same channel for progress/result/error; here we
//!     only react to `ready` (drive the queued job) and to run completion (hide
//!     the window again for reuse).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{
    AppHandle, Emitter, Listener, Manager, Runtime, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

/// Must match `WEB_EVENT_CHANNEL` in src/lib/ai/webAdapters.ts.
const WEB_EVENT_CHANNEL: &str = "abs-web-event";

/// The injected agent, bundled by `npm run build:assistant-agent`.
const AGENT_JS: &str = include_str!("../assistant/agent.js");

/// Provider id -> where a fresh chat lives. Keep in sync with webAdapters.ts.
const PROVIDERS: &[(&str, &str)] = &[
    ("claude", "https://claude.ai/new"),
    ("chatgpt", "https://chatgpt.com/"),
    ("gemini", "https://gemini.google.com/app"),
    ("copilot", "https://copilot.microsoft.com/"),
    ("deepseek", "https://chat.deepseek.com/"),
    ("qwen", "https://chat.qwen.ai/"),
    ("perplexity", "https://www.perplexity.ai/"),
    ("glm", "https://chat.z.ai/"),
];

fn provider_url(provider: &str) -> Option<&'static str> {
    PROVIDERS.iter().find(|(id, _)| *id == provider).map(|(_, url)| *url)
}

fn window_label(provider: &str) -> String {
    format!("assistant-{provider}")
}

#[derive(Clone)]
struct PendingJob {
    request_id: String,
    dispatch_js: String,
}

/// The job each provider window is currently expected to run, keyed by provider
/// id (one at a time). An entry stays queued until the agent acknowledges the
/// request with a progress/result/error event; every `ready` the page announces
/// (first load, or the navigation that follows a sign-in) re-dispatches it.
#[derive(Default)]
pub struct WebSessionState {
    pending: Mutex<HashMap<String, PendingJob>>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ImageArg {
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(rename = "dataUrl")]
    data_url: String,
}

#[derive(Serialize)]
struct DispatchJob {
    #[serde(rename = "requestId")]
    request_id: String,
    prompt: String,
    images: Vec<ImageArg>,
}

/// Shape of the events the injected agent emits. Only the fields we act on.
#[derive(Deserialize)]
struct AgentEvent {
    #[serde(rename = "type")]
    kind: String,
    provider: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    #[serde(rename = "loggedIn")]
    logged_in: Option<bool>,
    code: Option<String>,
}

/// Get the provider's window, creating it (with the agent injected) if it does
/// not exist yet. Returns whether it already existed. New windows start hidden
/// unless the user turned on "Show assistant window" in the Settings menu.
fn ensure_window<R: Runtime>(
    app: &AppHandle<R>,
    provider: &str,
) -> Result<(tauri::WebviewWindow<R>, bool), String> {
    let label = window_label(provider);
    if let Some(window) = app.get_webview_window(&label) {
        return Ok((window, true));
    }
    let url = provider_url(provider).ok_or_else(|| format!("unknown provider {provider}"))?;
    let parsed: tauri::Url = url.parse().map_err(|_| "invalid provider url".to_string())?;
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .title(format!("Sign in to your assistant ({provider})"))
        .initialization_script(AGENT_JS)
        .inner_size(980.0, 760.0)
        .visible(crate::settings::current(app).show_assistant_window)
        .build()
        .map_err(|e| e.to_string())?;

    // If the user closes the window while a job is queued (say, instead of
    // signing in), that job can never run; tell the app so it stops waiting.
    let handle = app.clone();
    let provider_name = provider.to_string();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let job = handle
                .state::<WebSessionState>()
                .pending
                .lock()
                .unwrap()
                .remove(&provider_name);
            if let Some(job) = job {
                let _ = handle.emit(
                    WEB_EVENT_CHANNEL,
                    json!({
                        "type": "error",
                        "provider": provider_name,
                        "requestId": job.request_id,
                        "code": "cancelled",
                        "message": "The assistant window was closed.",
                    }),
                );
            }
        }
    });
    Ok((window, false))
}

/// Queue a generate request: ensure the provider window, then dispatch now (if
/// the window was already open and the agent installed) or when it reports ready.
///
/// Async on purpose, like every command here that touches a window: synchronous
/// commands run on the main thread, and creating a webview window there
/// deadlocks on Windows (a blank window nothing can close, and a frozen app).
#[tauri::command]
pub async fn abs_web_start<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, WebSessionState>,
    provider: String,
    request_id: String,
    prompt: String,
    images: Vec<ImageArg>,
) -> Result<(), String> {
    let job = DispatchJob { request_id: request_id.clone(), prompt, images };
    let dispatch_js = format!(
        "window.__absAgent && window.__absAgent.dispatch({});",
        serde_json::to_string(&job).map_err(|e| e.to_string())?
    );

    let (window, existed) = ensure_window(&app, &provider)?;
    // Always queue the job, even for an existing window: an eval that lands
    // before the agent is installed (page still loading, or parked on a login
    // origin like accounts.google.com) is a silent no-op, and the job would be
    // lost. The run's result/error clears the entry; every `ready` (first
    // load, or the navigation after a sign-in) re-dispatches it until then.
    state
        .pending
        .lock()
        .unwrap()
        .insert(provider.clone(), PendingJob { request_id, dispatch_js: dispatch_js.clone() });
    if existed {
        // A window kept from an earlier run is hidden; reveal it when the user
        // asked to watch runs (Settings menu).
        if crate::settings::current(&app).show_assistant_window {
            let _ = window.show();
        }
        // The agent is likely already installed. Dispatch straight away; it does
        // its own signed-in check and reports `not-logged-in` if needed.
        if let Err(e) = window.eval(&dispatch_js) {
            state.pending.lock().unwrap().remove(&provider);
            return Err(e.to_string());
        }
    }
    Ok(())
}

/// Cancel an in-flight run. The matching agent stops at its next checkpoint,
/// and a job still queued for a sign-in is dropped.
#[tauri::command]
pub async fn abs_web_cancel<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, WebSessionState>,
    request_id: String,
) -> Result<(), String> {
    state.pending.lock().unwrap().retain(|_, job| job.request_id != request_id);
    let js = format!(
        "window.__absAgent && window.__absAgent.cancel({});",
        serde_json::to_string(&request_id).unwrap_or_else(|_| "\"\"".into())
    );
    for (provider, _) in PROVIDERS {
        if let Some(window) = app.get_webview_window(&window_label(provider)) {
            let _ = window.eval(&js);
        }
    }
    Ok(())
}

/// Open (and reveal) a provider window so the user can sign in manually.
#[tauri::command]
pub async fn abs_web_login<R: Runtime>(app: AppHandle<R>, provider: String) -> Result<(), String> {
    let (window, _existed) = ensure_window(&app, &provider)?;
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

/// Close a provider window (e.g. to sign out of that session's automation).
#[tauri::command]
pub async fn abs_web_close<R: Runtime>(app: AppHandle<R>, provider: String) {
    if let Some(window) = app.get_webview_window(&window_label(&provider)) {
        let _ = window.close();
    }
}

/// Forget every stored provider login so the next run starts from a clean
/// sign-in. Deletes the profile's cookie jar (where the providers keep their
/// sessions) and closes the assistant windows so no stale in-memory session
/// lingers. Cookies only: the app's own saved projects and run history
/// (IndexedDB / localStorage) are left untouched, since those are not cookies.
#[tauri::command]
pub async fn abs_web_clear_sessions<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, WebSessionState>,
) -> Result<(), String> {
    // Drop any queued jobs and tell the app, so nothing is left waiting on a
    // window we are about to close. The window's own Destroyed handler then
    // finds no job and stays quiet, so a run is not reported cancelled twice.
    let jobs: Vec<PendingJob> = {
        let mut pending = state.pending.lock().unwrap();
        let drained = pending.values().cloned().collect();
        pending.clear();
        drained
    };
    for job in jobs {
        let _ = app.emit(
            WEB_EVENT_CHANNEL,
            json!({
                "type": "error",
                "requestId": job.request_id,
                "code": "cancelled",
                "message": "Assistant sessions were cleared.",
            }),
        );
    }

    // Cookies are shared across every webview in the app's profile, so clearing
    // them from the main window signs the user out of all providers at once.
    clear_cookies(&app).await?;

    // Close the provider windows so a page still holding an in-memory session
    // does not linger; the next run rebuilds them from the now-empty cookie jar.
    for (provider, _) in PROVIDERS {
        if let Some(window) = app.get_webview_window(&window_label(provider)) {
            let _ = window.close();
        }
    }
    Ok(())
}

/// Delete the WebView2 profile's cookies via the main window's controller.
/// Windows only; other platforms report that clearing is unavailable rather
/// than pretending to have wiped a session that is still on disk.
#[cfg(windows)]
async fn clear_cookies<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or_else(|| "no app window available to clear cookies from".to_string())?;

    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    window
        .with_webview(move |webview| {
            let _ = tx.send(unsafe { delete_all_cookies(webview.controller()) });
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(8))
        .map_err(|_| "clearing cookies did not complete in time".to_string())?
}

#[cfg(not(windows))]
async fn clear_cookies<R: Runtime>(_app: &AppHandle<R>) -> Result<(), String> {
    Err("clearing sessions is only available on Windows".to_string())
}

/// Delete every cookie in the profile. Runs on the UI thread (`with_webview`).
/// `DeleteAllCookies` is synchronous, so no completion handler is needed.
#[cfg(windows)]
unsafe fn delete_all_cookies(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
    use windows::core::Interface;

    let core = controller.CoreWebView2().map_err(|e| e.to_string())?;
    let core2: ICoreWebView2_2 = core.cast().map_err(|e| e.to_string())?;
    let manager = core2.CookieManager().map_err(|e| e.to_string())?;
    manager.DeleteAllCookies().map_err(|e| e.to_string())?;
    Ok(())
}

/// Capture the current visual of a provider window as a PNG data URL, for the
/// operation timeline. Uses WebView2's CapturePreview, which renders the page
/// even while the window is hidden, so a background run is still traceable.
/// Windows only; returns an error (which the caller treats as "no screenshot")
/// on other platforms or if the window is not open.
#[tauri::command]
pub async fn abs_web_capture<R: Runtime>(
    app: AppHandle<R>,
    provider: String,
) -> Result<String, String> {
    let Some(window) = app.get_webview_window(&window_label(&provider)) else {
        return Err("assistant window is not open".to_string());
    };
    capture_window_png(&window).await
}

#[cfg(windows)]
async fn capture_window_png<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<u8>, String>>();
    // with_webview runs the closure on the UI thread. CapturePreview is async:
    // its completion handler fires later on that same thread's message loop,
    // which is free to pump because we block on the channel from this async
    // command's worker thread, not the UI thread.
    window
        .with_webview(move |webview| {
            if let Err(err) = unsafe { start_capture(webview.controller(), tx.clone()) } {
                let _ = tx.send(Err(err));
            }
        })
        .map_err(|e| e.to_string())?;

    let bytes = rx
        .recv_timeout(std::time::Duration::from_secs(8))
        .map_err(|_| "capture did not complete in time".to_string())??;
    Ok(format!("data:image/png;base64,{}", STANDARD.encode(&bytes)))
}

#[cfg(not(windows))]
async fn capture_window_png<R: Runtime>(_window: &tauri::WebviewWindow<R>) -> Result<String, String> {
    Err("screenshot capture is only available on Windows".to_string())
}

/// Kick off a CapturePreview into an in-memory stream; the completion handler
/// reads the PNG bytes back and sends them on `tx`. Must run on the UI thread.
#[cfg(windows)]
unsafe fn start_capture(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
) -> Result<(), String> {
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::UI::Shell::SHCreateMemStream;

    let core = controller.CoreWebView2().map_err(|e| e.to_string())?;
    let stream = SHCreateMemStream(None).ok_or_else(|| "could not allocate capture stream".to_string())?;
    let stream_for_handler = stream.clone();

    // The macro converts the completion HRESULT to a Result<()> before calling
    // us; Ok means the PNG has been written to the stream.
    let handler = CapturePreviewCompletedHandler::create(Box::new(
        move |outcome: windows::core::Result<()>| -> windows::core::Result<()> {
            let result = match outcome {
                Ok(()) => unsafe { read_stream_bytes(&stream_for_handler) },
                Err(e) => Err(format!("CapturePreview failed: {e}")),
            };
            let _ = tx.send(result);
            Ok(())
        },
    ));

    core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Read a memory IStream (positioned at its end after a write) into a Vec.
#[cfg(windows)]
unsafe fn read_stream_bytes(
    stream: &windows::Win32::System::Com::IStream,
) -> Result<Vec<u8>, String> {
    use std::ffi::c_void;
    use windows::Win32::System::Com::{STREAM_SEEK_END, STREAM_SEEK_SET};

    let mut end: u64 = 0;
    stream.Seek(0, STREAM_SEEK_END, Some(&mut end)).map_err(|e| e.to_string())?;
    stream.Seek(0, STREAM_SEEK_SET, None).map_err(|e| e.to_string())?;

    let len = end as usize;
    if len == 0 {
        return Err("capture produced no image".to_string());
    }

    let mut buf = vec![0u8; len];
    let mut read: u32 = 0;
    stream
        .Read(buf.as_mut_ptr() as *mut c_void, len as u32, Some(&mut read))
        .ok()
        .map_err(|e| e.to_string())?;
    buf.truncate(read as usize);
    Ok(buf)
}

fn on_agent_event<R: Runtime>(app: &AppHandle<R>, event: AgentEvent) {
    let Some(provider) = event.provider else { return };
    let state = app.state::<WebSessionState>();

    // Only a finished run (result, or any error other than "sign in first")
    // clears the queue entry. Progress alone must not: a site can accept the
    // dispatch and then navigate away mid-run (claude.ai's logged-out decoy
    // composer ends at /logout), and the `ready` after the real sign-in has to
    // be able to rerun the job. A not-logged-in failure stays queued too.
    if matches!(event.kind.as_str(), "result" | "error")
        && event.code.as_deref() != Some("not-logged-in")
    {
        if let Some(rid) = event.request_id.as_deref() {
            let mut pending = state.pending.lock().unwrap();
            if pending.get(&provider).is_some_and(|job| job.request_id == rid) {
                pending.remove(&provider);
            }
        }
    }

    match event.kind.as_str() {
        "ready" => {
            let job = state.pending.lock().unwrap().get(&provider).cloned();
            let Some(job) = job else { return };
            if event.logged_in == Some(true) {
                // Dispatch, but keep the entry queued until the agent
                // acknowledges: a navigation racing this eval would eat it.
                if let Some(window) = app.get_webview_window(&window_label(&provider)) {
                    let _ = window.eval(&job.dispatch_js);
                    // If this window was revealed for a manual sign-in, tuck it
                    // away again now that the user is in, so the rest of the run
                    // happens in the background instead of showing the typing and
                    // screenshots. (On a first load it is already hidden, so this
                    // is a harmless no-op.) Honour the "show assistant window"
                    // preference: leave it up when the user asked to watch.
                    if !crate::settings::current(app).show_assistant_window {
                        let _ = window.hide();
                    }
                }
            } else {
                // Not signed in: reveal the window for a manual login and tell
                // the app to wait. The job stays queued; the `ready` after the
                // sign-in navigation (or the agent's own re-probe) runs it.
                if let Some(window) = app.get_webview_window(&window_label(&provider)) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit(
                    WEB_EVENT_CHANNEL,
                    json!({ "type": "need-login", "provider": provider, "requestId": job.request_id }),
                );
            }
        }
        "result" | "error" => {
            let not_logged_in = event.code.as_deref() == Some("not-logged-in");
            // The run that just ended freed the agent (its one-run-at-a-time
            // guard silently drops dispatches while busy). If a different job
            // is queued for this provider - dispatched while the old run was
            // still draining, e.g. cancel then an immediate retry - no `ready`
            // will ever rerun it on this page, so start it now.
            let next = if not_logged_in {
                None
            } else {
                state
                    .pending
                    .lock()
                    .unwrap()
                    .get(&provider)
                    .filter(|job| event.request_id.as_deref() != Some(job.request_id.as_str()))
                    .cloned()
            };
            if let Some(window) = app.get_webview_window(&window_label(&provider)) {
                if let Some(job) = next {
                    let _ = window.eval(&job.dispatch_js);
                } else if not_logged_in {
                    // Failed because the user is signed out: keep the window
                    // visible so they can log in.
                    let _ = window.show();
                    let _ = window.set_focus();
                } else if !crate::settings::current(app).show_assistant_window {
                    // A run finished: tuck the window away for reuse, unless the
                    // user chose to watch runs (Settings menu).
                    let _ = window.hide();
                }
            }
        }
        _ => {}
    }
}

/// Register the page -> shell listener. Call once from `setup`.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let handle = app.clone();
    app.listen_any(WEB_EVENT_CHANNEL, move |event| {
        if let Ok(parsed) = serde_json::from_str::<AgentEvent>(event.payload()) {
            on_agent_event(&handle, parsed);
        }
    });
}
