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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tiny_http::{Header, Response, Server};

/// Only ever holds sockets for in-flight sign-ins; normally empty.
#[derive(Default)]
pub struct OauthState {
    servers: Mutex<HashMap<u16, Arc<OauthListener>>>,
}

struct OauthListener {
    server: Server,
    cancelled: AtomicBool,
    waiting: AtomicBool,
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

impl OauthState {
    fn start(&self) -> Result<OauthStart, String> {
        // Port 0: let the OS pick a free one. Google allows any loopback port for
        // installed apps, so nothing has to be registered up front.
        let server = Server::http(("127.0.0.1", 0))
            .map_err(|e| format!("could not open a local port for sign-in: {e}"))?;
        let port = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| "could not read the local sign-in port".to_string())?
            .port();

        self.servers.lock().unwrap().insert(
            port,
            Arc::new(OauthListener {
                server,
                cancelled: AtomicBool::new(false),
                waiting: AtomicBool::new(false),
            }),
        );
        Ok(OauthStart {
            port,
            redirect_uri: format!("http://127.0.0.1:{port}"),
        })
    }

    fn claim(&self, port: u16) -> Result<Arc<OauthListener>, String> {
        let servers = self.servers.lock().unwrap();
        let listener = servers
            .get(&port)
            .ok_or_else(|| "this sign-in is no longer waiting".to_string())?;
        if listener.waiting.swap(true, Ordering::AcqRel) {
            return Err("this sign-in is no longer waiting".to_string());
        }
        Ok(Arc::clone(listener))
    }

    fn finish(&self, port: u16, listener: &Arc<OauthListener>) {
        let mut servers = self.servers.lock().unwrap();
        if servers
            .get(&port)
            .is_some_and(|registered| Arc::ptr_eq(registered, listener))
        {
            servers.remove(&port);
        }
    }

    fn cancel(&self, port: u16) {
        let listener = self.servers.lock().unwrap().remove(&port);
        if let Some(listener) = listener {
            listener.cancelled.store(true, Ordering::Release);
            listener.server.unblock();
        }
    }
}

fn wait_for_redirect(listener: &OauthListener, timeout_secs: u64) -> Result<OauthResult, String> {
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    loop {
        if listener.cancelled.load(Ordering::Acquire) {
            return Err("sign-in cancelled".to_string());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("sign-in timed out".to_string());
        }
        let received = listener.server.recv_timeout(remaining);
        if listener.cancelled.load(Ordering::Acquire) {
            return Err("sign-in cancelled".to_string());
        }
        match received {
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
                if listener.cancelled.load(Ordering::Acquire) {
                    return Err("sign-in cancelled".to_string());
                }
                return Ok(result);
            }
            Ok(None) => {}
            Err(e) => return Err(format!("the sign-in listener failed: {e}")),
        }
    }
}

/// Bind a loopback port and report the redirect URI to use for this sign-in.
#[tauri::command]
pub fn abs_oauth_start(state: tauri::State<'_, OauthState>) -> Result<OauthStart, String> {
    state.start()
}

/// Wait for the provider to redirect back, then hand the code to the frontend.
#[tauri::command]
pub async fn abs_oauth_await(
    state: tauri::State<'_, OauthState>,
    port: u16,
    timeout_secs: Option<u64>,
) -> Result<OauthResult, String> {
    let listener = state.claim(port)?;
    let waiting_listener = Arc::clone(&listener);

    // recv_timeout blocks, so keep it off the async runtime's worker threads.
    let result = tauri::async_runtime::spawn_blocking(move || {
        wait_for_redirect(&waiting_listener, timeout_secs.unwrap_or(300))
    })
    .await;
    state.finish(port, &listener);
    result.map_err(|e| format!("the sign-in listener stopped unexpectedly: {e}"))?
}

/// Stop a pending sign-in and wake its waiter. Safe to call twice.
#[tauri::command]
pub fn abs_oauth_cancel(state: tauri::State<'_, OauthState>, port: u16) {
    state.cancel(port);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::mpsc;
    use std::thread;

    fn request(port: u16, path: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn cancel_before_await_releases_the_listener() {
        let state = OauthState::default();
        let started = state.start().unwrap();
        let listener = Arc::downgrade(state.servers.lock().unwrap().get(&started.port).unwrap());

        state.cancel(started.port);
        state.cancel(started.port);

        assert!(listener.upgrade().is_none());
        assert!(state.claim(started.port).is_err());
    }

    #[test]
    fn only_one_waiter_can_claim_a_listener() {
        let state = OauthState::default();
        let started = state.start().unwrap();
        let listener = state.claim(started.port).unwrap();

        assert!(state.claim(started.port).is_err());
        state.cancel(started.port);
        assert!(wait_for_redirect(&listener, 30).is_err());
    }

    #[test]
    fn cancel_wakes_an_active_waiter_and_releases_the_listener() {
        let state = OauthState::default();
        let started = state.start().unwrap();
        let listener = state.claim(started.port).unwrap();
        let weak_listener = Arc::downgrade(&listener);
        let (sender, receiver) = mpsc::channel();
        let waiter = thread::spawn(move || {
            let result = wait_for_redirect(&listener, 30);
            sender.send(result).unwrap();
        });

        assert!(request(started.port, "/favicon.ico").starts_with("HTTP/1.1 404"));
        state.cancel(started.port);
        state.cancel(started.port);

        let result = receiver.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(result.err().as_deref(), Some("sign-in cancelled"));
        waiter.join().unwrap();
        assert!(weak_listener.upgrade().is_none());
        assert!(state.claim(started.port).is_err());
    }

    #[test]
    fn a_redirect_still_returns_its_code_and_state() {
        let state = OauthState::default();
        let started = state.start().unwrap();
        let listener = state.claim(started.port).unwrap();
        let waiting_listener = Arc::clone(&listener);
        let waiter = thread::spawn(move || wait_for_redirect(&waiting_listener, 30));

        assert!(
            request(started.port, "/?code=auth%2Bcode&state=expected").starts_with("HTTP/1.1 200")
        );
        let result = waiter.join().unwrap().unwrap();
        state.finish(started.port, &listener);

        assert_eq!(result.code.as_deref(), Some("auth+code"));
        assert_eq!(result.state.as_deref(), Some("expected"));
        assert!(state.servers.lock().unwrap().is_empty());
    }
}
