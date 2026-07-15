//! Opt-in local MCP server ("design tools for external AI agents").
//!
//! When the user turns it on (Settings menu, off by default), the app hosts a
//! Model Context Protocol server on `http://127.0.0.1:<port>/mcp` using the
//! Streamable HTTP transport. Any MCP client (Claude Desktop, Claude Code,
//! Cursor, ...) can then drive Open Screenshot Generator: list/create artboards, add and
//! edit elements, set backgrounds, and render an artboard to PNG.
//!
//! Split of responsibilities:
//!   - Rust (this file) owns the *transport*: the TCP socket, HTTP framing, the
//!     MCP session header, and clean start/stop. A webview cannot listen on a
//!     socket, so this has to live natively.
//!   - The frontend owns the *tools*: the design state and every design action
//!     live in React (src/lib/mcp/desktopMcpServer.ts). So each JSON-RPC request
//!     is bridged to the main window over a Tauri event and its response comes
//!     back through the `abs_mcp_respond` command. Rust never needs to know a
//!     tool's schema; it just relays the JSON-RPC message and the reply.
//!
//! Only responds with `application/json` (never opens an SSE stream), which the
//! spec allows for a server that initiates nothing on its own. Localhost bind,
//! so it is reachable only from the user's machine.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tiny_http::{Header, Method, Request, Response, Server};

/// Event the main-window frontend listens on to receive a bridged JSON-RPC
/// request. Must match `MCP_REQUEST_EVENT` in src/lib/mcp/desktopMcpServer.ts.
const MCP_REQUEST_EVENT: &str = "abs-mcp-request";

/// Preferred port; if busy we scan upward so a second instance (or an unrelated
/// listener) does not stop the server from coming up. The chosen port is
/// reported back through `abs_mcp_status` so the UI shows the real URL.
const DEFAULT_PORT: u16 = 8722;
const PORT_SCAN: u16 = 20;

/// How long a bridged request waits for the frontend before it gives up. Large
/// because a tool like `export_png` renders the canvas, but bounded so a stuck
/// UI cannot hang an HTTP client forever.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(180);

/// Max request body we will buffer (generous for base64 image arguments).
const MAX_BODY: u64 = 32 * 1024 * 1024;

/// Senders keyed by an internal call id: a bridged request registers one, then
/// blocks on its receiver until `abs_mcp_respond` delivers the frontend's reply.
type Pending = Arc<Mutex<HashMap<String, Sender<Value>>>>;

