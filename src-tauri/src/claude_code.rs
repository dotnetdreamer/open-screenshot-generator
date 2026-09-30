//! Claude Code, run on the user's own machine and on their own Claude plan.
//!
//! The AI agent's "Claude Code" mode and the Agent panel in the dock talk to the
//! Claude Code CLI the user already has installed and signed in to. Nothing
//! here asks for a login: `claude` brings its own credentials.
//!
//! What this module does:
//!   - finds the binary: PATH first, then the places the installers put it. On
//!     macOS and Linux it also asks a login shell for its PATH, because an app
//!     started from the Dock or a launcher inherits almost none of it, and an
//!     npm-installed `claude` needs `node` from that same PATH to run at all;
//!   - spawns it headless with stream-json on both pipes, in a workspace folder
//!     of its own under the app's local data directory;
//!   - relays every stdout line to the editor window as an event, and writes
//!     the editor's messages to stdin, one JSON object per line, from a writer
//!     thread of its own so no caller ever waits on a pipe.
//!
//! What the process may do is fixed here, never by the frontend. The only
//! built-in tool left on is Skill, which loads the app's own design skill; the
//! shell, file edits and web access are all off. The only MCP server is the
//! app's own (mcp_server.rs, started on demand, answering this process through
//! a bearer token), and its tools are pre-approved, because a headless run has
//! nobody to answer a permission prompt. `--setting-sources ""` keeps the
//! user's own settings, hooks, plugins and CLAUDE.md out of the agent, a
//! settings file of our own turns hooks off entirely, and the environment is
//! scrubbed of anything that would bill an API key instead of the user's Claude
//! plan. The system prompt and the skills are compiled into the app from
//! src-tauri/claude-agent/. The frontend picks only the model and the
//! conversation to resume, so nothing the page sends changes what Claude Code
//! loads.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};

/// Event the editor window listens on. Must match `CLAUDE_EVENT` in
/// src/lib/claudeCode/desktopTransport.ts.
const EVENT: &str = "abs-claude-event";

/// The name the app's MCP server goes by inside Claude Code, which makes its
/// tools `mcp__osg-editor__<tool>`. Not "open-screenshot-generator": this
/// repo's own Claude Code plugin registers a server under that name. The
/// system prompt names the tools this way.
const MCP_SERVER_NAME: &str = "osg-editor";

/// The plugin the skills ship in, so each one loads as `osg-agent:<skill>`.
const PLUGIN_NAME: &str = "osg-agent";

/// The agent's instructions, handed over with --append-system-prompt-file.
///
/// Built in rather than sent by the page, like the skills below: a skill can
/// make Claude Code run a command (hooks in its frontmatter, `!` lines in its
/// body), so what the agent loads is fixed when the app is built. Every tool
/// these files name has to exist on the MCP server (tests/unit/agentBrief.test.ts
/// checks).
const SYSTEM_PROMPT: &str = include_str!("../claude-agent/system-prompt.md");

/// The skills, by name. The agent has no Read tool, so each has to stand on
/// its own; osg-design is loaded before the first design tool call and the
/// other two when a request needs them.
const SKILLS: &[(&str, &str)] = &[
    ("osg-design", include_str!("../claude-agent/skills/osg-design/SKILL.md")),
    ("osg-languages", include_str!("../claude-agent/skills/osg-languages/SKILL.md")),
    ("osg-app-preview", include_str!("../claude-agent/skills/osg-app-preview/SKILL.md")),
];

/// Folder under the app's local data directory the agent runs in.
const WORKSPACE_DIR: &str = "claude-agent";

/// More than this many live processes means something is leaking them.
const MAX_SESSIONS: usize = 4;

/// A stdout line longer than this is almost always a tool result carrying a
/// rendered PNG. The editor never draws those at full size, and shipping
/// megabytes of base64 through the IPC bridge per export stalls the window.
const LARGE_LINE: usize = 512 * 1024;
/// Inline image data longer than this is dropped from a large line.
const MAX_INLINE_IMAGE: usize = 256 * 1024;

/// How many stderr lines travel with the exit event.
const STDERR_TAIL: usize = 20;

/// How long the exit event waits for the pipe readers once the process is gone.
/// Anything it started that inherited the pipes can hold them open forever.
const READER_GRACE: Duration = Duration::from_secs(2);

/// Why a start fails when the page that asked for it is gone (on_page_load).
/// Nobody reads it: the page it would go to no longer exists.
const RELOADED: &str = "The editor reloaded while Claude Code was starting";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// One running `claude` process.
struct Running {
    pid: u32,
    /// Lines for the writer thread, which owns stdin. Taken (None) to close
    /// stdin: Claude Code reads EOF as "no more messages" and exits once the
    /// current turn is done.
    input: Mutex<Option<mpsc::Sender<String>>>,
    /// A turn is in progress: set when a user message is queued, cleared when a
    /// `result` comes back. What a reloaded editor believes about an adopted
    /// process, since it missed whatever was said while it reloaded.
    busy: AtomicBool,
    /// The last lines of stderr, sent with the exit event. A process that dies
    /// before its first turn (no Git Bash or PowerShell on Windows, a flag an
    /// old version does not know) says why only here.
    stderr_tail: Mutex<VecDeque<String>>,
    /// A hash of the line queued last, and when, to drop the copy Tauri's IPC
    /// retry can deliver (see ClaudeState::claimed). A hash, because a line
    /// with pictures in it runs to megabytes.
    last_line: Mutex<Option<(u64, Instant)>>,
}

impl Running {
    fn close_input(&self) {
        self.input.lock().unwrap().take();
    }
}

#[derive(Default)]
pub struct ClaudeState {
    sessions: Mutex<HashMap<String, Arc<Running>>>,
    /// Starts past the point where they turned the MCP server on but not yet in
    /// `sessions`. Counted by has_sessions, so the Settings toggle cannot stop
    /// the server under a process that is about to connect to it.
    starting: AtomicUsize,
    /// The PATH a login shell reports, looked up on each detect.
    shell_path: Mutex<Option<String>>,
    /// Counts the pages the editor window has committed. A start still in
    /// flight when it moves was asked for by a page that is gone.
    page_epoch: AtomicU64,
    /// The spawn ids starts have claimed, newest last, so each is used once.
    /// Tauri's IPC sends a command again over postMessage when its fetch fails,
    /// which a page that navigates away mid-invoke causes, so one start can
    /// arrive twice, the second time after page_epoch has moved on.
    claimed: Mutex<VecDeque<String>>,
}

