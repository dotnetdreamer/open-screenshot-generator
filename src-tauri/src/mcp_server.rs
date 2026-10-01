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

/// How long a bridged request waits for the frontend before it gives up.
///
/// Short on purpose. MCP clients keep one HTTP connection alive and tiny_http
/// only reads the next request on a connection once the current one has been
/// answered, so a single tool call the webview never answers stalls *every*
/// later request behind it — `initialize` included. With the old flat 180s
/// budget that read as a permanently wedged server that only an app restart
/// fixed. A tight default means one bad call costs one bad call.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(12);

/// Budget for the tools that genuinely take a while: rendering the canvas,
/// writing a file, or rebuilding the whole project.
const SLOW_RESPONSE_TIMEOUT: Duration = Duration::from_secs(180);

/// `tools/call` names that get SLOW_RESPONSE_TIMEOUT. Keep in sync with the
/// tool table in src/lib/mcp/desktopMcpServer.ts — a name missing from here
/// just gets the short budget, which is the safe direction to be wrong in.
const SLOW_TOOLS: &[&str] = &[
    "export_png",
    "export_all",
    "create_project_from_template",
    // Replaces the open project's boards with a filled template copy.
    "apply_template",
    "open_project",
    "upload_asset",
    // Reads a picture of up to 20 MB from the agent's code folder, through
    // claude_code.rs, and stores it.
    "import_project_image",
    // Fetches and decodes a screen recording, which can be tens of megabytes.
    "upload_recording",
    "add_elements",
    "duplicate_artboard",
    "update_artboard",
    // Machine translation: one request per distinct string, per language.
    "translate_locales",
    "add_locales",
];

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
    /// The secret the app's own Claude Code agent sends as a bearer token.
    /// Minted on first use and kept for the life of the process.
    agent_token: Mutex<Option<String>>,
    /// Proves an event came from this process. Any window allowed to emit
    /// events (the assistant windows, which host third-party sites) could
    /// otherwise emit a tool call in the bridge's name and the editor would run
    /// it. Only the editor window can read it (abs_mcp_bridge_nonce).
    bridge_nonce: Mutex<Option<String>>,
}

/// The nonce every bridged request and every agent event carries.
pub fn bridge_nonce<R: Runtime>(app: &AppHandle<R>) -> String {
    app.state::<McpState>().bridge_nonce.lock().unwrap().get_or_insert_with(fresh_token).clone()
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
        Some(s) if s.accepting() => McpStatus::running(s.port),
        _ => McpStatus::stopped(),
    }
}

