//! One-shot loopback listener for desktop OAuth sign-in.
//!
//! The packaged app is served from a custom protocol (`tauri://localhost` /
//! `http://tauri.localhost`), which Google will not accept as an authorized
//! JavaScript origin, and there is no public URL for a provider to redirect
//! back to. The installed-app flow solves both: we bind an ephemeral port on
//! 127.0.0.1, send the user to the provider in their real system browser
//! (where they are usually already signed in), and catch the redirect here.
//!
//! It also buys persistence: this flow returns a refresh token, so a desktop
//! sign-in survives restarts, which the browser token flow cannot do.
//!
//! A webview cannot listen on a socket, so this has to be native. Same
//! tiny_http dependency the MCP server already uses.
//!
//! Lifecycle is deliberately explicit: `abs_oauth_start` binds and reports the
//! port, the frontend opens the browser, `abs_oauth_await` blocks for the
//! redirect, and `abs_oauth_cancel` releases the socket on any early exit.
//! Binding before opening the browser removes the race where the provider
//! redirects to a port nobody is listening on yet.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tiny_http::{Header, Response, Server};

/// Only ever holds sockets for in-flight sign-ins; normally empty.
#[derive(Default)]
pub struct OauthState {
    servers: Mutex<HashMap<u16, Arc<Server>>>,
}

#[derive(Serialize)]
pub struct OauthStart {
    port: u16,
    redirect_uri: String,
}

#[derive(Serialize, Default)]
pub struct OauthResult {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// What the browser tab shows once the provider has redirected back.
const DONE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\">\
<title>Signed in</title><style>body{font-family:system-ui,sans-serif;\
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;\
background:#0b0d10;color:#e6e8eb}div{text-align:center;line-height:1.6}\
h1{font-size:1.1rem;font-weight:600;margin:0 0 .25rem}\
p{margin:0;opacity:.7;font-size:.9rem}</style></head><body><div>\
<h1>You're signed in</h1><p>You can close this tab and return to \
Open Screenshot Generator.</p></div></body></html>";

fn html_response(body: &'static str) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_string(body);
    if let Ok(header) = Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]) {
        response = response.with_header(header);
    }
    response
}

/// Pull `code`/`state`/`error` out of the redirect's query string.
fn parse_query(url: &str) -> OauthResult {
    let mut result = OauthResult::default();
    let query = match url.split_once('?') {
        Some((_, q)) => q,
        None => return result,
    };
    for pair in query.split('&') {
        let (key, value) = match pair.split_once('=') {
            Some(kv) => kv,
            None => continue,
        };
        let decoded = percent_decode(value);
        match key {
            "code" => result.code = Some(decoded),
            "state" => result.state = Some(decoded),
            // error_description is friendlier when the provider sends both.
            "error" => {
                if result.error.is_none() {
                    result.error = Some(decoded)
                }
            }
            "error_description" => result.error = Some(decoded),
            _ => {}
        }
    }
    result
}

/// Minimal percent-decoding: enough for OAuth codes, no extra dependency.
fn percent_decode(value: &str) -> String {
    let bytes = value.replace('+', " ").into_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Bind a loopback port and report the redirect URI to use for this sign-in.
#[tauri::command]
pub fn abs_oauth_start(state: tauri::State<'_, OauthState>) -> Result<OauthStart, String> {
    // Port 0: let the OS pick a free one. Google allows any loopback port for
    // installed apps, so nothing has to be registered up front.
    let server = Server::http(("127.0.0.1", 0))
        .map_err(|e| format!("could not open a local port for sign-in: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or_else(|| "could not read the local sign-in port".to_string())?
        .port();

    state.servers.lock().unwrap().insert(port, Arc::new(server));
    Ok(OauthStart {
        port,
        redirect_uri: format!("http://127.0.0.1:{port}"),
    })
}

/// Wait for the provider to redirect back, then hand the code to the frontend.
#[tauri::command]
pub async fn abs_oauth_await(
    state: tauri::State<'_, OauthState>,
    port: u16,
    timeout_secs: Option<u64>,
) -> Result<OauthResult, String> {
    // Take the server out of the map: this consumes the listener, so a second
    // await on the same port cannot hang forever waiting on a dead socket.
    let server = state
        .servers
        .lock()
        .unwrap()
        .remove(&port)
        .ok_or_else(|| "this sign-in is no longer waiting".to_string())?;

    let deadline = Instant::now() + Duration::from_secs(timeout_secs.unwrap_or(300));

    // recv_timeout blocks, so keep it off the async runtime's worker threads.
    tauri::async_runtime::spawn_blocking(move || {
        while Instant::now() < deadline {
            match server.recv_timeout(Duration::from_millis(400)) {
                Ok(Some(request)) => {
                    let url = request.url().to_string();
                    // Browsers ask for /favicon.ico on their own; that is not
                    // the redirect, so answer it and keep waiting.
                    if url.starts_with("/favicon") {
                        let _ = request.respond(Response::empty(404));
                        continue;
                    }
                    let result = parse_query(&url);
                    if result.code.is_none() && result.error.is_none() {
                        let _ = request.respond(Response::empty(400));
                        continue;
                    }
                    let _ = request.respond(html_response(DONE_PAGE));
                    return Ok(result);
                }
                Ok(None) => {} // timed out; re-check the deadline
                Err(e) => return Err(format!("the sign-in listener failed: {e}")),
            }
        }
        Err("sign-in timed out".to_string())
    })
    .await
    .map_err(|e| format!("the sign-in listener stopped unexpectedly: {e}"))?
}

/// Release a listener that was started but never awaited. Safe to call twice.
#[tauri::command]
pub fn abs_oauth_cancel(state: tauri::State<'_, OauthState>, port: u16) {
    state.servers.lock().unwrap().remove(&port);
}