/// How many claimed spawn ids are remembered. The page makes a new one for
/// every start, so this only has to outlast a duplicate in flight.
const CLAIMED_KEEP: usize = 256;

/// The same line sent again within this long is Tauri's IPC retry, not the
/// user: the store sends nothing while a turn runs, so a real repeat takes a
/// whole turn and a retyped message.
const DUPLICATE_WINDOW: Duration = Duration::from_secs(1);

impl ClaudeState {
    fn get(&self, spawn_id: &str) -> Option<Arc<Running>> {
        self.sessions.lock().unwrap().get(spawn_id).cloned()
    }
}

/// The app's page-load hook (lib.rs). wry reports Started when a new document
/// commits (WebView2 ContentLoading, WebKit didCommitNavigation, WebKitGTK
/// Committed), after the old page is gone and before any script of the new
/// one runs, and not for fragment or pushState changes. So any start still in
/// flight at that moment belongs to a page that no longer exists. That page
/// never learns the new process's id, and the new page may already have looked
/// for processes to adopt, so start_blocking kills such a process rather than
/// leave it holding a session slot until the app quits.
pub fn on_page_load<R: Runtime>(webview: &tauri::Webview<R>, payload: &PageLoadPayload<'_>) {
    if webview.label() == "main" && payload.event() == PageLoadEvent::Started {
        webview.state::<ClaudeState>().page_epoch.fetch_add(1, Ordering::SeqCst);
    }
}

/// Whether the agent has a process running or starting. The MCP server stays
/// up while it does, even when the user switches the external-tools setting off.
pub fn has_sessions<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<ClaudeState>();
    // `starting` first. A start leaves it only after it is in `sessions`, so
    // one of the two reads always sees it; the other order can miss a start
    // that finishes between them.
    state.starting.load(Ordering::SeqCst) > 0 || !state.sessions.lock().unwrap().is_empty()
}

/// These commands start processes on the user's plan, so only the editor window
/// may call them. Detached panel windows run the same app code but never drive
/// the agent directly (they send intents to the editor), and a page from any
/// other origin has no business here at all.
fn require_editor<R: Runtime>(window: &tauri::Window<R>) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("only the editor window can run the agent".into())
    }
}

// ---------------------------------------------------------------------------
// Finding the binary
// ---------------------------------------------------------------------------

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDetection {
    found: bool,
    path: Option<String>,
    version: Option<String>,
    logged_in: Option<bool>,
    auth_method: Option<String>,
    subscription_type: Option<String>,
    /// Why Claude Code cannot run here at all, whatever is installed.
    unavailable: Option<String>,
    error: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Where the installers put `claude` when it is not on this process's PATH.
fn known_locations() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let home = home_dir();
    #[cfg(windows)]
    {
        if let Some(home) = &home {
            // The native installer.
            out.push(home.join(".local").join("bin").join("claude.exe"));
            out.push(home.join(".claude").join("local").join("claude.exe"));
            out.push(home.join("scoop").join("shims").join("claude.exe"));
            out.push(home.join(".bun").join("bin").join("claude.exe"));
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let npm = PathBuf::from(&appdata).join("npm");
            // `npm install -g` ships the native binary inside the package, and
            // spawning it directly skips cmd.exe and its argument quoting.
            out.push(
                npm.join("node_modules")
                    .join("@anthropic-ai")
                    .join("claude-code")
                    .join("bin")
                    .join("claude.exe"),
            );
            // Older npm installs only have the batch shim.
            out.push(npm.join("claude.cmd"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(PathBuf::from(&local).join("Microsoft").join("WinGet").join("Links").join("claude.exe"));
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = &home {
            out.push(home.join(".local/bin/claude"));
            out.push(home.join(".claude/local/claude"));
            out.push(home.join(".npm-global/bin/claude"));
            out.push(home.join(".bun/bin/claude"));
            out.push(home.join(".volta/bin/claude"));
            out.push(home.join(".nix-profile/bin/claude"));
        }
        out.push(PathBuf::from("/opt/homebrew/bin/claude"));
        out.push(PathBuf::from("/usr/local/bin/claude"));
        out.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin/claude"));
        out.push(PathBuf::from("/usr/bin/claude"));
    }
    out
}

/// The PATH an interactive login shell would have. `-i` as well as `-l`,
/// because version managers (nvm, volta, fnm) usually set themselves up in the
/// rc file rather than the profile, and an npm-installed `claude` is a node
/// script that finds node through that PATH.
#[cfg(not(windows))]
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() });
    const START: &str = "__OSG_PATH_START__";
    const END: &str = "__OSG_PATH_END__";
    let script = format!("printf '{START}%s{END}' \"$PATH\"");
    // The markers are enough: a profile that leaves a background job holding
    // the pipe never delivers EOF, and run_capture gives up at the deadline
    // with whatever arrived.
    let out = run_capture(Path::new(&shell), &["-ilc", script.as_str()], &[], Duration::from_secs(6));
    let text = match out {
        Ok(captured) => captured.stdout,
        Err(partial) => partial.stdout,
    };
    let start = text.find(START)? + START.len();
    let end = text[start..].find(END)? + start;
    let path = text[start..end].trim().to_string();
    (!path.is_empty()).then_some(path)
}

#[cfg(windows)]
fn login_shell_path() -> Option<String> {
    None
}

/// This process's PATH with the login shell's in front of it, duplicates
/// dropped. What the child gets, and where the binary is looked for.
fn effective_path(state: &ClaudeState) -> String {
    let separator = if cfg!(windows) { ';' } else { ':' };
    let own = std::env::var("PATH").unwrap_or_default();
    let shell = state.shell_path.lock().unwrap().clone().unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    let mut parts = Vec::new();
    for part in shell.split(separator).chain(own.split(separator)) {
        let part = part.trim();
        if !part.is_empty() && seen.insert(part.to_string()) {
            parts.push(part.to_string());
        }
    }
    parts.join(&separator.to_string())
}