impl RunningServer {
    /// The accept loop is still going. tiny_http stops accepting for good after
    /// an accept error (a client that resets before it is accepted is enough),
    /// and accept_loop then returns, leaving an entry for a port nobody serves.
    fn accepting(&self) -> bool {
        self.thread.as_ref().is_some_and(|thread| !thread.is_finished())
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
        if s.accepting() {
            return Ok(McpStatus::running(s.port));
        }
        // Dead: start again rather than hand out a URL nobody answers.
        if let Some(dead) = guard.take() {
            shut_down(dead);
        }
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

/// Tell the accept thread to stop and wait for it to unwind, then for the port
/// to come free.
fn shut_down(mut server: RunningServer) {
    server.shutdown.store(true, Ordering::Relaxed);
    if let Some(thread) = server.thread.take() {
        let _ = thread.join();
    }
    // Joining ours is not enough: tiny_http closes the listening socket on a
    // thread of its own, a moment after the Server is dropped. A start right
    // behind this one would otherwise find the port taken and move to the
    // next, where clients set up for this one never look.
    for _ in 0..25 {
        if std::net::TcpListener::bind(("127.0.0.1", server.port)).is_ok() {
            break;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Stop the server unless something still needs it: the app's own agent with
/// a process running or starting, and, when `keep_if_enabled` is set, the
/// user's external-tools switch.
///
/// Decided and done under the server lock. A start counts itself
/// (claude_code's `starting`) before ensure_running takes that lock, so it
/// either sees the count here and keeps the server, or waits and starts a new
/// one. The lock is held through shut_down as well, which waits for the port to
/// come free, so that new one gets the port back instead of the next one along.
fn stop_if_unused<R: Runtime>(app: &AppHandle<R>, state: &McpState, keep_if_enabled: bool) {
    let mut guard = state.server.lock().unwrap();
    if crate::claude_code::has_sessions(app) {
        return;
    }
    if keep_if_enabled && crate::settings::current(app).mcp_server_enabled {
        return;
    }
    if let Some(server) = guard.take() {
        shut_down(server);
    }
}

/// An agent process has ended. With the switch off nothing else needs the
/// server, so it stops until the agent starts again. The switch is read under
/// the server lock and saved before apply_enabled runs, so someone turning it
/// on at this moment keeps a running server either way.
pub fn release_after_agent<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<McpState>();
    stop_if_unused(app, &state, true);
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

/// Whether a request carries the app's own Claude Code agent's token. Checked
/// whatever the Settings switch says, and handed to the page with every
/// bridged request as `agent`, since only the agent may reach the code folders
/// its chat holds (import_project_image).
fn from_agent<R: Runtime>(app: &AppHandle<R>, request: &Request) -> bool {
    let token = app.state::<McpState>().agent_token.lock().unwrap().clone();
    let values = request
        .headers()
        .iter()
        .filter(|header| header.field.equiv("Authorization"))
        .map(|header| header.value.as_str());
    bearer_matches(values, token.as_deref())
}

/// Whether one of a request's Authorization values is exactly
/// `Bearer <token>`. Never before a token has been minted.
fn bearer_matches<'a>(auth_values: impl IntoIterator<Item = &'a str>, token: Option<&str>) -> bool {
    let Some(token) = token.filter(|token| !token.is_empty()) else {
        return false;
    };
    let expected = format!("Bearer {token}");
    auth_values.into_iter().any(|value| value == expected)
}

/// Who may call the tools.
///
/// With the Settings switch on, any local client: the user opened the tools up
/// on purpose. With it off, the server is only running because the app's own
/// Claude Code agent needed it, and only a request carrying that agent's token
/// gets through. Otherwise starting the agent would quietly hand every program
/// on the machine, and every web page the browser lets reach localhost, a way
/// to read and rewrite the user's projects.
fn authorized(agent: bool, switch_on: bool) -> bool {
    agent || switch_on
}

/// 128 bits of OS randomness in a 64-character string. RandomState seeds its
/// SipHash key from the OS random source once per thread and steps it for each
/// new instance, so the four words stretch that one 128-bit key rather than
/// adding to it. Plenty for a local bearer token, and it saves a dependency.
fn fresh_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    (0..4u64)
        .map(|round| {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_u64(round);
            hasher.write_u128(nanos);
            hasher.write_u32(std::process::id());
            format!("{:016x}", hasher.finish())
        })
        .collect()
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

    let agent = from_agent(&app, &request);
    if !authorized(agent, crate::settings::current(&app).mcp_server_enabled) {
        return respond_json(
            request,
            401,
            rpc_error(
                Value::Null,
                -32001,
                "This server only answers the app's own agent right now. Turn on Settings > Run MCP server for external AI tools to connect other clients.",
            )
            .to_string(),
            None,
        );
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
            let response = bridge_request(&app, &pending, &next_id, parsed, agent);
            let session = is_initialize.then(|| session_id(&next_id));
            respond_json(request, 200, response.to_string(), session);
        }
        Value::Array(items) => {
            // Batch: answer each request; drop notifications. Rarely used by
            // modern clients, but cheap to support.
            let mut out: Vec<Value> = Vec::new();
            for item in items {
                if is_request(&item) {
                    out.push(bridge_request(&app, &pending, &next_id, item, agent));
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

/// How long this particular message may take. Everything is on the tight
/// default except the handful of tools that render or persist.
fn timeout_for(message: &Value) -> Duration {
    if message.get("method").and_then(Value::as_str) != Some("tools/call") {
        return RESPONSE_TIMEOUT;
    }
    let name = message.pointer("/params/name").and_then(Value::as_str).unwrap_or_default();
    if SLOW_TOOLS.contains(&name) {
        SLOW_RESPONSE_TIMEOUT
    } else {
        RESPONSE_TIMEOUT
    }
}

/// Forward one JSON-RPC request to the frontend and block for its reply.
/// `agent` says the request carried the built-in agent's token (from_agent).
///
/// The event's payload is `{ callId, message, nonce, agent, folders }`.
/// `folders` is true for an agent request while a process that reads code
/// folders is alive, read here as the request is bridged, so the page's web
/// link guard need not go by what the page believes about its own process,
/// which lags a reload and a process the page has let go of. A process stays
/// in the sessions map until its wait thread sees it exit, so its last calls
/// still carry true.
fn bridge_request<R: Runtime>(
    app: &AppHandle<R>,
    pending: &Pending,
    next_id: &AtomicU64,
    message: Value,
    agent: bool,
) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);

    if app.get_webview_window("main").is_none() {
        return rpc_error(id, -32000, "the Open Screenshot Generator window is not available");
    }

    let timeout = timeout_for(&message);
    let call_id = format!("call-{}", next_id.fetch_add(1, Ordering::Relaxed));
    let (tx, rx) = channel::<Value>();
    pending.lock().unwrap().insert(call_id.clone(), tx);

    // No McpState lock is held here, so taking the sessions lock keeps to the
    // one order the two states share: McpState.server, then the sessions
    // (stop_if_unused).
    let folders = agent && !crate::claude_code::live_folders(app).is_empty();
    let emitted = app.emit_to(
        "main",
        MCP_REQUEST_EVENT,
        json!({ "callId": call_id, "message": message, "nonce": bridge_nonce(app), "agent": agent, "folders": folders }),
    );
    if emitted.is_err() {
        pending.lock().unwrap().remove(&call_id);
        return rpc_error(id, -32000, "could not reach the app UI");
    }

    // On timeout the pending entry is dropped below, so a late reply is simply
    // discarded and the connection is free again immediately: the client can
    // retry (or call anything else) without restarting the app.
    let result = match rx.recv_timeout(timeout) {
        Ok(v) => v,
        Err(_) => rpc_error(
            id,
            -32001,
            &format!(
                "the app did not answer within {}s, so the call was dropped. The server is still running. Try again.",
                timeout.as_secs()
            ),
        ),
    };
    pending.lock().unwrap().remove(&call_id);
    result
}

/// Write an exported image to disk for the `export_png` / `export_all` tools.
///
/// Goes through Rust rather than the JS fs plugin because that plugin's scope
/// only opens up for paths the *user* picked in a dialog, and an MCP export is
/// unattended. `directory` defaults to "Open Screenshot Generator" under the
/// user's Downloads folder. One that is relative or climbs with `..` is
/// refused, and while an agent process reads code folders, so is one inside
/// them or on a share, so an export cannot overwrite the app's own icons
/// (code_folders.rs).
#[tauri::command]
pub fn abs_mcp_write_png<R: Runtime>(
    app: AppHandle<R>,
    directory: Option<String>,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    // Only the sessions lock, and no lock of ours is held here.
    let live = crate::claude_code::live_folders(&app);
    if let Some(problem) = mcp_export_problem(directory.as_deref(), &live) {
        return Err(problem.to_string());
    }
    write_png(&app, directory, file_name, data_base64)
}

/// Why an MCP export may not go to `directory`, or None. Blank or missing
/// means the default folder, which needs no check, the same test write_png
/// applies. `live` is every code folder a running agent process reads.
fn mcp_export_problem(directory: Option<&str>, live: &[std::path::PathBuf]) -> Option<&'static str> {
    let dir = directory.filter(|dir| !dir.trim().is_empty())?;
    crate::code_folders::export_directory_problem(std::path::Path::new(dir), live)
}

/// The write itself, with no check on the directory, which the user's own
/// Export dialog picked (abs_write_export_png) or abs_mcp_write_png vetted.
/// The name is sanitised to a bare `.png` file, so a caller cannot pick the
/// path apart to write somewhere unexpected.
fn write_png<R: Runtime>(
    app: &AppHandle<R>,
    directory: Option<String>,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    use base64::Engine;
    use std::path::PathBuf;

    let dir: PathBuf = match directory.filter(|d| !d.trim().is_empty()) {
        Some(d) => PathBuf::from(d),
        None => app
            .path()
            .download_dir()
            .map_err(|e| format!("could not find your Downloads folder: {e}"))?
            .join("Open Screenshot Generator"),
    };

    // Keep the caller to a file name: no separators, no traversal, always .png.
    let base = file_name.rsplit(['/', '\\']).next().unwrap_or_default();
    // `is_char_boundary` is not optional: slicing 4 bytes off the end of a name
    // like "Écran.png" would land mid-codepoint and panic, and the release
    // profile aborts on panic, so one artboard named in a non-ASCII language
    // would take the whole app down.
    let base = match base.len().checked_sub(4) {
        Some(cut) if base.is_char_boundary(cut) && base[cut..].eq_ignore_ascii_case(".png") => &base[..cut],
        _ => base,
    };
    let stem = base.replace([':', '*', '?', '"', '<', '>', '|'], "_");
    let stem = if stem.trim().is_empty() { "artboard".to_string() } else { stem };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("the image data was not valid base64: {e}"))?;

    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let path = dir.join(format!("{stem}.png"));
    std::fs::write(&path, bytes).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// One folder segment, or `None` when nothing usable is left of it.
///
/// Separators and traversal are stripped rather than rejected, so a locale code
/// can never climb out of the folder the user picked, and the Windows-reserved
/// characters go the same way `sanitizeFileName` (src/lib/desktop.ts) sends
/// them. A trailing dot or space matters too: Windows drops it when it creates
/// the directory, so the path we report back would not be the path on disk.
fn export_subdir_segment(raw: &str) -> Option<String> {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or_default().trim();
    let cleaned = base.replace([':', '*', '?', '"', '<', '>', '|'], "_");
    let cleaned = cleaned.trim_end_matches(|c| c == '.' || c == ' ').trim();
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned.to_string())
    }
}

/// Write one exported artboard PNG into a folder the user already picked,
/// optionally inside a subfolder: `<picked dir>/de-DE/01_Feature.png`.
///
/// The JS fs plugin cannot do this. Picking the folder widens its runtime scope
/// to that folder's contents, but nothing grants `fs:allow-mkdir`, and
/// `sanitizeFileName` strips both separators so the subfolder cannot ride in on
/// the file name either. So a per-language export takes the same Rust path the
/// MCP export already uses, with the subfolder held to a single sanitised
/// segment.
#[tauri::command]
pub fn abs_write_export_png<R: Runtime>(
    app: AppHandle<R>,
    directory: String,
    subdirectory: Option<String>,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    use std::path::PathBuf;

    let mut dir = PathBuf::from(directory.trim());
    if dir.as_os_str().is_empty() {
        return Err("no export folder was given".to_string());
    }
    if let Some(segment) = subdirectory.as_deref().and_then(export_subdir_segment) {
        dir.push(segment);
    }

    // Delegating keeps the name sanitising, the create_dir_all and the base64
    // decode in one place. A second copy of that rule would drift, and it is
    // the rule that stops a caller writing outside the folder it was handed.
    // Not through abs_mcp_write_png's guard: the user picked this folder, and
    // saving fastlane screenshots into their own repo is theirs to do.
    write_png(
        &app,
        Some(dir.to_string_lossy().into_owned()),
        file_name,
        data_base64,
    )
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

/// Stops the server, except under a running agent, which would lose its tools
/// mid-conversation.
#[tauri::command]
pub async fn abs_mcp_stop<R: Runtime>(app: AppHandle<R>, state: tauri::State<'_, McpState>) -> Result<McpStatus, String> {
    stop_if_unused(&app, &state, false);
    Ok(McpStatus::stopped())
}

/// Whether OTHER programs can reach the tools, which is what the status pill
/// and its setup guides are about. A server kept up only for the app's own
/// agent answers everyone else with 401, so it reports as off.
#[tauri::command]
pub fn abs_mcp_status<R: Runtime>(app: AppHandle<R>, state: tauri::State<'_, McpState>) -> McpStatus {
    if !crate::settings::current(&app).mcp_server_enabled {
        return McpStatus::stopped();
    }
    status_of(&state)
}

/// The bridge nonce, for the editor window's MCP listener and Claude Code
/// transport. Refused anywhere else: a window that could read it could forge
/// the events it protects.
#[tauri::command]
pub fn abs_mcp_bridge_nonce<R: Runtime>(app: AppHandle<R>, window: tauri::Window<R>) -> Result<String, String> {
    if window.label() != "main" {
        return Err("only the editor window can read this".into());
    }
    Ok(bridge_nonce(&app))
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
        // The agent may still need the socket, and keeps it until its last
        // process ends (release_after_agent). Switching the setting off already
        // shut everyone else out (see `authorized`), which is what the user
        // asked for, so it reports as off either way.
        stop_if_unused(app, &state, false);
        McpStatus::stopped()
    };
    // Stamped like the bridged requests: the assistant windows may emit events
    // too, and a forged status would put their URL into the setup guides.
    let mut payload = serde_json::to_value(&status).unwrap_or_default();
    payload["nonce"] = Value::String(bridge_nonce(app));
    let _ = app.emit("abs-mcp-status", payload);
}

/// Start the server for the app's own Claude Code agent (claude_code.rs), which
/// reaches the design tools through it like any other MCP client, and hand back
/// the bearer token that agent has to send.
///
/// Leaves the user's saved on/off choice, the menu check mark and the status
/// pill alone. Those describe whether OTHER programs may connect, and with the
/// switch off they still may not: `authorized` turns away anything without the
/// token.
pub fn ensure_running<R: Runtime>(app: &AppHandle<R>) -> Result<(McpStatus, String), String> {
    let state = app.state::<McpState>();
    let status = start(app, &state)?;
    let token = state.agent_token.lock().unwrap().get_or_insert_with(fresh_token).clone();
    Ok((status, token))
}

/// Start the server at launch if the user had it enabled last session.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    if crate::settings::current(app).mcp_server_enabled {
        let state = app.state::<McpState>();
        let _ = start(app, &state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_image_import_gets_the_long_budget() {
        let call = |name: &str| json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": name, "arguments": {} } });
        assert_eq!(timeout_for(&call("import_project_image")), SLOW_RESPONSE_TIMEOUT);
        assert_eq!(timeout_for(&call("export_png")), SLOW_RESPONSE_TIMEOUT);
        assert_eq!(timeout_for(&call("list_artboards")), RESPONSE_TIMEOUT);
        assert_eq!(timeout_for(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })), RESPONSE_TIMEOUT);
    }