struct RunningServer {
    port: u16,
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

#[derive(Default)]
pub struct McpState {
    server: Mutex<Option<RunningServer>>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

#[derive(Serialize, Clone)]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub url: Option<String>,
}

impl McpStatus {
    fn running(port: u16) -> Self {
        McpStatus {
            running: true,
            port: Some(port),
            url: Some(format!("http://127.0.0.1:{port}/mcp")),
        }
    }
    fn stopped() -> Self {
        McpStatus { running: false, port: None, url: None }
    }
}

fn status_of(state: &McpState) -> McpStatus {
    match state.server.lock().unwrap().as_ref() {
        Some(s) => McpStatus::running(s.port),
        None => McpStatus::stopped(),
    }
}

fn bind_server() -> Result<(Server, u16), String> {
    let mut last_err = String::new();
    for port in DEFAULT_PORT..DEFAULT_PORT.saturating_add(PORT_SCAN) {
        match Server::http(("127.0.0.1", port)) {
            Ok(server) => return Ok((server, port)),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!("could not bind a local port for the MCP server: {last_err}"))
}

/// Start the server if it is not already running. Idempotent: returns the
/// current status either way.
fn start<R: Runtime>(app: &AppHandle<R>, state: &McpState) -> Result<McpStatus, String> {
    let mut guard = state.server.lock().unwrap();
    if let Some(s) = guard.as_ref() {
        return Ok(McpStatus::running(s.port));
    }

    let (server, port) = bind_server()?;
    let server = Arc::new(server);
    let shutdown = Arc::new(AtomicBool::new(false));

    let accept_server = server.clone();
    let accept_shutdown = shutdown.clone();
    let app_handle = app.clone();
    let pending = state.pending.clone();
    let next_id = state.next_id.clone();

    let thread = std::thread::spawn(move || {
        accept_loop(accept_server, accept_shutdown, app_handle, pending, next_id);
    });

    *guard = Some(RunningServer { port, shutdown, thread: Some(thread) });
    Ok(McpStatus::running(port))
}

/// Stop the server (if running) and wait for the accept thread to unwind.
fn stop(state: &McpState) -> McpStatus {
    if let Some(mut s) = state.server.lock().unwrap().take() {
        s.shutdown.store(true, Ordering::Relaxed);
        if let Some(thread) = s.thread.take() {
            let _ = thread.join();
        }
    }
    McpStatus::stopped()
}

/// Accept loop: polls with a timeout so the shutdown flag is noticed promptly,
/// and hands each request to its own short-lived thread so a slow frontend
/// round-trip never blocks accepting the next connection.
fn accept_loop<R: Runtime>(
    server: Arc<Server>,
    shutdown: Arc<AtomicBool>,
    app: AppHandle<R>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
) {
    while !shutdown.load(Ordering::Relaxed) {
        match server.recv_timeout(Duration::from_millis(400)) {
            Ok(Some(request)) => {
                let app = app.clone();
                let pending = pending.clone();
                let next_id = next_id.clone();
                std::thread::spawn(move || handle_request(request, app, pending, next_id));
            }
            Ok(None) => {} // timed out; loop and re-check the shutdown flag
            Err(_) => break,
        }
    }
}

fn cors_headers() -> Vec<Header> {
    // Native MCP clients do not send an Origin; browser-hosted ones do. A
    // permissive localhost policy keeps both happy without gating anything of
    // value (the server is bound to 127.0.0.1 already).
    [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id, Mcp-Protocol-Version, Authorization"),
        ("Access-Control-Expose-Headers", "Mcp-Session-Id"),
    ]
    .iter()
    .filter_map(|(k, v)| Header::from_bytes(k.as_bytes(), v.as_bytes()).ok())
    .collect()
}

fn respond_json(request: Request, status: u16, body: String, session_id: Option<String>) {
    let mut response = Response::from_string(body).with_status_code(status);
    if let Ok(h) = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
        response = response.with_header(h);
    }
    if let Some(sid) = session_id {
        if let Ok(h) = Header::from_bytes(&b"Mcp-Session-Id"[..], sid.as_bytes()) {
            response = response.with_header(h);
        }
    }
    for h in cors_headers() {
        response = response.with_header(h);
    }
    let _ = request.respond(response);
}

fn respond_empty(request: Request, status: u16) {
    let mut response = Response::empty(status);
    for h in cors_headers() {
        response = response.with_header(h);
    }
    let _ = request.respond(response);
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// True for a JSON-RPC *request* (must be answered): has a method and a
/// non-null id. A message with a method but no id is a notification; anything
/// else is a stray response we simply acknowledge.
fn is_request(msg: &Value) -> bool {
    msg.get("method").and_then(Value::as_str).is_some()
        && !matches!(msg.get("id"), None | Some(Value::Null))
}

fn handle_request<R: Runtime>(
    mut request: Request,
    app: AppHandle<R>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
) {
    match request.method() {
        Method::Options => return respond_empty(request, 204),
        // We never open a server->client SSE stream, so there is nothing to GET.
        Method::Get => return respond_empty(request, 405),
        // Session teardown is a no-op here (state lives in the frontend).
        Method::Delete => return respond_empty(request, 200),
        Method::Post => {}
        _ => return respond_empty(request, 405),
    }

    // Buffer the body (size-capped).
    let mut body = String::new();
    if request.as_reader().take(MAX_BODY).read_to_string(&mut body).is_err() {
        return respond_json(request, 400, rpc_error(Value::Null, -32700, "could not read request body").to_string(), None);
    }

    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => {
            return respond_json(request, 400, rpc_error(Value::Null, -32700, "invalid JSON").to_string(), None)
        }
    };

    match parsed {
        Value::Object(_) => {
            if !is_request(&parsed) {
                // Notification (e.g. notifications/initialized) or stray reply:
                // acknowledge without bridging; nothing is expected back.
                return respond_empty(request, 202);
            }
            let is_initialize = parsed.get("method").and_then(Value::as_str) == Some("initialize");
            let response = bridge_request(&app, &pending, &next_id, parsed);
            let session = is_initialize.then(|| session_id(&next_id));
            respond_json(request, 200, response.to_string(), session);
        }
        Value::Array(items) => {
            // Batch: answer each request; drop notifications. Rarely used by
            // modern clients, but cheap to support.
            let mut out: Vec<Value> = Vec::new();
            for item in items {
                if is_request(&item) {
                    out.push(bridge_request(&app, &pending, &next_id, item));
                }
            }
            if out.is_empty() {
                respond_empty(request, 202);
            } else {
                respond_json(request, 200, Value::Array(out).to_string(), None);
            }
        }
        _ => respond_json(request, 400, rpc_error(Value::Null, -32600, "invalid request").to_string(), None),
    }
}

fn session_id(next_id: &AtomicU64) -> String {
    format!("abs-mcp-{}", next_id.fetch_add(1, Ordering::Relaxed))
}

/// Forward one JSON-RPC request to the frontend and block for its reply.
fn bridge_request<R: Runtime>(
    app: &AppHandle<R>,
    pending: &Pending,
    next_id: &AtomicU64,
    message: Value,
) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);

    if app.get_webview_window("main").is_none() {
        return rpc_error(id, -32000, "the Open Screenshot Generator window is not available");
    }

    let call_id = format!("call-{}", next_id.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = channel::<Value>();
    pending.lock().unwrap().insert(call_id.clone(), tx);

    let emitted = app.emit_to("main", MCP_REQUEST_EVENT, json!({ "callId": call_id, "message": message }));
    if emitted.is_err() {
        pending.lock().unwrap().remove(&call_id);
        return rpc_error(id, -32000, "could not reach the app UI");
    }

    let result = match rx.recv_timeout(RESPONSE_TIMEOUT) {
        Ok(v) => v,
        Err(_) => rpc_error(id, -32001, "the app did not respond in time"),
    };
    pending.lock().unwrap().remove(&call_id);
    result
}