fn find_binary(state: &ClaudeState) -> Option<PathBuf> {
    // For testing against a specific build, and for installs nothing below finds.
    if let Some(custom) = std::env::var_os("OSG_CLAUDE_PATH") {
        let custom = PathBuf::from(custom);
        if custom.is_file() {
            return Some(custom);
        }
    }
    let separator = if cfg!(windows) { ';' } else { ':' };
    let path = effective_path(state);
    let on_path = |name: &str| {
        path.split(separator)
            .map(|dir| Path::new(dir).join(name))
            .find(|candidate| candidate.is_file())
    };
    if !cfg!(windows) {
        return on_path("claude").or_else(|| known_locations().into_iter().find(|candidate| candidate.is_file()));
    }
    // A real executable anywhere beats a batch shim first on PATH. npm puts
    // claude.cmd on PATH even when the package ships a native claude.exe, and
    // going through the shim means cmd.exe and its argument quoting.
    let is_exe = |candidate: &PathBuf| candidate.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
    on_path("claude.exe")
        .or_else(|| known_locations().into_iter().find(|candidate| is_exe(candidate) && candidate.is_file()))
        .or_else(|| on_path("claude.cmd"))
        .or_else(|| on_path("claude.bat"))
        .or_else(|| known_locations().into_iter().find(|candidate| candidate.is_file()))
}

struct Captured {
    success: bool,
    stdout: String,
    stderr: String,
}

/// Read a pipe on its own thread, chunk by chunk, so a caller can stop waiting
/// at a deadline instead of at EOF.
fn spawn_reader(pipe: impl Read + Send + 'static) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut pipe = pipe;
        let mut buf = [0u8; 8192];
        loop {
            match pipe.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    rx
}

/// Collect what a reader delivers until it reaches EOF or the deadline passes.
fn drain(rx: &mpsc::Receiver<Vec<u8>>, deadline: Instant) -> String {
    let mut out = Vec::new();
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match rx.recv_timeout(deadline - now) {
            Ok(chunk) => out.extend_from_slice(&chunk),
            Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Run a short command to completion within `timeout`, killing it if it
/// overruns. Nothing here waits past the deadline: a descendant that inherits
/// the pipes and lives on (a background job in a shell profile) would otherwise
/// hold EOF back forever. Err carries whatever output arrived in time.
fn run_capture(
    program: &Path,
    args: &[&str],
    env: &[(&str, &str)],
    timeout: Duration,
) -> Result<Captured, Captured> {
    let failed = |message: String| Captured { success: false, stdout: String::new(), stderr: message };
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    scrub_env(&mut command);
    for (key, value) in env {
        command.env(key, value);
    }
    hide_console(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own group, so the kill on timeout reaches anything it started.
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|e| failed(e.to_string()))?;
    let stdout = spawn_reader(child.stdout.take().ok_or_else(|| failed("no stdout".into()))?);
    let stderr = spawn_reader(child.stderr.take().ok_or_else(|| failed("no stderr".into()))?);
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => {
                kill_tree(child.id());
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(failed(e.to_string())),
        }
    };
    // Normally the pipes close with the process; a short grace covers the last
    // bytes in flight without letting a lingering descendant stall us.
    let until = Instant::now() + Duration::from_millis(500);
    let captured = Captured {
        success: status.map(|s| s.success()).unwrap_or(false),
        stdout: drain(&stdout, until),
        stderr: drain(&stderr, until),
    };
    match status {
        Some(_) => Ok(captured),
        None => Err(Captured {
            stderr: format!("{} did not answer in time", program.display()),
            ..captured
        }),
    }
}

fn first_line(text: &str) -> String {
    text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").chars().take(300).collect()
}

/// The Mac App Store build runs sandboxed, and a child process inherits the
/// sandbox: it could read neither ~/.local/bin nor the login in ~/.claude.
fn sandboxed() -> bool {
    std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some()
}

fn detect(state: &ClaudeState) -> ClaudeDetection {
    if sandboxed() {
        return ClaudeDetection { unavailable: Some("sandboxed".into()), ..Default::default() };
    }
    // Refresh the login shell PATH on every detect, so "Check again" after an
    // install that edited the shell profile finds the new binary.
    let shell_path = login_shell_path();
    *state.shell_path.lock().unwrap() = shell_path;

    let Some(binary) = find_binary(state) else {
        return ClaudeDetection::default();
    };
    let path = effective_path(state);
    let env = [("PATH", path.as_str())];
    let mut detection = ClaudeDetection {
        found: true,
        path: Some(binary.display().to_string()),
        ..Default::default()
    };
    match run_capture(&binary, &["--version"], &env, Duration::from_secs(20)) {
        Ok(out) if out.success => {
            detection.version = Some(first_line(&out.stdout));
        }
        Ok(out) => {
            let reason = first_line(&out.stderr);
            detection.error = Some(if reason.is_empty() { first_line(&out.stdout) } else { reason });
            return detection;
        }
        Err(out) => {
            detection.error = Some(first_line(&out.stderr));
            return detection;
        }
    }
    // `auth status` prints JSON whether or not it succeeds, and it runs with the
    // same scrubbed environment as the agent, so it reports the login the
    // agent will actually use. Older builds do not have it, which leaves
    // logged_in unknown rather than false.
    if let Ok(out) = run_capture(&binary, &["auth", "status"], &env, Duration::from_secs(20)) {
        let text = out.stdout.trim();
        let json_start = text.find('{').unwrap_or(0);
        if let Ok(value) = serde_json::from_str::<Value>(&text[json_start..]) {
            detection.logged_in = value.get("loggedIn").and_then(Value::as_bool);
            detection.auth_method = value.get("authMethod").and_then(Value::as_str).map(String::from);
            detection.subscription_type =
                value.get("subscriptionType").and_then(Value::as_str).map(String::from);
        }
    }
    detection
}

#[tauri::command]
pub async fn abs_claude_detect<R: Runtime>(app: AppHandle<R>) -> Result<ClaudeDetection, String> {
    tauri::async_runtime::spawn_blocking(move || detect(&app.state::<ClaudeState>()))
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// The workspace
// ---------------------------------------------------------------------------

fn workspace_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join(WORKSPACE_DIR))
}

/// Write a file unless it already holds exactly these bytes. Another process
/// can be starting from this workspace at the same moment (a reload, or a new
/// chat right behind the old one), and a rewrite empties a file before it
/// fills it again, so an unchanged file is left alone. That also spares a
/// file a dying process on Windows still holds open.
fn write_if_changed(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if std::fs::read(path).is_ok_and(|current| current == bytes) {
        return Ok(());
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// Remove what `dir` holds besides `keep`, so nothing an older version of the
/// app wrote survives, without touching the files that stay.
fn prune(dir: &Path, keep: &[&str]) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_str().is_some_and(|name| keep.contains(&name)) {
            continue;
        }
        let path = entry.path();
        let _ = if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
    }
}

/// Write a file only this user can read. The MCP config carries the bearer
/// token, and on Linux a home folder is often readable by every account.
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let private = std::fs::metadata(path).is_ok_and(|meta| meta.permissions().mode() & 0o777 == 0o600);
        if private && std::fs::read(path).is_ok_and(|current| current == bytes) {
            return Ok(());
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| e.to_string())?;
        // mode() only applies to a file it creates. One an older build left
        // behind keeps what it had, so set it again before the token goes in.
        file.set_permissions(std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())
    }
    #[cfg(not(unix))]
    {
        write_if_changed(path, bytes)
    }
}