    #[test]
    fn only_the_agents_token_marks_a_request_as_the_agent() {
        let token = Some("0123abcd");
        assert!(bearer_matches(["Bearer 0123abcd"], token));
        // One of several Authorization headers is enough.
        assert!(bearer_matches(["Basic eA==", "Bearer 0123abcd"], token));
        for wrong in ["Bearer 0123abc", "Bearer 0123abcd ", "bearer 0123abcd", "0123abcd", "Bearer", ""] {
            assert!(!bearer_matches([wrong], token), "{wrong:?}");
        }
        assert!(!bearer_matches(Vec::<&str>::new(), token));
        // No token minted yet, so no request is the agent's.
        assert!(!bearer_matches(["Bearer "], None));
        assert!(!bearer_matches(["Bearer "], Some("")));
    }

    #[test]
    fn the_agent_gets_through_with_the_switch_off_and_nobody_else_does() {
        assert!(authorized(true, false));
        assert!(authorized(true, true));
        assert!(authorized(false, true));
        assert!(!authorized(false, false));
    }

    #[test]
    fn mcp_exports_skip_the_guard_only_for_the_default_folder() {
        let base = std::env::temp_dir().join(format!("osg-mcp-export-{}", std::process::id()));
        let root = base.join("app");
        std::fs::create_dir_all(root.join("res")).unwrap();
        let root = crate::code_folders::canonical(&root).unwrap();
        let live = vec![root.clone()];
        for blank in [None, Some(""), Some("   ")] {
            assert_eq!(mcp_export_problem(blank, &live), None, "{blank:?}");
        }
        // Refused whether or not a folder is live.
        assert_eq!(mcp_export_problem(Some("exports"), &[]), Some(crate::code_folders::EXPORT_NOT_ABSOLUTE));
        let inside = root.join("res");
        assert_eq!(mcp_export_problem(inside.to_str(), &live), Some(crate::code_folders::EXPORT_INSIDE_FOLDER));
        assert_eq!(mcp_export_problem(inside.to_str(), &[]), None);
        let beside = base.join("exports");
        assert_eq!(mcp_export_problem(beside.to_str(), &live), None);
        let _ = std::fs::remove_dir_all(&base);
    }
}