// ---------------------------------------------------------------------------
// Tauri commands + setup hooks
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn abs_mcp_start<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, McpState>,
) -> Result<McpStatus, String> {
    start(&app, &state)
}

#[tauri::command]
pub async fn abs_mcp_stop(state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    Ok(stop(&state))
}

#[tauri::command]
pub fn abs_mcp_status(state: tauri::State<'_, McpState>) -> McpStatus {
    status_of(&state)
}

/// The frontend calls this with the JSON-RPC response for a previously bridged
/// request, unblocking the waiting HTTP handler.
#[tauri::command]
pub fn abs_mcp_respond(state: tauri::State<'_, McpState>, call_id: String, response: Value) {
    if let Some(tx) = state.pending.lock().unwrap().remove(&call_id) {
        let _ = tx.send(response);
    }
}

/// Turn the server on or off to match a setting change, and tell the frontend
/// the new status (so it can surface the connection URL). Called from the
/// Settings menu handler and at startup.
pub fn apply_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    let state = app.state::<McpState>();
    let status = if enabled {
        start(app, &state).unwrap_or_else(|_| McpStatus::stopped())
    } else {
        stop(&state)
    };
    let _ = app.emit("abs-mcp-status", &status);
}

/// Start the server at launch if the user had it enabled last session.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    if crate::settings::current(app).mcp_server_enabled {
        let state = app.state::<McpState>();
        let _ = start(app, &state);
    }
}