/// Where everything the process is given lives.
struct Workspace {
    /// The working directory. Empty on purpose: Claude Code tells the model
    /// about its cwd and loads any memory kept for it, and an empty folder says
    /// nothing. Stable on purpose too, because Claude Code files conversations
    /// by cwd and `--resume` looks for them there.
    cwd: PathBuf,
    plugin: PathBuf,
    system_prompt: PathBuf,
    mcp_config: PathBuf,
    settings: PathBuf,
}

/// Bring the workspace to what this build ships: its instructions and skills,
/// the MCP config pointing at the port the server is on right now, and nothing
/// left over from an older version of the app. Only what differs is written.
fn prepare_workspace(dir: &Path, mcp_url: &str, token: &str) -> Result<Workspace, String> {
    let cwd = dir.join("session");
    let plugin = dir.join("plugin");
    let skills = plugin.join("skills");
    let manifest_dir = plugin.join(".claude-plugin");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }

    let skill_names: Vec<&str> = SKILLS.iter().map(|(name, _)| *name).collect();
    prune(&plugin, &[".claude-plugin", "skills"]);
    prune(&manifest_dir, &["plugin.json"]);
    prune(&skills, &skill_names);

    std::fs::create_dir_all(&manifest_dir).map_err(|e| e.to_string())?;
    let manifest = json!({
        "name": PLUGIN_NAME,
        "version": "1.0.0",
        "description": "How Open Screenshot Generator's design agent works",
    });
    write_if_changed(
        &manifest_dir.join("plugin.json"),
        &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    )?;

    for (name, contents) in SKILLS {
        let skill_dir = skills.join(name);
        std::fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
        prune(&skill_dir, &["SKILL.md"]);
        write_if_changed(&skill_dir.join("SKILL.md"), contents.as_bytes())?;
    }
    let system_prompt = dir.join("system-prompt.md");
    write_if_changed(&system_prompt, SYSTEM_PROMPT.as_bytes())?;

    let config = json!({
        "mcpServers": {
            MCP_SERVER_NAME: {
                "type": "http",
                "url": mcp_url,
                "headers": { "Authorization": format!("Bearer {token}") },
            }
        }
    });
    let mcp_config = dir.join("osg-mcp.json");
    write_private(&mcp_config, &serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?)?;

    // Hooks off, whatever a skill or plugin declares. One key and nothing
    // else: in print mode Claude Code silently ignores a settings file that
    // fails validation, and this one must never be ignored.
    let settings = dir.join("osg-settings.json");
    write_if_changed(&settings, br#"{"disableAllHooks":true}"#)?;

    Ok(Workspace { cwd, plugin, system_prompt, mcp_config, settings })
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    spawn_id: String,
    model: Option<String>,
    resume: Option<String>,
    /// The page_epoch the asking page read when it loaded
    /// (abs_claude_page_epoch). Rust only knows when an invoke arrives, and
    /// Tauri's IPC retry can deliver one after its page is gone, so the page
    /// says which page it is. Without it, the epoch on arrival stands in.
    page_epoch: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInfo {
    pid: u32,
    workspace: String,
    mcp_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedSession {
    spawn_id: String,
    busy: bool,
}

fn valid_spawn_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A model alias (`opus`) or full name (`claude-opus-5-5`, `claude-fable-5-1[1m]`).
fn valid_model(model: &str) -> bool {
    (1..=64).contains(&model.len())
        && !model.starts_with('-')
        && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '[' | ']'))
}

fn valid_uuid(id: &str) -> bool {
    id.len() == 36
        && id.char_indices().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// Variables that would send the agent's calls somewhere other than the user's
/// Claude plan. ANTHROPIC_API_KEY alone moves the bill to API credit, and in
/// print mode the CLI takes it without asking. CLAUDE_CODE_OAUTH_TOKEN stays:
/// it forces the subscription login rather than steering away from it.
const REROUTING_VARS: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
    "ANTHROPIC_AWS_API_KEY",
    "AWS_BEARER_TOKEN_BEDROCK",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
    "CLAUDE_CODE_USE_MANTLE",
    "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR",
];

/// What a Claude Code session sets for the programs it starts. When the app
/// itself was launched from one (a developer running `tauri dev` in its
/// terminal), passing these on makes the child think it is nested inside that
/// session.
const NESTED_SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_PID",
    "CLAUDE_AGENT_SDK_VERSION",
    "AI_AGENT",
    "MCP_CONNECTION_NONBLOCKING",
];

fn scrub_env(command: &mut Command) {
    for key in REROUTING_VARS.iter().chain(NESTED_SESSION_VARS) {
        command.env_remove(key);
    }
    // An AppImage points the dynamic loader at its own bundled libraries,
    // which a native `claude` binary has no business loading.
    if std::env::var_os("APPIMAGE").is_some() {
        for key in ["LD_LIBRARY_PATH", "LD_PRELOAD", "GIO_EXTRA_MODULES", "GDK_BACKEND"] {
            command.env_remove(key);
        }
    }
}

/// Without this every spawn from a GUI app opens a console window on Windows.
/// `tauri dev` builds are console apps, so the flash only shows in release.
fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

/// Kill a process and everything it started. An npm-installed `claude` on
/// Windows can be `cmd.exe` running `node.exe`, and killing only the shell
/// leaves node running with the pipes open.
fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null());
        hide_console(&mut command);
        let _ = command.status();
    }
    #[cfg(not(windows))]
    {
        // Spawned as the leader of its own process group, so a negative pid
        // reaches the whole group. TERM first, so the conversation file is
        // flushed and `--resume` has the last turn to come back to.
        let group = format!("-{pid}");
        let _ = Command::new("kill").args(["-TERM", group.as_str()]).stdout(Stdio::null()).stderr(Stdio::null()).status();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(2500));
            let _ = Command::new("kill").args(["-KILL", group.as_str()]).stdout(Stdio::null()).stderr(Stdio::null()).status();
        });
    }
}

/// Drop inline image bytes from a stdout line that is mostly image bytes.
fn slim_line(line: String) -> String {
    if line.len() <= LARGE_LINE {
        return line;
    }
    let Ok(mut value) = serde_json::from_str::<Value>(&line) else {
        return line;
    };
    fn walk(value: &mut Value) {
        match value {
            Value::Object(map) => {
                // An Anthropic image source ({type:"base64", data}) or an MCP
                // image block ({type:"image", data}) keeps its bytes in `data`.
                let kind = map.get("type").and_then(Value::as_str);
                if matches!(kind, Some("base64") | Some("image")) {
                    let oversized = matches!(map.get("data"), Some(Value::String(data)) if data.len() > MAX_INLINE_IMAGE);
                    if oversized {
                        map.insert("data".into(), Value::String(String::new()));
                        map.insert("elided".into(), Value::Bool(true));
                    }
                }
                for child in map.values_mut() {
                    walk(child);
                }
            }
            Value::Array(items) => items.iter_mut().for_each(walk),
            _ => {}
        }
    }
    walk(&mut value);
    serde_json::to_string(&value).unwrap_or(line)
}

/// A line of stream-json that starts a turn or ends one. Checked on the raw
/// text: the app writes `{"type":"user"` itself, and Claude Code prints
/// `{"type":"result"` first on the line that closes a turn.
fn starts_turn(line: &str) -> bool {
    line.starts_with(r#"{"type":"user""#)
}

fn ends_turn(line: &str) -> bool {
    line.starts_with(r#"{"type":"result""#)
}

fn emit<R: Runtime>(app: &AppHandle<R>, mut payload: Value) {
    // The editor window only. The assistant windows host third-party sites, and
    // a conversation has no business being broadcast to them. The nonce lets
    // the editor tell these events from ones another window emits in their name.
    payload["nonce"] = Value::String(crate::mcp_server::bridge_nonce(app));
    let _ = app.emit_to("main", EVENT, payload);
}

/// Read a pipe line by line. Lossy on bad UTF-8 rather than stopping, since a
/// stopped reader would leave the child blocked on a full pipe.
fn pump_lines(pipe: impl Read, mut on_line: impl FnMut(String)) {
    let mut reader = BufReader::new(pipe);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
                if !line.trim().is_empty() {
                    on_line(line);
                }
            }
        }
    }
}

/// Undoes a `starting` count however start_blocking leaves.
struct StartingGuard<'a>(&'a AtomicUsize);

impl Drop for StartingGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

#[tauri::command]
pub async fn abs_claude_start<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    args: StartArgs,
) -> Result<StartInfo, String> {
    require_editor(&window)?;
    if !valid_spawn_id(&args.spawn_id) {
        return Err("invalid session id".into());
    }
    if let Some(model) = &args.model {
        if !valid_model(model) {
            return Err(format!("{model} is not a model name Claude Code accepts"));
        }
    }
    if let Some(resume) = &args.resume {
        if !valid_uuid(resume) {
            return Err("invalid conversation id to resume".into());
        }
    }
    // Which page asked: the one it says it is, or failing that the one loaded
    // now. Read before anything slow.
    let epoch = args.page_epoch.unwrap_or_else(|| app.state::<ClaudeState>().page_epoch.load(Ordering::SeqCst));

    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || start_blocking(&handle, args, epoch))
        .await
        .map_err(|e| e.to_string())?
}

fn start_blocking<R: Runtime>(app: &AppHandle<R>, args: StartArgs, epoch: u64) -> Result<StartInfo, String> {
    let state = app.state::<ClaudeState>();
    {
        let mut claimed = state.claimed.lock().unwrap();
        if claimed.iter().any(|id| *id == args.spawn_id) {
            return Err("that session was already started".into());
        }
        if claimed.len() == CLAIMED_KEEP {
            claimed.pop_front();
        }
        claimed.push_back(args.spawn_id.clone());
    }
    if state.page_epoch.load(Ordering::SeqCst) != epoch {
        eprintln!("claude_code: the editor reloaded while {} was starting; nothing was spawned", args.spawn_id);
        return Err(RELOADED.into());
    }
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&args.spawn_id) {
            return Err("that session is already running".into());
        }
        if sessions.len() + state.starting.load(Ordering::SeqCst) >= MAX_SESSIONS {
            return Err("Too many Claude Code sessions are running. Stop one first".into());
        }
    }
    if sandboxed() {
        return Err("Claude Code cannot run from the Mac App Store version of the app".into());
    }
    state.starting.fetch_add(1, Ordering::SeqCst);
    let started = {
        let _starting = StartingGuard(&state.starting);
        spawn_session(app, &state, args, epoch)
    };
    if started.is_err() {
        // This start may have been all that kept the server up. Released
        // after the guard has dropped, so it no longer counts as starting.
        crate::mcp_server::release_after_agent(app);
    }
    started
}

/// What start_blocking runs while it counts as starting.
fn spawn_session<R: Runtime>(
    app: &AppHandle<R>,
    state: &ClaudeState,
    args: StartArgs,
    epoch: u64,
) -> Result<StartInfo, String> {
    if state.shell_path.lock().unwrap().is_none() {
        let shell_path = login_shell_path();
        *state.shell_path.lock().unwrap() = shell_path;
    }
    let binary = find_binary(state).ok_or_else(|| "Claude Code is not installed on this computer".to_string())?;
    // The shell lookup can take seconds. A page gone by now never needs the
    // server or the workspace.
    if state.page_epoch.load(Ordering::SeqCst) != epoch {
        eprintln!("claude_code: the editor reloaded while {} was starting; nothing was spawned", args.spawn_id);
        return Err(RELOADED.into());
    }
    let (mcp, token) = crate::mcp_server::ensure_running(app)?;
    let mcp_url = mcp.url.clone().ok_or_else(|| "the design tools server did not start".to_string())?;

    let workspace = prepare_workspace(&workspace_dir(app)?, &mcp_url, &token)?;
    let allowed = format!("Skill,mcp__{MCP_SERVER_NAME}");

    let mut command = Command::new(&binary);
    command
        .current_dir(&workspace.cwd)
        .arg("-p")
        .args(["--input-format", "stream-json"])
        .args(["--output-format", "stream-json"])
        .arg("--verbose")
        // None of the user's settings, hooks, plugins or CLAUDE.md: this is a
        // design agent, not their coding setup.
        .args(["--setting-sources", ""])
        // ...and hooks off even for the skills in our own plugin.
        .arg("--settings")
        .arg(&workspace.settings)
        .arg("--plugin-dir")
        .arg(&workspace.plugin)
        // Skill is the one built-in tool left: it is how the design skill
        // loads. No shell, no file access, no web.
        .args(["--tools", "Skill"])
        .arg("--strict-mcp-config")
        .arg("--mcp-config")
        .arg(&workspace.mcp_config)
        .args(["--allowedTools", &allowed])
        // Anything not pre-approved is refused rather than prompted for, since
        // there is nobody at a prompt.
        .args(["--permission-mode", "dontAsk"])
        .arg("--append-system-prompt-file")
        .arg(&workspace.system_prompt);
    if let Some(model) = &args.model {
        command.args(["--model", model]);
    }
    if let Some(resume) = &args.resume {
        command.args(["--resume", resume]);
    }
    scrub_env(&mut command);
    command
        .env("PATH", effective_path(state))
        .env("NO_COLOR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start Claude Code ({}): {e}", binary.display()))?;
    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    // The writer owns stdin, so nothing else ever blocks on the pipe: a send
    // queues and returns, and a stop can kill the process at once. It ends
    // when the sender is dropped (close_input, stop) or the pipe breaks.
    let (input_tx, input_rx) = mpsc::channel::<String>();
    if let Some(mut stdin) = stdin {
        std::thread::spawn(move || {
            for line in input_rx {
                let written = stdin
                    .write_all(line.as_bytes())
                    .and_then(|_| stdin.write_all(b"\n"))
                    .and_then(|_| stdin.flush());
                if written.is_err() {
                    break;
                }
            }
        });
    }

    let running = Arc::new(Running {
        pid,
        input: Mutex::new(Some(input_tx)),
        busy: AtomicBool::new(false),
        stderr_tail: Mutex::new(VecDeque::new()),
        last_line: Mutex::new(None),
    });
    {
        let mut sessions = state.sessions.lock().unwrap();
        if state.page_epoch.load(Ordering::SeqCst) != epoch {
            // The editor reloaded while this was starting (see on_page_load).
            // Nothing will ever send it a message or stop it.
            drop(sessions);
            drop(running);
            kill_tree(pid);
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("claude_code: the editor reloaded while {} was starting; killed pid {pid}", args.spawn_id);
            return Err(RELOADED.into());
        }
        sessions.insert(args.spawn_id.clone(), running.clone());
    }

    let (readers_tx, readers_rx) = mpsc::channel::<()>();

    let out_app = app.clone();
    let out_id = args.spawn_id.clone();
    let out_running = running.clone();
    let out_done = readers_tx.clone();
    std::thread::spawn(move || {
        pump_lines(stdout, |line| {
            if ends_turn(&line) {
                out_running.busy.store(false, Ordering::SeqCst);
            }
            emit(&out_app, json!({ "spawnId": out_id, "kind": "stdout", "line": slim_line(line) }));
        });
        let _ = out_done.send(());
    });

    let err_app = app.clone();
    let err_id = args.spawn_id.clone();
    let err_running = running.clone();
    let err_done = readers_tx;
    std::thread::spawn(move || {
        let mut sent = 0usize;
        pump_lines(stderr, |line| {
            let line: String = line.chars().take(2000).collect();
            {
                let mut tail = err_running.stderr_tail.lock().unwrap();
                if tail.len() == STDERR_TAIL {
                    tail.pop_front();
                }
                tail.push_back(line.clone());
            }
            // Enough to explain a failure, not enough to flood the window if
            // something prints a stack trace per request.
            if sent < 200 {
                sent += 1;
                emit(&err_app, json!({ "spawnId": err_id, "kind": "stderr", "line": line }));
            }
        });
        let _ = err_done.send(());
    });

    let wait_app = app.clone();
    let wait_id = args.spawn_id.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        // Out of the map first: whatever happens to the pipes, this process is
        // gone, and the MCP toggle, the session cap and a reloaded editor's
        // list must all see that at once.
        wait_app.state::<ClaudeState>().sessions.lock().unwrap().remove(&wait_id);
        // Then every line still in flight, so the frontend sees the result that
        // explains the exit before the exit. Bounded: a descendant that
        // inherited the pipes can keep them open after the process is gone.
        let deadline = Instant::now() + READER_GRACE;
        for _ in 0..2 {
            let now = Instant::now();
            if now >= deadline || readers_rx.recv_timeout(deadline - now).is_err() {
                break;
            }
        }
        let code = status.ok().and_then(|s| s.code());
        let tail: Vec<String> = running.stderr_tail.lock().unwrap().iter().cloned().collect();
        emit(&wait_app, json!({ "spawnId": wait_id, "kind": "exit", "code": code, "stderrTail": tail }));
        // The server may have been up only for the agent.
        crate::mcp_server::release_after_agent(&wait_app);
    });

    Ok(StartInfo { pid, workspace: workspace.cwd.display().to_string(), mcp_url })
}

/// Queue one stream-json message (a single line of JSON) for the process.
/// Returns at once: the writer thread does the IO, and a process that dies
/// before reading it reports why through its exit event.
#[tauri::command]
pub async fn abs_claude_send<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, ClaudeState>,
    spawn_id: String,
    line: String,
) -> Result<(), String> {
    require_editor(&window)?;
    let running = state.get(&spawn_id).ok_or_else(|| "That Claude Code session has ended".to_string())?;
    let body = line.trim_end_matches(['\r', '\n']).to_string();
    if body.contains('\n') {
        return Err("a message must be a single line of JSON".into());
    }
    let turn = starts_turn(&body);
    {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        body.hash(&mut hasher);
        let digest = hasher.finish();
        let mut last = running.last_line.lock().unwrap();
        if last.is_some_and(|(seen, at)| seen == digest && at.elapsed() < DUPLICATE_WINDOW) {
            return Ok(());
        }
        *last = Some((digest, Instant::now()));
    }
    let guard = running.input.lock().unwrap();
    let input = guard.as_ref().ok_or_else(|| "That Claude Code session is closing".to_string())?;
    input.send(body).map_err(|_| "That Claude Code session has ended".to_string())?;
    if turn {
        running.busy.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// Close stdin: the process finishes the turn it is on and then exits.
#[tauri::command]
pub async fn abs_claude_close_input<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, ClaudeState>,
    spawn_id: String,
) -> Result<(), String> {
    require_editor(&window)?;
    if let Some(running) = state.get(&spawn_id) {
        running.close_input();
    }
    Ok(())
}

/// Stop now, mid-turn if need be. The conversation survives on disk and the
/// next message resumes it.
#[tauri::command]
pub async fn abs_claude_stop<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, ClaudeState>,
    spawn_id: String,
) -> Result<(), String> {
    require_editor(&window)?;
    if let Some(running) = state.get(&spawn_id) {
        // Kill first. Nothing waits on the writer, and a killed process breaks
        // the pipe the writer may be blocked on.
        let pid = running.pid;
        tauri::async_runtime::spawn_blocking(move || kill_tree(pid)).await.map_err(|e| e.to_string())?;
        running.close_input();
    }
    Ok(())
}

/// The page-load epoch, which the editor page reads once when it loads and
/// sends back with every start (StartArgs::page_epoch).
#[tauri::command]
pub fn abs_claude_page_epoch<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, ClaudeState>,
) -> Result<u64, String> {
    require_editor(&window)?;
    Ok(state.page_epoch.load(Ordering::SeqCst))
}

/// The processes still running, and whether each is in the middle of a turn.
/// A reloaded editor uses this to pick its conversation back up instead of
/// starting a second process, and to know whether it missed the end of a turn.
#[tauri::command]
pub fn abs_claude_list(state: tauri::State<'_, ClaudeState>) -> Vec<ListedSession> {
    state
        .sessions
        .lock()
        .unwrap()
        .iter()
        .map(|(id, running)| ListedSession { spawn_id: id.clone(), busy: running.busy.load(Ordering::SeqCst) })
        .collect()
}

/// End every agent process. Closing stdin alone would also end them, but only
/// after whatever turn they are on, still calling tools on a server that is
/// about to go away.
pub fn kill_all<R: Runtime>(app: &AppHandle<R>) {
    let running: Vec<Arc<Running>> = app.state::<ClaudeState>().sessions.lock().unwrap().values().cloned().collect();
    for session in running {
        kill_tree(session.pid);
        session.close_input();
    }
}

/// No process outlives the editor window. The app's exit hook in lib.rs covers
/// the rest: the editor can close while hidden assistant windows keep the app
/// itself alive a moment longer.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let handle = app.clone();
        main.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                kill_all(&handle);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The skills are ours, but a later edit could still add a frontmatter key
    /// Claude Code acts on (`hooks` runs commands, `allowed-tools` widens
    /// permissions) or a `!` line it runs while loading a skill.
    #[test]
    fn built_in_skills_stay_plain() {
        for (name, contents) in SKILLS {
            let mut lines = contents.lines();
            assert_eq!(lines.next(), Some("---"), "{name} opens with frontmatter");
            let frontmatter: Vec<&str> = lines.take_while(|line| *line != "---").collect();
            assert_eq!(frontmatter.first().copied(), Some(format!("name: {name}").as_str()), "{name} is named after its folder");
            let keys: Vec<&str> = frontmatter
                .iter()
                .filter(|line| !line.is_empty() && !line.starts_with(' '))
                .map(|line| line.split(':').next().unwrap_or(""))
                .collect();
            assert_eq!(keys, ["name", "description"], "{name} frontmatter");
        }
        for text in SKILLS.iter().map(|(_, contents)| *contents).chain([SYSTEM_PROMPT]) {
            assert!(!text.contains("!`"), "a shell line");
            assert!(!text.contains("```!"), "a shell block");
            // .gitattributes pins these to LF, so every platform ships the same bytes.
            assert!(!text.contains('\r'), "CRLF line endings");
        }
    }

    #[test]
    fn prompt_names_the_server_and_every_skill() {
        assert!(SYSTEM_PROMPT.contains(&format!("mcp__{MCP_SERVER_NAME}__")));
        for (name, _) in SKILLS {
            assert!(SYSTEM_PROMPT.contains(&format!("{PLUGIN_NAME}:{name}")), "{name}");
        }
        // Nothing sends the agent to a skill this build does not ship.
        let prefix = format!("{PLUGIN_NAME}:");
        for text in SKILLS.iter().map(|(_, contents)| *contents).chain([SYSTEM_PROMPT]) {
            for (at, _) in text.match_indices(&prefix) {
                let rest = &text[at + prefix.len()..];
                let name: String = rest.chars().take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-').collect();
                let name = name.trim_end_matches('-');
                if !name.is_empty() {
                    assert!(SKILLS.iter().any(|(skill, _)| *skill == name), "{prefix}{name} is not a built-in skill");
                }
            }
        }
    }

    /// A skill folder the list above leaves out is never compiled in, and so
    /// never checked or shipped, however much the prompt talks about it.
    #[test]
    fn every_skill_folder_is_compiled_in() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("claude-agent").join("skills");
        let mut on_disk: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        on_disk.sort();
        let mut built: Vec<&str> = SKILLS.iter().map(|(name, _)| *name).collect();
        built.sort();
        assert_eq!(on_disk, built);
    }

    #[test]
    fn ids_and_models() {
        assert!(valid_uuid("6e6cdc77-0d28-43a0-955d-9cad1fb02032"));
        assert!(!valid_uuid("6e6cdc77-0d28-43a0-955d-9cad1fb0203"));
        assert!(!valid_uuid("--resume-6e6cdc77-0d28-43a0-955d-9cad1fb"));
        assert!(valid_model("opus"));
        assert!(valid_model("claude-opus-5-5[1m]"));
        assert!(!valid_model("opus --dangerously-skip-permissions"));
        assert!(!valid_model("--tools"));
        assert!(!valid_model(""));
        assert!(valid_spawn_id("cc-1727600000000-ab12"));
        assert!(!valid_spawn_id("a b"));
    }

    #[test]
    fn turn_markers() {
        assert!(starts_turn(r#"{"type":"user","message":{"role":"user","content":[]},"parent_tool_use_id":null,"session_id":""}"#));
        assert!(!starts_turn(r#"{"type":"control_request","request_id":"x","request":{"subtype":"interrupt"}}"#));
        assert!(ends_turn(r#"{"type":"result","subtype":"success","is_error":false}"#));
        assert!(!ends_turn(r#"{"type":"assistant","message":{}}"#));
    }

    #[test]
    fn slims_large_image_lines() {
        let big = "A".repeat(LARGE_LINE + 10);
        let line = json!({
            "type": "user",
            "message": { "content": [ { "type": "tool_result", "content": [
                { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": big } }
            ] } ] }
        })
        .to_string();
        let slim = slim_line(line);
        assert!(slim.len() < 1000);
        assert!(slim.contains("\"elided\":true"));
        let small = json!({ "type": "result" }).to_string();
        assert_eq!(slim_line(small.clone()), small);
    }

    #[test]
    fn workspace_is_written_from_the_build() {
        let dir = std::env::temp_dir().join(format!("osg-claude-ws-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let ws = prepare_workspace(&dir, "http://127.0.0.1:8722/mcp", "tok").unwrap();
        assert!(ws.cwd.is_dir());
        assert_eq!(std::fs::read_to_string(&ws.system_prompt).unwrap(), SYSTEM_PROMPT);
        let manifest: Value = serde_json::from_slice(&std::fs::read(ws.plugin.join(".claude-plugin").join("plugin.json")).unwrap()).unwrap();
        assert_eq!(manifest["name"], PLUGIN_NAME);
        for (name, contents) in SKILLS {
            let written = std::fs::read_to_string(ws.plugin.join("skills").join(name).join("SKILL.md")).unwrap();
            assert_eq!(written, *contents, "{name}");
        }
        let config: Value = serde_json::from_slice(&std::fs::read(&ws.mcp_config).unwrap()).unwrap();
        assert_eq!(config["mcpServers"]["osg-editor"]["headers"]["Authorization"], "Bearer tok");
        let settings: Value = serde_json::from_slice(&std::fs::read(&ws.settings).unwrap()).unwrap();
        assert_eq!(settings, json!({ "disableAllHooks": true }));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&ws.mcp_config).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        // Anything an older build left in the plugin is gone after the next start.
        std::fs::write(ws.plugin.join("skills").join("stale.md"), "old").unwrap();
        std::fs::create_dir_all(ws.plugin.join("skills").join("old-skill")).unwrap();
        std::fs::write(ws.plugin.join("skills").join("osg-design").join("notes.md"), "old").unwrap();
        // An unchanged file is not written again: a process starting beside
        // this one may be reading it.
        let skill = ws.plugin.join("skills").join("osg-design").join("SKILL.md");
        let long_ago = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        std::fs::File::options().write(true).open(&skill).unwrap().set_modified(long_ago).unwrap();

        let again = prepare_workspace(&dir, "http://127.0.0.1:8723/mcp", "tok2").unwrap();
        assert!(!again.plugin.join("skills").join("stale.md").exists());
        assert!(!again.plugin.join("skills").join("old-skill").exists());
        assert!(!again.plugin.join("skills").join("osg-design").join("notes.md").exists());
        assert_eq!(std::fs::metadata(&skill).unwrap().modified().unwrap(), long_ago);
        let config: Value = serde_json::from_slice(&std::fs::read(&again.mcp_config).unwrap()).unwrap();
        assert_eq!(config["mcpServers"]["osg-editor"]["url"], "http://127.0.0.1:8723/mcp");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn capture_stops_at_its_deadline() {
        // A command that never exits: the capture must come back on time.
        #[cfg(windows)]
        let (program, args) = ("ping", vec!["-n", "30", "127.0.0.1"]);
        #[cfg(not(windows))]
        let (program, args) = ("sleep", vec!["30"]);
        let started = Instant::now();
        let result = run_capture(Path::new(program), &args, &[], Duration::from_millis(800));
        assert!(result.is_err());
        assert!(started.elapsed() < Duration::from_secs(5), "took {:?}", started.elapsed());
    }
}
