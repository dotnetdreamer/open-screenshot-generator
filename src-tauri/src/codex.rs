//! Codex, run on the user's own machine and on their own ChatGPT plan.
//!
//! The Agent panel can talk to the Codex CLI the user already has installed
//! and signed in to, as well as to Claude Code (claude_code.rs). Nothing here
//! asks for a login: Codex brings its own, from the user's `~/.codex/auth.json`.
//!
//! What this module does:
//!   - finds the binary: PATH (with a login shell's PATH in front, as for
//!     Claude Code), the places installers put it, and the copy the ChatGPT
//!     extension for VS Code and its forks ships;
//!   - runs `codex app-server` over stdio, in a workspace of its own under the
//!     app's local data directory, and speaks its JSON-RPC protocol itself: it
//!     opens the conversation, starts and interrupts turns, and answers every
//!     request the server sends back;
//!   - relays the server's notifications about the conversation to the editor
//!     window as events.
//!
//! What the process may do is fixed here, never by the frontend. It runs with
//! a Codex home of its own (`CODEX_HOME`), whose config.toml this module
//! writes: no shell, no web search, no file edits (the sandbox is read-only
//! and approvals are refused), no plugins, apps, hooks, skills, memories or
//! sub-agent features, and one MCP server, the app's own, whose tools are
//! pre-approved and reached with a bearer token from the environment. The
//! user's own Codex setup is never loaded; only their login is shared, by a
//! link to their auth.json, so a token Codex refreshes lands in their own file.
//! On macOS and Linux `HOME` points at an empty folder too, which keeps the
//! skills in `~/.agents` out of reach. The brief is compiled in from
//! src-tauri/codex-agent/ and the skills in src-tauri/claude-agent/skills/.
//! The frontend picks the model, the effort level and the conversation to
//! resume, and sends a turn as text and base64 pictures; Rust builds every
//! JSON-RPC line, so nothing the page sends reaches the protocol as written.

use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};

use crate::claude_code::{
    first_line, hide_console, home_dir, kill_tree, login_shell_path, merged_path, pump_lines, run_capture_with,
    sandboxed, valid_spawn_id, valid_uuid, write_if_changed, StartingGuard, SKILLS,
};

/// Event the editor window listens on. Must match `CODEX_EVENT` in
/// src/lib/codex/desktopTransport.ts.
const EVENT: &str = "abs-codex-event";

/// The name the app's MCP server goes by inside Codex. Codex hands its tools
/// to the model as `tools.mcp__osg_editor__<tool>` inside exec, and the brief
/// names them that way.
const MCP_SERVER_NAME: &str = "osg-editor";

/// The environment variable the bearer token reaches Codex in, so it is never
/// written to a file.
const TOKEN_VAR: &str = "OSG_MCP_TOKEN";

/// The agent's instructions, sent as the thread's developer instructions with
/// the skills after them (developer_instructions). Every tool these files name
/// has to exist on the MCP server (tests/unit/agentBrief.test.ts checks).
const SYSTEM_PROMPT: &str = include_str!("../codex-agent/system-prompt.md");

/// Folder under the app's local data directory the agent runs in.
const WORKSPACE_DIR: &str = "codex-agent";

/// Codex's home for the agent: the config below, the link to the user's
/// login, and the conversations Codex files there.
const HOME_DIR: &str = "home";

/// What `HOME` is for the process on macOS and Linux: an empty folder, so
/// nothing in the user's own home (the skills in ~/.agents) is found.
const USER_DIR: &str = "user";

/// The working directory, empty, so Codex has nothing to tell the model about
/// it. Stable, since the conversations are filed with it.
const SESSION_DIR: &str = "session";

/// Everything the agent's Codex is set up with, bar the MCP server, which
/// spawn_args adds with the port the server has right now.
///
/// A feature this Codex does not know is ignored, so one list serves old and
/// new versions alike. code_mode_host stays on: the current models reach every
/// tool, the design tools too, by writing JavaScript for exec, which runs in a
/// V8 isolate with no file system and no network. web_search is off by its own
/// key, the sandbox is read-only and approvals are never asked for, so a
/// command or a patch that somehow came up is refused rather than run.
const CONFIG_TOML: &str = r#"# Written by Open Screenshot Generator for its Codex design agent and
# rewritten on every start. This folder is the agent's own Codex home: the
# only thing it shares with your own Codex setup is the login, which
# auth.json links to.

web_search = "disabled"
notify = []
project_doc_max_bytes = 0
check_for_update_on_startup = false
include_permissions_instructions = false
include_environment_context = false
include_apps_instructions = false
include_collaboration_mode_instructions = false
sandbox_mode = "read-only"
approval_policy = "never"
allow_login_shell = false
cli_auth_credentials_store = "file"

[skills]
include_instructions = false

[skills.bundled]
enabled = false

[history]
persistence = "none"

[analytics]
enabled = false

[feedback]
enabled = false

[tools.experimental_request_user_input]
enabled = false

[features]
shell_tool = false
unified_exec = false
unified_exec_tty = false
shell_snapshot = false
multi_agent = false
multi_agent_v2 = false
apps = false
plugins = false
remote_plugin = false
plugin_sharing = false
recommended_plugins = false
hooks = false
memories = false
image_generation = false
view_image = false
browser_use = false
browser_use_external = false
browser_use_full_cdp_access = false
in_app_browser = false
computer_use = false
code_mode = false
code_mode_only = false
code_mode_host = true
js_repl = false
goals = false
sleep_tool = false
tool_suggest = false
skill_search = false
skill_mcp_dependency_install = false
realtime_conversation = false
worktrees = false
workspace_dependencies = false
guardian_approval = false
request_permissions_tool = false
standalone_web_search = false
"#;

/// More than this many live processes means something is leaking them.
const MAX_SESSIONS: usize = 4;

/// The longest turn text abs_codex_send passes on. The editor context and the
/// user's words come to a few kilobytes.
const MAX_TURN_TEXT: usize = 1024 * 1024;
/// Pictures one turn may carry, and the base64 of each.
const MAX_TURN_IMAGES: usize = 8;
const MAX_IMAGE_BASE64: usize = 12 * 1024 * 1024;
const IMAGE_TYPES: &[&str] = &["image/png", "image/jpeg", "image/webp", "image/gif"];

/// The effort levels a turn may ask for. Codex's own `ultra` hands the work to
/// sub-agents, which this agent has no use for.
const EFFORT_LEVELS: &[&str] = &["minimal", "low", "medium", "high", "xhigh", "max"];

/// How long the start waits for each step of the handshake. thread/start also
/// waits for the MCP server to connect.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const THREAD_TIMEOUT: Duration = Duration::from_secs(90);
/// How long detection waits for the probe to answer, all steps together.
const PROBE_TIMEOUT: Duration = Duration::from_secs(25);

/// A relayed notification longer than this is almost always a design tool's
/// result with a rendered PNG in it, and the panel never draws those at full
/// size. Its inline image data over MAX_INLINE_IMAGE is dropped.
const LARGE_LINE: usize = 512 * 1024;
const MAX_INLINE_IMAGE: usize = 256 * 1024;

/// How many stderr lines travel with the exit event.
const STDERR_TAIL: usize = 20;

/// How long the exit event waits for the pipe readers once the process is gone.
const READER_GRACE: Duration = Duration::from_secs(2);

/// The same turn sent again within this long is Tauri's IPC retry, not the
/// user: the store sends nothing while a turn runs.
const DUPLICATE_WINDOW: Duration = Duration::from_secs(1);

/// Why a start fails when the page that asked for it is gone (on_page_load).
const RELOADED: &str = "The editor reloaded while Codex was starting";

const SANDBOXED: &str = "Codex cannot run from the Mac App Store version of the app";

/// What the model is told when Codex asks to run a command or change a file.
/// With approvals set to never it should not ask at all.
const REFUSAL: &str = "The design agent cannot run commands or change files";

/// The notifications the editor window gets. The rest (the thread's status,
/// reasoning deltas, file and command events this agent never makes) stay here.
const FORWARDED: &[&str] = &[
    "turn/started",
    "turn/completed",
    "item/started",
    "item/completed",
    "item/agentMessage/delta",
    "thread/tokenUsage/updated",
    "account/rateLimits/updated",
    "mcpServer/startupStatus/updated",
    "error",
    "warning",
    "configWarning",
    "deprecationNotice",
    "thread/compacted",
    "model/rerouted",
];

/// What an answer to one of this module's own requests is for.
enum Pending {
    /// Someone is waiting for it (the handshake).
    Wait(mpsc::Sender<Result<Value, String>>),
    /// A turn/start: its id, or why it failed.
    Turn,
    /// A turn/interrupt, which only the log hears about when it fails.
    Interrupt,
}

/// One running `codex app-server`.
struct Running {
    pid: u32,
    /// Lines for the writer thread, which owns stdin. Taken (None) to close it.
    input: Mutex<Option<mpsc::Sender<String>>>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Pending>>,
    /// The conversation, once thread/start or thread/resume has answered.
    thread_id: Mutex<Option<String>>,
    /// The turn in progress, once Codex has named it.
    turn_id: Mutex<Option<String>>,
    /// A turn is in progress: set when one is sent, cleared when it completes
    /// or fails to start. What a reloaded editor believes about an adopted
    /// process.
    busy: AtomicBool,
    /// Stop was asked for before Codex named the turn. The interrupt goes out
    /// as soon as it does.
    interrupt_wanted: AtomicBool,
    stderr_tail: Mutex<VecDeque<String>>,
    /// A hash of the turn sent last, and when, to drop Tauri's IPC retry.
    last_turn: Mutex<Option<(u64, Instant)>>,
    /// The skills this Codex can see, whose `$name` mentions are defused in
    /// every turn. Empty unless something put skills where Codex looks.
    skills: Mutex<Vec<String>>,
}

impl Running {
    fn close_input(&self) {
        self.input.lock().unwrap().take();
    }

    fn write_line(&self, line: String) -> Result<(), String> {
        let guard = self.input.lock().unwrap();
        let input = guard.as_ref().ok_or_else(|| "That Codex session is closing".to_string())?;
        input.send(line).map_err(|_| "That Codex session has ended".to_string())
    }

    /// Send a request and remember what its answer is for.
    fn request(&self, method: &str, params: Value, pending: Pending) -> Result<u64, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        self.pending.lock().unwrap().insert(id, pending);
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string();
        if let Err(error) = self.write_line(line) {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        Ok(id)
    }

    /// Send a request and wait for its answer.
    fn call(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let (tx, rx) = mpsc::channel();
        let id = self.request(method, params, Pending::Wait(tx))?;
        match rx.recv_timeout(timeout) {
            Ok(answer) => answer,
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("Codex did not answer {method} in time"))
            }
        }
    }

    fn notify(&self, method: &str) -> Result<(), String> {
        self.write_line(json!({ "jsonrpc": "2.0", "method": method }).to_string())
    }

    /// Ask Codex to stop the turn in progress, or remember to once it has an id.
    fn interrupt(&self) {
        let thread = self.thread_id.lock().unwrap().clone();
        let turn = self.turn_id.lock().unwrap().clone();
        match (thread, turn) {
            (Some(thread), Some(turn)) => {
                self.interrupt_wanted.store(false, Ordering::SeqCst);
                let params = json!({ "threadId": thread, "turnId": turn });
                if let Err(error) = self.request("turn/interrupt", params, Pending::Interrupt) {
                    eprintln!("codex: could not interrupt the turn: {error}");
                }
            }
            _ => {
                if self.busy.load(Ordering::SeqCst) {
                    self.interrupt_wanted.store(true, Ordering::SeqCst);
                }
            }
        }
    }

    /// Codex named the turn in progress. A Stop that came first goes out now.
    fn turn_started(&self, turn: &str) {
        *self.turn_id.lock().unwrap() = Some(turn.to_string());
        if self.interrupt_wanted.load(Ordering::SeqCst) {
            self.interrupt();
        }
    }

    fn turn_over(&self) {
        self.busy.store(false, Ordering::SeqCst);
        self.interrupt_wanted.store(false, Ordering::SeqCst);
        self.turn_id.lock().unwrap().take();
    }

    /// The process is gone: nobody will answer what is still waiting.
    fn fail_pending(&self) {
        let pending: Vec<Pending> = self.pending.lock().unwrap().drain().map(|(_, entry)| entry).collect();
        for entry in pending {
            if let Pending::Wait(tx) = entry {
                let _ = tx.send(Err("Codex stopped".into()));
            }
        }
    }
}

#[derive(Default)]
pub struct CodexState {
    sessions: Mutex<HashMap<String, Arc<Running>>>,
    /// Starts past the point where they turned the MCP server on but not yet in
    /// `sessions`, counted by has_sessions as claude_code.rs counts its own.
    starting: AtomicUsize,
    /// The PATH a login shell reports, looked up on each detect.
    shell_path: Mutex<Option<String>>,
    /// Counts the pages the editor window has committed (on_page_load).
    page_epoch: AtomicU64,
    /// The spawn ids starts have claimed, newest last, so each is used once.
    claimed: Mutex<VecDeque<String>>,
}

const CLAIMED_KEEP: usize = 256;

impl CodexState {
    fn get(&self, spawn_id: &str) -> Option<Arc<Running>> {
        self.sessions.lock().unwrap().get(spawn_id).cloned()
    }

    fn path(&self) -> String {
        merged_path(&self.shell_path.lock().unwrap().clone().unwrap_or_default())
    }
}

/// The app's page-load hook (lib.rs), as for Claude Code: a start still in
/// flight when a new page commits in the editor belongs to a page that is gone.
pub fn on_page_load<R: Runtime>(webview: &tauri::Webview<R>, payload: &PageLoadPayload<'_>) {
    if webview.label() == "main" && payload.event() == PageLoadEvent::Started {
        webview.state::<CodexState>().page_epoch.fetch_add(1, Ordering::SeqCst);
    }
}

/// Whether the agent has a Codex process running or starting. The MCP server
/// stays up while it does (mcp_server::stop_if_unused).
pub fn has_sessions<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<CodexState>();
    // `starting` first, for the reason claude_code::has_sessions gives.
    state.starting.load(Ordering::SeqCst) > 0 || !state.sessions.lock().unwrap().is_empty()
}

/// Only the editor window may drive the agent. Detached panel windows send it
/// intents instead.
fn require_editor<R: Runtime>(window: &tauri::Window<R>) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("only the editor window can run the agent".into())
    }
}

// ---------------------------------------------------------------------------
// The environment
// ---------------------------------------------------------------------------

/// Variables the child keeps although they start with CODEX_: the certificate
/// a corporate proxy needs.
const KEPT_CODEX_VARS: &[&str] = &["CODEX_CA_CERTIFICATE"];

/// Whether a variable of the app's own environment stays out of the child.
///
/// Every OPENAI_ variable: OPENAI_API_KEY alone would move the bill from the
/// user's ChatGPT plan to API credit, and OPENAI_BASE_URL would send the
/// conversation elsewhere. Every CODEX_ variable but the certificate: they
/// carry other logins (CODEX_API_KEY, CODEX_ACCESS_TOKEN), other servers
/// (CODEX_EXEC_SERVER_URL), another home, and, when the app was started from
/// inside a Codex session, that session's sandbox and thread. The list of them
/// grows with every release, so it is a prefix rather than a list. RUST_LOG
/// too, which could make the child log what it sends. And Claude Code's own,
/// CLAUDE and ANTHROPIC_: an app started from a Claude Code terminal (a
/// developer's `tauri dev`) hands its children that session's id, socket and
/// messaging token, which Codex has no use for.
fn scrubbed_var(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    let foreign = upper.starts_with("OPENAI_")
        || upper.starts_with("CODEX_")
        || upper.starts_with("CLAUDE")
        || upper.starts_with("ANTHROPIC_")
        || upper == "RUST_LOG";
    foreign && !KEPT_CODEX_VARS.contains(&upper.as_str())
}

fn scrub_env(command: &mut Command) {
    for (name, _) in std::env::vars_os() {
        if name.to_str().is_some_and(scrubbed_var) {
            command.env_remove(&name);
        }
    }
    if std::env::var_os("APPIMAGE").is_some() {
        for key in ["LD_LIBRARY_PATH", "LD_PRELOAD", "GIO_EXTRA_MODULES", "GDK_BACKEND"] {
            command.env_remove(key);
        }
    }
}

// ---------------------------------------------------------------------------
// Finding the binary
// ---------------------------------------------------------------------------

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexDetection {
    found: bool,
    path: Option<String>,
    /// As printed by `codex --version`, for example "codex-cli 0.162.0".
    version: Option<String>,
    logged_in: Option<bool>,
    /// "chatgpt" for a ChatGPT plan, "apiKey" for an API key, or another mode.
    auth_method: Option<String>,
    /// "plus", "pro" and so on, for a ChatGPT login.
    plan_type: Option<String>,
    /// "keyring" when the user's Codex keeps its login in the system keychain,
    /// which the agent's own Codex home cannot share.
    login_store: Option<String>,
    /// The models this login can use, as Codex lists them.
    models: Vec<CodexModel>,
    /// Why Codex cannot run here whatever is installed ("sandboxed").
    unavailable: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModel {
    id: String,
    display_name: String,
    /// The effort levels it takes, of EFFORT_LEVELS, in Codex's order.
    efforts: Vec<String>,
    default_effort: Option<String>,
    is_default: bool,
}

/// The version in a folder name such as `openai.chatgpt-26.1007.21434-darwin-arm64`,
/// for picking the newest copy an editor keeps.
fn extension_version(name: &str) -> Option<Vec<u64>> {
    let rest = name.strip_prefix("openai.chatgpt-")?;
    let version = rest.split('-').next()?;
    let parts: Option<Vec<u64>> = version.split('.').map(|part| part.parse().ok()).collect();
    parts.filter(|parts| !parts.is_empty())
}

/// The `codex` the ChatGPT extension ships, in VS Code and the editors built on
/// it: `<extensions>/openai.chatgpt-<version>-<platform>/bin/<platform>/codex`.
/// The newest version wins, since an editor keeps the old folder a while.
fn extension_binaries(home: &Path) -> Vec<PathBuf> {
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    let mut found: Vec<(Vec<u64>, PathBuf)> = Vec::new();
    for editor in [".vscode", ".vscode-insiders", ".cursor", ".windsurf", ".vscode-oss"] {
        let Ok(entries) = std::fs::read_dir(home.join(editor).join("extensions")) else {
            continue;
        };
        for entry in entries.flatten() {
            let Some(version) = entry.file_name().to_str().and_then(extension_version) else {
                continue;
            };
            let Ok(platforms) = std::fs::read_dir(entry.path().join("bin")) else {
                continue;
            };
            for platform in platforms.flatten() {
                let candidate = platform.path().join(name);
                if candidate.is_file() {
                    found.push((version.clone(), candidate));
                }
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Where the installers put `codex` when it is not on this process's PATH.
fn known_locations() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let home = home_dir();
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            let npm = PathBuf::from(&appdata).join("npm");
            // npm's package ships the native binary, and spawning it skips
            // cmd.exe and its argument quoting.
            for triple in ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"] {
                out.push(
                    npm.join("node_modules")
                        .join("@openai")
                        .join("codex")
                        .join("vendor")
                        .join(triple)
                        .join("codex")
                        .join("codex.exe"),
                );
            }
            out.push(npm.join("codex.cmd"));
        }
        if let Some(home) = &home {
            out.push(home.join(".local").join("bin").join("codex.exe"));
            out.push(home.join("scoop").join("shims").join("codex.exe"));
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            out.push(PathBuf::from(&local).join("Microsoft").join("WinGet").join("Links").join("codex.exe"));
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = &home {
            out.push(home.join(".local/bin/codex"));
            out.push(home.join(".npm-global/bin/codex"));
            out.push(home.join(".bun/bin/codex"));
            out.push(home.join(".volta/bin/codex"));
            out.push(home.join(".nix-profile/bin/codex"));
        }
        out.push(PathBuf::from("/opt/homebrew/bin/codex"));
        out.push(PathBuf::from("/usr/local/bin/codex"));
        out.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin/codex"));
        out.push(PathBuf::from("/usr/bin/codex"));
    }
    if let Some(home) = &home {
        out.extend(extension_binaries(home));
    }
    out
}

fn find_binary(state: &CodexState) -> Option<PathBuf> {
    // For testing against a specific build, and for installs nothing below finds.
    if let Some(custom) = std::env::var_os("OSG_CODEX_PATH") {
        let custom = PathBuf::from(custom);
        if custom.is_file() {
            return Some(custom);
        }
    }
    let separator = if cfg!(windows) { ';' } else { ':' };
    let path = state.path();
    let on_path = |name: &str| {
        path.split(separator)
            .map(|dir| Path::new(dir).join(name))
            .find(|candidate| candidate.is_file())
    };
    if !cfg!(windows) {
        return on_path("codex").or_else(|| known_locations().into_iter().find(|candidate| candidate.is_file()));
    }
    let is_exe = |candidate: &PathBuf| candidate.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
    on_path("codex.exe")
        .or_else(|| known_locations().into_iter().find(|candidate| is_exe(candidate) && candidate.is_file()))
        .or_else(|| on_path("codex.cmd"))
        .or_else(|| known_locations().into_iter().find(|candidate| candidate.is_file()))
}

// ---------------------------------------------------------------------------
// The workspace and the login
// ---------------------------------------------------------------------------

/// Where everything the process is given lives.
struct Workspace {
    home: PathBuf,
    user: PathBuf,
    cwd: PathBuf,
}

fn workspace_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join(WORKSPACE_DIR))
}

/// Bring the workspace to what this build ships. Only what differs is written,
/// because a second process can be starting from the same folder.
fn prepare_workspace(dir: &Path) -> Result<Workspace, String> {
    let home = dir.join(HOME_DIR);
    let user = dir.join(USER_DIR);
    let cwd = dir.join(SESSION_DIR);
    for folder in [&home, &user, &cwd] {
        std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // The home holds a link to the login and every design conversation.
        let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    }
    write_if_changed(&home.join("config.toml"), CONFIG_TOML.as_bytes())?;
    Ok(Workspace { home, user, cwd })
}

/// The user's own Codex home, where their login is: CODEX_HOME as the app was
/// started with it, else ~/.codex.
fn user_codex_home() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".codex")))
}

/// What linking the login found.
#[derive(Debug, PartialEq, Eq)]
enum Login {
    /// The agent's Codex home links to the user's auth.json.
    Linked,
    /// The user has no auth.json: not signed in, or a login kept elsewhere.
    Missing,
}

/// Point `<home>/auth.json` at the user's own. Codex writes a refreshed token
/// into the file in place, so through the link it lands in the user's file
/// and their own Codex keeps working (checked on 0.162). Nothing here ever
/// writes the user's file, and removing the link leaves it alone.
fn link_login(home: &Path, user_home: Option<&Path>) -> Result<Login, String> {
    let link = home.join("auth.json");
    let target = user_home.map(|dir| dir.join("auth.json")).filter(|target| target.is_file());
    let Some(target) = target else {
        if std::fs::symlink_metadata(&link).is_ok() {
            std::fs::remove_file(&link).map_err(|e| e.to_string())?;
        }
        return Ok(Login::Missing);
    };
    #[cfg(unix)]
    {
        if std::fs::read_link(&link).is_ok_and(|current| current == target) {
            return Ok(Login::Linked);
        }
        if std::fs::symlink_metadata(&link).is_ok() {
            std::fs::remove_file(&link).map_err(|e| e.to_string())?;
        }
        std::os::unix::fs::symlink(&target, &link).map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        // A symbolic link needs Developer Mode; a hard link does not, but it
        // keeps the file the user had when it was made, so it is made again on
        // every start.
        if std::fs::symlink_metadata(&link).is_ok() {
            std::fs::remove_file(&link).map_err(|e| e.to_string())?;
        }
        if std::os::windows::fs::symlink_file(&target, &link).is_err() {
            std::fs::hard_link(&target, &link).map_err(|e| e.to_string())?;
        }
    }
    Ok(Login::Linked)
}

/// Whether the user's config keeps the login out of auth.json, which a Codex
/// home of the agent's own cannot share.
fn login_in_keyring(user_home: &Path) -> bool {
    let Ok(config) = std::fs::read_to_string(user_home.join("config.toml")) else {
        return false;
    };
    config.lines().any(|line| {
        let line = line.trim();
        line.starts_with("cli_auth_credentials_store")
            && (line.contains("\"keyring\"") || line.contains("\"auto\"") || line.contains("'keyring'"))
    })
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

/// Everything one process is started with.
struct SpawnPlan<'a> {
    workspace: &'a Workspace,
    /// The MCP server's URL and token. None for the detection probe, which
    /// needs no tools.
    mcp: Option<(&'a str, &'a str)>,
    /// What the child's PATH is.
    path: &'a str,
}

/// The `-c` overrides that add the app's MCP server, one key each and none
/// quoted, so a Windows npm shim passes them on as they are.
fn mcp_overrides(url: &str) -> Vec<String> {
    let key = |name: &str| format!("mcp_servers.{MCP_SERVER_NAME}.{name}");
    vec![
        format!("{}={url}", key("url")),
        format!("{}={TOKEN_VAR}", key("bearer_token_env_var")),
        // The design tools run without asking: nobody is there to approve them.
        format!("{}=approve", key("default_tools_approval_mode")),
        format!("{}=30", key("startup_timeout_sec")),
        // Longer than the server's own wait for its slowest tools (180s), so a
        // stalled tool comes back as the server's error rather than Codex's.
        format!("{}=240", key("tool_timeout_sec")),
        format!("{}=false", key("supports_parallel_tool_calls")),
    ]
}

/// A URL the overrides can carry unquoted. The app's own server always is one.
fn plain_url(url: &str) -> bool {
    url.starts_with("http://127.0.0.1:")
        && url.len() < 64
        && url.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '/' | '.'))
}

fn agent_command(binary: &Path, plan: &SpawnPlan<'_>) -> Command {
    let mut command = Command::new(binary);
    command.current_dir(&plan.workspace.cwd).arg("app-server");
    if let Some((url, _)) = plan.mcp {
        for value in mcp_overrides(url) {
            command.arg("-c").arg(value);
        }
    }
    scrub_env(&mut command);
    command
        .env("CODEX_HOME", &plan.workspace.home)
        .env("PATH", plan.path)
        .env("NO_COLOR", "1");
    #[cfg(unix)]
    {
        command.env("HOME", &plan.workspace.user);
    }
    if let Some((_, token)) = plan.mcp {
        command.env(TOKEN_VAR, token);
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_console(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

/// The thread's developer instructions: the brief, then each skill's body,
/// since this agent has no way to load a skill on its own.
fn developer_instructions() -> String {
    let mut out = String::from(SYSTEM_PROMPT.trim_end());
    for (name, contents) in SKILLS {
        out.push_str(&format!("\n\n# Design guide: {name}\n\n{}", skill_body(contents).trim()));
    }
    out.push('\n');
    out
}

/// A skill without its frontmatter.
fn skill_body(contents: &str) -> &str {
    let Some(rest) = contents.strip_prefix("---\n") else {
        return contents;
    };
    match rest.find("\n---\n") {
        Some(end) => &rest[end + 5..],
        None => contents,
    }
}

/// What thread/start and thread/resume share.
fn thread_params(workspace: &Workspace, model: Option<&str>) -> Map<String, Value> {
    let mut params = Map::new();
    params.insert("cwd".into(), Value::String(workspace.cwd.display().to_string()));
    params.insert("approvalPolicy".into(), Value::String("never".into()));
    params.insert("sandbox".into(), Value::String("read-only".into()));
    params.insert("developerInstructions".into(), Value::String(developer_instructions()));
    if let Some(model) = model {
        params.insert("model".into(), Value::String(model.into()));
    }
    params
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/// A short app-server run that answers who is signed in and which models they
/// have, without starting a conversation or spending any usage.
fn probe(binary: &Path, workspace: &Workspace, path: &str, detection: &mut CodexDetection) -> Result<(), String> {
    let plan = SpawnPlan { workspace, mcp: None, path };
    let mut child = agent_command(binary, &plan).spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || pump_lines(stdout, |line| drop(tx.send(line))));
    let err_tail = Arc::new(Mutex::new(Vec::<String>::new()));
    let err_sink = err_tail.clone();
    std::thread::spawn(move || {
        pump_lines(stderr, |line| {
            let mut tail = err_sink.lock().unwrap();
            if tail.len() < STDERR_TAIL {
                tail.push(line.chars().take(300).collect());
            }
        })
    });
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let mut ask = |id: u64, method: &str, params: Value| -> Result<Value, String> {
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string();
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
            .map_err(|_| "Codex stopped before it answered".to_string())?;
        loop {
            let now = Instant::now();
            if now >= deadline {
                return Err("Codex did not answer in time".into());
            }
            let line = match rx.recv_timeout(deadline - now) {
                Ok(line) => line,
                Err(RecvTimeoutError::Timeout) => return Err("Codex did not answer in time".into()),
                Err(RecvTimeoutError::Disconnected) => return Err("Codex stopped before it answered".into()),
            };
            let Ok(Value::Object(message)) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if message.contains_key("method") || message.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }
            if let Some(error) = message.get("error") {
                return Err(error.get("message").and_then(Value::as_str).unwrap_or("Codex refused").to_string());
            }
            return Ok(message.get("result").cloned().unwrap_or(Value::Null));
        }
    };
    let answered = (|| {
        ask(1, "initialize", initialize_params())?;
        let account = ask(2, "account/read", json!({ "refreshToken": false }))?;
        read_account(&account, detection);
        if detection.logged_in == Some(true) {
            if let Ok(models) = ask(3, "model/list", json!({})) {
                detection.models = read_models(&models);
            }
        }
        Ok::<(), String>(())
    })();
    let exited = child.try_wait().is_ok_and(|status| status.is_some());
    kill_tree(pid);
    let _ = child.kill();
    let _ = child.wait();
    answered.map_err(|error| {
        // A Codex that died says why on stderr; one that hung says nothing useful.
        if !exited {
            return error;
        }
        let tail = err_tail.lock().unwrap();
        tail.iter().rev().map(|line| first_line(line)).find(|line| !line.is_empty()).unwrap_or(error)
    })
}

fn initialize_params() -> Value {
    json!({
        "clientInfo": {
            "name": "open_screenshot_generator",
            "title": "Open Screenshot Generator",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": { "experimentalApi": false },
    })
}

/// account/read's answer, into the detection.
fn read_account(result: &Value, detection: &mut CodexDetection) {
    let account = result.get("account").filter(|account| account.is_object());
    detection.logged_in = Some(account.is_some());
    if let Some(account) = account {
        detection.auth_method = account.get("type").and_then(Value::as_str).map(String::from);
        detection.plan_type = account.get("planType").and_then(Value::as_str).map(String::from);
    }
}

/// model/list's answer: the models shown in Codex's own picker that take
/// pictures, each with the effort levels this agent offers.
fn read_models(result: &Value) -> Vec<CodexModel> {
    let Some(data) = result.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    data.iter()
        .filter(|model| model.get("hidden").and_then(Value::as_bool) != Some(true))
        .filter(|model| {
            model
                .get("inputModalities")
                .and_then(Value::as_array)
                .map_or(true, |kinds| kinds.iter().any(|kind| kind == "image"))
        })
        .filter_map(|model| {
            let id = model.get("model").or_else(|| model.get("id")).and_then(Value::as_str)?;
            if !valid_model(id) {
                return None;
            }
            let efforts = model
                .get("supportedReasoningEfforts")
                .and_then(Value::as_array)
                .map(|levels| {
                    levels
                        .iter()
                        .filter_map(|level| level.get("reasoningEffort").and_then(Value::as_str))
                        .filter(|level| EFFORT_LEVELS.contains(level))
                        .map(String::from)
                        .collect()
                })
                .unwrap_or_default();
            Some(CodexModel {
                id: id.to_string(),
                display_name: model
                    .get("displayName")
                    .and_then(Value::as_str)
                    .filter(|name| !name.is_empty())
                    .unwrap_or(id)
                    .chars()
                    .take(60)
                    .collect(),
                efforts,
                default_effort: model
                    .get("defaultReasoningEffort")
                    .and_then(Value::as_str)
                    .filter(|level| EFFORT_LEVELS.contains(level))
                    .map(String::from),
                is_default: model.get("isDefault").and_then(Value::as_bool) == Some(true),
            })
        })
        .take(20)
        .collect()
}

fn detect<R: Runtime>(app: &AppHandle<R>) -> CodexDetection {
    if sandboxed() {
        return CodexDetection { unavailable: Some("sandboxed".into()), ..Default::default() };
    }
    let state = app.state::<CodexState>();
    // Refreshed on every detect, so "Check again" after an install that edited
    // the shell profile finds the new binary.
    *state.shell_path.lock().unwrap() = login_shell_path();
    let Some(binary) = find_binary(&state) else {
        return CodexDetection::default();
    };
    let path = state.path();
    let mut detection = CodexDetection {
        found: true,
        path: Some(binary.display().to_string()),
        ..Default::default()
    };
    let env = [("PATH", path.as_str())];
    match run_capture_with(&binary, &["--version"], &env, Duration::from_secs(20), scrub_env) {
        Ok(out) if out.success => detection.version = Some(first_line(&out.stdout)),
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
    let workspace = match workspace_dir(app).and_then(|dir| prepare_workspace(&dir)) {
        Ok(workspace) => workspace,
        Err(error) => {
            detection.error = Some(error);
            return detection;
        }
    };
    let user_home = user_codex_home();
    match link_login(&workspace.home, user_home.as_deref()) {
        Ok(Login::Linked) => {}
        Ok(Login::Missing) => {
            detection.logged_in = Some(false);
            if user_home.as_deref().is_some_and(login_in_keyring) {
                detection.login_store = Some("keyring".into());
            }
            return detection;
        }
        Err(error) => {
            eprintln!("codex: could not link the login: {error}");
            detection.error = Some("The app could not use your Codex login".into());
            return detection;
        }
    }
    if let Err(error) = probe(&binary, &workspace, &path, &mut detection) {
        detection.error = Some(error);
    }
    detection
}

#[tauri::command]
pub async fn abs_codex_detect<R: Runtime>(app: AppHandle<R>) -> Result<CodexDetection, String> {
    tauri::async_runtime::spawn_blocking(move || detect(&app))
        .await
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// The protocol
// ---------------------------------------------------------------------------

/// Codex's thread id of a notification, when it has one.
fn thread_of(params: &Value) -> Option<&str> {
    params.get("threadId").and_then(Value::as_str)
}

/// The answer to a request Codex sends the app. Everything that would run a
/// command, change a file, widen the sandbox or reach a person is declined;
/// anything else is an error. With approvals set to never, none of these
/// should arrive at all.
fn server_request_answer(method: &str) -> Result<Value, (i64, &'static str)> {
    match method {
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            Ok(json!({ "decision": "decline" }))
        }
        "execCommandApproval" | "applyPatchApproval" => Ok(json!({ "decision": { "denied": { "rejection": REFUSAL } } })),
        "item/permissions/requestApproval" => Ok(json!({ "permissions": {}, "scope": "turn" })),
        "mcpServer/elicitation/request" => Ok(json!({ "action": "decline", "content": null, "_meta": null })),
        "item/tool/requestUserInput" => Ok(json!({ "answers": {} })),
        "item/tool/call" => Ok(json!({ "contentItems": [], "success": false })),
        _ => Err((-32601, "Open Screenshot Generator does not answer this request")),
    }
}

fn answer_server_request(running: &Running, id: Value, method: &str) {
    let line = match server_request_answer(method) {
        Ok(result) => {
            eprintln!("codex: declined {method}");
            json!({ "jsonrpc": "2.0", "id": id, "result": result })
        }
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    };
    let _ = running.write_line(line.to_string());
}

/// Empty the bytes of every inline image over MAX_INLINE_IMAGE, marking it
/// `elided`. An MCP image block keeps them in `data`, a picture in a user
/// message in `url`.
fn elide_images(value: &mut Value) {
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("image") {
                for key in ["data", "url"] {
                    let oversized = matches!(map.get(key), Some(Value::String(bytes)) if bytes.len() > MAX_INLINE_IMAGE);
                    if oversized {
                        map.insert(key.into(), Value::String(String::new()));
                        map.insert("elided".into(), Value::Bool(true));
                    }
                }
            }
            map.values_mut().for_each(elide_images);
        }
        Value::Array(items) => items.iter_mut().for_each(elide_images),
        _ => {}
    }
}

/// What of a notification goes to the editor window, or None for nothing.
///
/// Only the methods in FORWARDED, and only for the chat's own thread once it
/// is known: a sub-agent's thread is noise. The user's own message is dropped,
/// since the panel has it already and its pictures are megabytes, and so is
/// reasoning, which the panel does not show. A turn's summary of its items is
/// left out for the same reason.
fn relayed(method: &str, mut params: Value, main_thread: Option<&str>) -> Option<Value> {
    if !FORWARDED.contains(&method) {
        return None;
    }
    if let (Some(main), Some(thread)) = (main_thread, thread_of(&params)) {
        if main != thread {
            return None;
        }
    }
    if method == "item/started" || method == "item/completed" {
        let kind = params.get("item").and_then(|item| item.get("type")).and_then(Value::as_str);
        if matches!(kind, Some("userMessage") | Some("reasoning") | Some("hookPrompt")) {
            return None;
        }
    }
    if method == "turn/started" || method == "turn/completed" {
        if let Some(Value::Object(turn)) = params.get_mut("turn") {
            turn.insert("items".into(), Value::Array(Vec::new()));
        }
    }
    let size = serde_json::to_string(&params).map_or(0, |text| text.len());
    if size > LARGE_LINE {
        elide_images(&mut params);
    }
    Some(params)
}

fn emit<R: Runtime>(app: &AppHandle<R>, mut payload: Value) {
    // The editor window only, with the nonce the editor checks, for the reasons
    // claude_code::emit gives.
    payload["nonce"] = Value::String(crate::mcp_server::bridge_nonce(app));
    let _ = app.emit_to("main", EVENT, payload);
}

/// One line of the server's stdout: an answer to this module's request, a
/// request of the server's own, or a notification.
fn on_line<R: Runtime>(app: &AppHandle<R>, spawn_id: &str, running: &Running, line: &str) {
    let Ok(Value::Object(mut message)) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let method = message.get("method").and_then(Value::as_str).map(String::from);
    match (method, message.remove("id")) {
        (Some(method), Some(id)) => answer_server_request(running, id, &method),
        (Some(method), None) => {
            let params = message.remove("params").unwrap_or(Value::Null);
            on_notification(app, spawn_id, running, &method, params);
        }
        (None, Some(id)) => on_response(app, spawn_id, running, id, message),
        (None, None) => {}
    }
}

fn on_notification<R: Runtime>(app: &AppHandle<R>, spawn_id: &str, running: &Running, method: &str, params: Value) {
    let main = running.thread_id.lock().unwrap().clone();
    let ours = main.is_none() || thread_of(&params).map_or(true, |thread| Some(thread) == main.as_deref());
    if ours {
        let turn = params.get("turn").and_then(|turn| turn.get("id")).and_then(Value::as_str);
        match method {
            "turn/started" => {
                running.busy.store(true, Ordering::SeqCst);
                if let Some(turn) = turn {
                    running.turn_started(turn);
                }
            }
            "turn/completed" => running.turn_over(),
            _ => {}
        }
    }
    if let Some(params) = relayed(method, params, main.as_deref()) {
        emit(app, json!({ "spawnId": spawn_id, "kind": "notification", "method": method, "params": params }));
    }
}

fn on_response<R: Runtime>(app: &AppHandle<R>, spawn_id: &str, running: &Running, id: Value, message: Map<String, Value>) {
    let Some(id) = id.as_u64() else {
        return;
    };
    let Some(pending) = running.pending.lock().unwrap().remove(&id) else {
        return;
    };
    let answer = match message.get("error") {
        Some(error) => Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Codex refused the request")
            .chars()
            .take(500)
            .collect::<String>()),
        None => Ok(message.get("result").cloned().unwrap_or(Value::Null)),
    };
    match pending {
        Pending::Wait(tx) => {
            let _ = tx.send(answer);
        }
        Pending::Turn => match answer {
            Ok(result) => {
                if let Some(turn) = result.get("turn").and_then(|turn| turn.get("id")).and_then(Value::as_str) {
                    if running.turn_id.lock().unwrap().is_none() && running.busy.load(Ordering::SeqCst) {
                        running.turn_started(turn);
                    }
                }
            }
            Err(message) => {
                running.turn_over();
                emit(app, json!({ "spawnId": spawn_id, "kind": "turnFailed", "message": message }));
            }
        },
        Pending::Interrupt => {
            if let Err(message) = answer {
                eprintln!("codex: the interrupt was refused: {message}");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartArgs {
    spawn_id: String,
    /// A Codex model id. Omitted means Codex's own default.
    model: Option<String>,
    /// The thread id of an earlier conversation, to carry on where it stopped.
    resume: Option<String>,
    /// The page_epoch the asking page read when it loaded (abs_codex_page_epoch).
    page_epoch: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInfo {
    pid: u32,
    /// The conversation the process is on.
    thread_id: String,
    /// False when the conversation asked to resume was gone and this is a new one.
    resumed: bool,
    /// The model Codex says the thread runs on.
    model: Option<String>,
    mcp_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedSession {
    spawn_id: String,
    busy: bool,
    thread_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnImage {
    media_type: String,
    /// Base64, no data: prefix.
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnArgs {
    text: String,
    #[serde(default)]
    images: Vec<TurnImage>,
    model: Option<String>,
    effort: Option<String>,
}

/// A Codex model id, such as `gpt-6.1-sol`.
fn valid_model(model: &str) -> bool {
    (1..=64).contains(&model.len())
        && !model.starts_with('-')
        && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn valid_effort(effort: &str) -> bool {
    EFFORT_LEVELS.contains(&effort)
}

fn valid_base64(data: &str) -> bool {
    !data.is_empty() && data.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

/// U+2060 WORD JOINER, which shows as nothing.
const MENTION_BREAK: char = '\u{2060}';

fn skill_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ':')
}

/// The text with U+2060 after every `$` that would name one of `skills`.
///
/// Codex reads `$name` anywhere in a turn's text as a mention of the skill of
/// that name and puts the skill's whole file in front of the model (checked
/// on 0.162, inside a word too). Every turn's editor context carries names the
/// agent can set, so a board named after a skill would hand it that skill's
/// instructions with the user's next message. Only names of skills Codex can
/// see are touched: a price such as "$5" reaches the model as written, and with
/// the home this module sets up there are normally none.
fn defuse_skill_mentions(text: &str, skills: &[String]) -> String {
    if skills.is_empty() || !text.contains('$') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len() + 8);
    let mut rest = text;
    while let Some(at) = rest.find('$') {
        out.push_str(&rest[..=at]);
        rest = &rest[at + 1..];
        let names = skills.iter().any(|name| {
            rest.strip_prefix(name.as_str())
                .is_some_and(|after| !after.chars().next().is_some_and(skill_name_char))
        });
        if names {
            out.push(MENTION_BREAK);
        }
    }
    out.push_str(rest);
    out
}

/// turn/start's input: the text, defused, and each picture as a data: URL.
/// Never a URL of anything else: given an https address, the model's side
/// would fetch it.
fn turn_input(turn: &TurnArgs, skills: &[String]) -> Result<Vec<Value>, String> {
    if turn.text.len() > MAX_TURN_TEXT {
        return Err("That message is too large to send to Codex".into());
    }
    if turn.images.len() > MAX_TURN_IMAGES {
        return Err(format!("A message to Codex can carry up to {MAX_TURN_IMAGES} pictures"));
    }
    let mut input = vec![json!({
        "type": "text",
        "text": defuse_skill_mentions(&turn.text, skills),
        "text_elements": [],
    })];
    for image in &turn.images {
        if !IMAGE_TYPES.contains(&image.media_type.as_str()) {
            return Err("Codex takes PNG, JPEG, WebP and GIF pictures only".into());
        }
        if image.data.len() > MAX_IMAGE_BASE64 || !valid_base64(&image.data) {
            return Err("That picture could not be sent to Codex".into());
        }
        input.push(json!({ "type": "image", "url": format!("data:{};base64,{}", image.media_type, image.data) }));
    }
    Ok(input)
}

#[tauri::command]
pub async fn abs_codex_start<R: Runtime>(
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
            return Err(format!("{model} is not a model name Codex accepts"));
        }
    }
    if let Some(resume) = &args.resume {
        if !valid_uuid(resume) {
            return Err("invalid conversation id to resume".into());
        }
    }
    let epoch = args.page_epoch.unwrap_or_else(|| app.state::<CodexState>().page_epoch.load(Ordering::SeqCst));
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || start_blocking(&handle, args, epoch))
        .await
        .map_err(|e| e.to_string())?
}

fn start_blocking<R: Runtime>(app: &AppHandle<R>, args: StartArgs, epoch: u64) -> Result<StartInfo, String> {
    let state = app.state::<CodexState>();
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
        eprintln!("codex: the editor reloaded while {} was starting; nothing was spawned", args.spawn_id);
        return Err(RELOADED.into());
    }
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&args.spawn_id) {
            return Err("that session is already running".into());
        }
        if sessions.len() + state.starting.load(Ordering::SeqCst) >= MAX_SESSIONS {
            return Err("Too many Codex sessions are running. Stop one first".into());
        }
    }
    if sandboxed() {
        return Err(SANDBOXED.into());
    }
    state.starting.fetch_add(1, Ordering::SeqCst);
    let started = {
        let _starting = StartingGuard(&state.starting);
        spawn_session(app, &state, args, epoch)
    };
    if started.is_err() {
        crate::mcp_server::release_after_agent(app);
    }
    started
}

fn spawn_session<R: Runtime>(
    app: &AppHandle<R>,
    state: &CodexState,
    args: StartArgs,
    epoch: u64,
) -> Result<StartInfo, String> {
    if state.shell_path.lock().unwrap().is_none() {
        *state.shell_path.lock().unwrap() = login_shell_path();
    }
    let binary = find_binary(state).ok_or_else(|| "Codex is not installed on this computer".to_string())?;
    if state.page_epoch.load(Ordering::SeqCst) != epoch {
        eprintln!("codex: the editor reloaded while {} was starting; nothing was spawned", args.spawn_id);
        return Err(RELOADED.into());
    }
    let workspace = prepare_workspace(&workspace_dir(app)?)?;
    match link_login(&workspace.home, user_codex_home().as_deref()) {
        Ok(Login::Linked) => {}
        Ok(Login::Missing) => {
            return Err("Codex is not signed in. Run codex in a terminal, sign in, then send your message again".into())
        }
        Err(error) => {
            eprintln!("codex: could not link the login: {error}");
            return Err("The app could not use your Codex login".into());
        }
    }
    let (mcp, token) = crate::mcp_server::ensure_running(app)?;
    let mcp_url = mcp.url.clone().ok_or_else(|| "the design tools server did not start".to_string())?;
    if !plain_url(&mcp_url) {
        return Err("the design tools server is on an address Codex cannot be given".into());
    }

    let path = state.path();
    let plan = SpawnPlan { workspace: &workspace, mcp: Some((&mcp_url, &token)), path: &path };
    let mut child = agent_command(&binary, &plan)
        .spawn()
        .map_err(|e| format!("could not start Codex ({}): {e}", binary.display()))?;
    let pid = child.id();
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    // The writer owns stdin, so nothing else ever blocks on the pipe.
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
        next_id: AtomicU64::new(1),
        pending: Mutex::new(HashMap::new()),
        thread_id: Mutex::new(None),
        turn_id: Mutex::new(None),
        busy: AtomicBool::new(false),
        interrupt_wanted: AtomicBool::new(false),
        stderr_tail: Mutex::new(VecDeque::new()),
        last_turn: Mutex::new(None),
        skills: Mutex::new(Vec::new()),
    });
    {
        let mut sessions = state.sessions.lock().unwrap();
        if state.page_epoch.load(Ordering::SeqCst) != epoch {
            drop(sessions);
            kill_tree(pid);
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("codex: the editor reloaded while {} was starting; killed pid {pid}", args.spawn_id);
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
        pump_lines(stdout, |line| on_line(&out_app, &out_id, &out_running, &line));
        out_running.fail_pending();
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
            if sent < 200 {
                sent += 1;
                emit(&err_app, json!({ "spawnId": err_id, "kind": "stderr", "line": line }));
            }
        });
        let _ = err_done.send(());
    });
    let wait_app = app.clone();
    let wait_id = args.spawn_id.clone();
    let wait_running = running.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        wait_app.state::<CodexState>().sessions.lock().unwrap().remove(&wait_id);
        wait_running.fail_pending();
        let deadline = Instant::now() + READER_GRACE;
        for _ in 0..2 {
            let now = Instant::now();
            if now >= deadline || readers_rx.recv_timeout(deadline - now).is_err() {
                break;
            }
        }
        let code = status.ok().and_then(|s| s.code());
        let tail: Vec<String> = wait_running.stderr_tail.lock().unwrap().iter().cloned().collect();
        emit(&wait_app, json!({ "spawnId": wait_id, "kind": "exit", "code": code, "stderrTail": tail }));
        crate::mcp_server::release_after_agent(&wait_app);
    });

    match handshake(&running, &workspace, &args) {
        Ok((thread_id, resumed, model)) => {
            Ok(StartInfo { pid, thread_id, resumed, model, mcp_url })
        }
        Err(error) => {
            kill_tree(pid);
            running.close_input();
            Err(error)
        }
    }
}

/// initialize, then the conversation: the one asked for, or a new one when it
/// is gone (Codex keeps no conversation forever). Returns the thread id,
/// whether it was resumed, and the model Codex runs it on.
fn handshake(running: &Running, workspace: &Workspace, args: &StartArgs) -> Result<(String, bool, Option<String>), String> {
    running
        .call("initialize", initialize_params(), HANDSHAKE_TIMEOUT)
        .map_err(|error| format!("Codex did not start: {error}"))?;
    running.notify("initialized")?;
    // Whatever skills this Codex can see, so their mentions are defused.
    let cwd = workspace.cwd.display().to_string();
    if let Ok(listed) = running.call("skills/list", json!({ "cwds": [cwd] }), HANDSHAKE_TIMEOUT) {
        *running.skills.lock().unwrap() = skill_names(&listed);
    }
    let params = thread_params(workspace, args.model.as_deref());
    let mut resumed = false;
    let mut answer = None;
    if let Some(thread) = &args.resume {
        let mut resume = params.clone();
        resume.insert("threadId".into(), Value::String(thread.clone()));
        resume.insert("excludeTurns".into(), Value::Bool(true));
        match running.call("thread/resume", Value::Object(resume), THREAD_TIMEOUT) {
            Ok(result) => {
                resumed = true;
                answer = Some(result);
            }
            Err(error) => eprintln!("codex: could not resume {thread}, starting a new conversation: {error}"),
        }
    }
    let result = match answer {
        Some(result) => result,
        None => running
            .call("thread/start", Value::Object(params), THREAD_TIMEOUT)
            .map_err(|error| format!("Codex could not start the conversation: {error}"))?,
    };
    let thread_id = result
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .filter(|id| valid_uuid(id))
        .ok_or_else(|| "Codex did not say which conversation it opened".to_string())?
        .to_string();
    *running.thread_id.lock().unwrap() = Some(thread_id.clone());
    let model = result.get("model").and_then(Value::as_str).filter(|model| valid_model(model)).map(String::from);
    Ok((thread_id, resumed, model))
}

/// The names in skills/list's answer.
fn skill_names(result: &Value) -> Vec<String> {
    let mut names: Vec<String> = result
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("skills").and_then(Value::as_array))
        .flatten()
        .filter_map(|skill| skill.get("name").and_then(Value::as_str))
        .filter(|name| !name.is_empty() && name.chars().all(skill_name_char))
        .map(String::from)
        .collect();
    if !names.is_empty() {
        eprintln!("codex: {} skills are visible to the agent; their mentions are defused", names.len());
    }
    // Longest first, so a name that starts another is never matched short.
    names.sort_by(|a, b| b.len().cmp(&a.len()));
    names.dedup();
    names
}

/// Start a turn: the text and pictures the user sent, with the model and
/// effort picked for it. Returns at once: the writer thread does the IO, and
/// what happens next arrives as notifications. Refused while a turn runs,
/// because Codex would take the message as a steer of the running turn.
#[tauri::command]
pub async fn abs_codex_send<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, CodexState>,
    spawn_id: String,
    turn: TurnArgs,
) -> Result<(), String> {
    require_editor(&window)?;
    let running = state.get(&spawn_id).ok_or_else(|| "That Codex session has ended".to_string())?;
    if let Some(model) = &turn.model {
        if !valid_model(model) {
            return Err(format!("{model} is not a model name Codex accepts"));
        }
    }
    if let Some(effort) = &turn.effort {
        if !valid_effort(effort) {
            return Err(format!("{effort} is not an effort level Codex accepts"));
        }
    }
    let thread = running
        .thread_id
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Codex is still starting".to_string())?;
    let skills = running.skills.lock().unwrap().clone();
    let input = turn_input(&turn, &skills)?;
    {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        turn.text.hash(&mut hasher);
        turn.model.hash(&mut hasher);
        turn.effort.hash(&mut hasher);
        for image in &turn.images {
            image.media_type.hash(&mut hasher);
            image.data.len().hash(&mut hasher);
        }
        let digest = hasher.finish();
        let mut last = running.last_turn.lock().unwrap();
        if last.is_some_and(|(seen, at)| seen == digest && at.elapsed() < DUPLICATE_WINDOW) {
            return Ok(());
        }
        *last = Some((digest, Instant::now()));
    }
    if running.busy.swap(true, Ordering::SeqCst) {
        return Err("Codex is still working. Stop it before sending another message".into());
    }
    let mut params = Map::new();
    params.insert("threadId".into(), Value::String(thread));
    params.insert("input".into(), Value::Array(input));
    if let Some(model) = turn.model {
        params.insert("model".into(), Value::String(model));
    }
    if let Some(effort) = turn.effort {
        params.insert("effort".into(), Value::String(effort));
    }
    if let Err(error) = running.request("turn/start", Value::Object(params), Pending::Turn) {
        running.turn_over();
        return Err(error);
    }
    Ok(())
}

/// Stop the turn in progress. The process stays up for the next message.
#[tauri::command]
pub async fn abs_codex_interrupt<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, CodexState>,
    spawn_id: String,
) -> Result<(), String> {
    require_editor(&window)?;
    if let Some(running) = state.get(&spawn_id) {
        running.interrupt();
    }
    Ok(())
}

/// Stop now. The conversation stays on disk and the next message resumes it.
#[tauri::command]
pub async fn abs_codex_stop<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, CodexState>,
    spawn_id: String,
) -> Result<(), String> {
    require_editor(&window)?;
    if let Some(running) = state.get(&spawn_id) {
        let pid = running.pid;
        tauri::async_runtime::spawn_blocking(move || kill_tree(pid)).await.map_err(|e| e.to_string())?;
        running.close_input();
    }
    Ok(())
}

#[tauri::command]
pub fn abs_codex_page_epoch<R: Runtime>(
    window: tauri::Window<R>,
    state: tauri::State<'_, CodexState>,
) -> Result<u64, String> {
    require_editor(&window)?;
    Ok(state.page_epoch.load(Ordering::SeqCst))
}

/// The processes still running, whether each is mid-turn and its conversation,
/// so a reloaded editor can carry on with its own.
#[tauri::command]
pub fn abs_codex_list(state: tauri::State<'_, CodexState>) -> Vec<ListedSession> {
    state
        .sessions
        .lock()
        .unwrap()
        .iter()
        .map(|(id, running)| ListedSession {
            spawn_id: id.clone(),
            busy: running.busy.load(Ordering::SeqCst),
            thread_id: running.thread_id.lock().unwrap().clone(),
        })
        .collect()
}

/// End every Codex process, as claude_code::kill_all does for Claude Code.
pub fn kill_all<R: Runtime>(app: &AppHandle<R>) {
    let running: Vec<Arc<Running>> = app.state::<CodexState>().sessions.lock().unwrap().values().cloned().collect();
    for session in running {
        kill_tree(session.pid);
        session.close_input();
    }
}

/// No process outlives the editor window. lib.rs's exit hook covers quitting.
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

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("osg-codex-{name}-{}-{:?}", std::process::id(), Instant::now()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_config_switches_off_everything_but_the_design_tools() {
        let lines: Vec<&str> = CONFIG_TOML.lines().map(str::trim).collect();
        for expected in [
            "web_search = \"disabled\"",
            "sandbox_mode = \"read-only\"",
            "approval_policy = \"never\"",
            "cli_auth_credentials_store = \"file\"",
            "project_doc_max_bytes = 0",
            "notify = []",
            "shell_tool = false",
            "unified_exec = false",
            "apps = false",
            "plugins = false",
            "hooks = false",
            "memories = false",
            "computer_use = false",
            "browser_use = false",
            "image_generation = false",
            "view_image = false",
            "multi_agent = false",
            "code_mode_host = true",
        ] {
            assert!(lines.contains(&expected), "config.toml lacks {expected}");
        }
        // The user's own servers never come in: the only one is added per spawn.
        assert!(!CONFIG_TOML.contains("[mcp_servers"));
        // Never a key that reroutes the login or the model provider.
        for banned in ["model_provider", "openai_base_url", "chatgpt_base_url", "bearer_token =", "env_key"] {
            assert!(!CONFIG_TOML.contains(banned), "config.toml sets {banned}");
        }
        // Skills off twice: the list and the ones Codex ships.
        assert!(CONFIG_TOML.contains("[skills]\ninclude_instructions = false"));
        assert!(CONFIG_TOML.contains("[skills.bundled]\nenabled = false"));
    }

    #[test]
    fn the_mcp_server_is_added_with_plain_values() {
        let overrides = mcp_overrides("http://127.0.0.1:8722/mcp");
        assert_eq!(overrides[0], "mcp_servers.osg-editor.url=http://127.0.0.1:8722/mcp");
        assert!(overrides.contains(&format!("mcp_servers.osg-editor.bearer_token_env_var={TOKEN_VAR}")));
        assert!(overrides.contains(&"mcp_servers.osg-editor.default_tools_approval_mode=approve".to_string()));
        // Unquoted, so cmd.exe has nothing to mangle, and no token on the command line.
        for value in &overrides {
            assert!(!value.contains(['"', '\'', ' ', '{', '}']), "{value} needs quoting");
        }
        assert!(plain_url("http://127.0.0.1:8722/mcp"));
        assert!(!plain_url("http://evil.example:80/mcp"));
        assert!(!plain_url("http://127.0.0.1:8722/mcp\"x"));
        assert!(!plain_url("http://127.0.0.1:8722/mcp -c x=y"));
    }

    #[test]
    fn the_command_line_and_environment() {
        let dir = temp_dir("command");
        let workspace = prepare_workspace(&dir).unwrap();
        let plan = SpawnPlan { workspace: &workspace, mcp: Some(("http://127.0.0.1:8722/mcp", "secret")), path: "/usr/bin" };
        let command = agent_command(Path::new("/usr/local/bin/codex"), &plan);
        let args: Vec<String> = command.get_args().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert_eq!(args[0], "app-server");
        assert!(args.iter().any(|arg| arg == "mcp_servers.osg-editor.url=http://127.0.0.1:8722/mcp"));
        assert!(!args.iter().any(|arg| arg.contains("secret")), "the token is never an argument");
        let env: HashMap<String, Option<String>> = command
            .get_envs()
            .map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned())))
            .collect();
        assert_eq!(env.get("CODEX_HOME").cloned().flatten(), Some(workspace.home.display().to_string()));
        assert_eq!(env.get(TOKEN_VAR).cloned().flatten().as_deref(), Some("secret"));
        assert_eq!(env.get("PATH").cloned().flatten().as_deref(), Some("/usr/bin"));
        #[cfg(unix)]
        assert_eq!(env.get("HOME").cloned().flatten(), Some(workspace.user.display().to_string()));
        assert_eq!(command.get_current_dir(), Some(workspace.cwd.as_path()));
        // The probe gets no server and no token.
        let probe_plan = SpawnPlan { workspace: &workspace, mcp: None, path: "/usr/bin" };
        let probe = agent_command(Path::new("codex"), &probe_plan);
        assert_eq!(probe.get_args().count(), 1);
        assert!(!probe.get_envs().any(|(k, _)| k == TOKEN_VAR));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_scrub_takes_every_openai_codex_and_claude_variable_but_the_certificate() {
        for name in [
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "openai_api_key",
            "CODEX_API_KEY",
            "CODEX_ACCESS_TOKEN",
            "CODEX_HOME",
            "CODEX_EXEC_SERVER_URL",
            "CODEX_SANDBOX",
            "CODEX_THREAD_ID",
            "CODEX_SOMETHING_NEW",
            "RUST_LOG",
            "CLAUDECODE",
            "CLAUDE_CODE_MESSAGING_TOKEN",
            "CLAUDE_CODE_SESSION_ID",
            "ANTHROPIC_API_KEY",
        ] {
            assert!(scrubbed_var(name), "{name} is passed on");
        }
        for name in ["CODEX_CA_CERTIFICATE", "HTTPS_PROXY", "SSL_CERT_FILE", "PATH", "HOME", "LANG"] {
            assert!(!scrubbed_var(name), "{name} is scrubbed");
        }
    }

    #[test]
    fn the_workspace_writes_the_config_and_nothing_else_changes_it() {
        let dir = temp_dir("workspace");
        let workspace = prepare_workspace(&dir).unwrap();
        let config = workspace.home.join("config.toml");
        assert_eq!(std::fs::read_to_string(&config).unwrap(), CONFIG_TOML);
        std::fs::write(&config, "shell_tool = true\n").unwrap();
        prepare_workspace(&dir).unwrap();
        assert_eq!(std::fs::read_to_string(&config).unwrap(), CONFIG_TOML, "a changed config is put back");
        assert!(workspace.user.is_dir() && workspace.cwd.is_dir());
        assert_eq!(std::fs::read_dir(&workspace.user).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn the_login_is_a_link_to_the_users_file() {
        let dir = temp_dir("login");
        let home = dir.join("home");
        let user = dir.join("user-codex");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&user).unwrap();
        assert_eq!(link_login(&home, Some(&user)).unwrap(), Login::Missing);
        assert!(std::fs::symlink_metadata(home.join("auth.json")).is_err());

        std::fs::write(user.join("auth.json"), "{\"auth_mode\":\"chatgpt\"}").unwrap();
        assert_eq!(link_login(&home, Some(&user)).unwrap(), Login::Linked);
        assert_eq!(std::fs::read_link(home.join("auth.json")).unwrap(), user.join("auth.json"));
        // A write through the link is a write to the user's file, as Codex's refresh is.
        std::fs::write(home.join("auth.json"), "{\"auth_mode\":\"chatgpt\",\"refreshed\":true}").unwrap();
        assert!(std::fs::read_to_string(user.join("auth.json")).unwrap().contains("refreshed"));
        // Linking again changes nothing, and a regular file in its place is replaced.
        assert_eq!(link_login(&home, Some(&user)).unwrap(), Login::Linked);
        std::fs::remove_file(home.join("auth.json")).unwrap();
        std::fs::write(home.join("auth.json"), "stale").unwrap();
        assert_eq!(link_login(&home, Some(&user)).unwrap(), Login::Linked);
        assert!(std::fs::symlink_metadata(home.join("auth.json")).unwrap().file_type().is_symlink());
        assert!(std::fs::read_to_string(user.join("auth.json")).unwrap().contains("refreshed"), "the user's file is untouched");
        // Signed out: the link goes and the user's folder is left alone.
        std::fs::remove_file(user.join("auth.json")).unwrap();
        assert_eq!(link_login(&home, Some(&user)).unwrap(), Login::Missing);
        assert!(std::fs::symlink_metadata(home.join("auth.json")).is_err());
        assert!(user.is_dir());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_keychain_login_is_told_apart() {
        let dir = temp_dir("keyring");
        assert!(!login_in_keyring(&dir));
        std::fs::write(dir.join("config.toml"), "model = \"x\"\ncli_auth_credentials_store = \"keyring\"\n").unwrap();
        assert!(login_in_keyring(&dir));
        std::fs::write(dir.join("config.toml"), "cli_auth_credentials_store = \"file\"\n").unwrap();
        assert!(!login_in_keyring(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_newest_extension_copy_is_found() {
        let home = temp_dir("extensions");
        for (folder, platform) in [
            ("openai.chatgpt-26.930.31730-darwin-arm64", "macos-aarch64"),
            ("openai.chatgpt-26.1007.21434-darwin-arm64", "macos-aarch64"),
        ] {
            let bin = home.join(".vscode/extensions").join(folder).join("bin").join(platform);
            std::fs::create_dir_all(&bin).unwrap();
            std::fs::write(bin.join(if cfg!(windows) { "codex.exe" } else { "codex" }), "").unwrap();
        }
        std::fs::create_dir_all(home.join(".vscode/extensions/openai.codex-audio-26.1007.21434")).unwrap();
        let found = extension_binaries(&home);
        assert_eq!(found.len(), 2);
        assert!(found[0].to_string_lossy().contains("26.1007.21434"));
        assert_eq!(extension_version("openai.chatgpt-26.1007.21434-darwin-arm64"), Some(vec![26, 1007, 21434]));
        assert_eq!(extension_version("openai.codex-audio-26.1007.21434"), None);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn the_brief_carries_the_skills_without_their_frontmatter() {
        let brief = developer_instructions();
        assert!(brief.starts_with("# Your role in this session"));
        for (name, _) in SKILLS {
            assert!(brief.contains(&format!("# Design guide: {name}")), "{name} is missing");
        }
        assert!(!brief.contains("\n---\nname:"), "a skill kept its frontmatter");
        assert!(!brief.contains("description: >-"));
        assert!(brief.is_ascii() && !brief.contains('\r'));
        assert_eq!(skill_body("---\nname: x\ndescription: y\n---\nBody\n"), "Body\n");
        assert_eq!(skill_body("No frontmatter"), "No frontmatter");
    }

    #[test]
    fn requests_from_codex_are_declined() {
        assert_eq!(
            server_request_answer("item/commandExecution/requestApproval").unwrap(),
            json!({ "decision": "decline" })
        );
        assert_eq!(server_request_answer("item/fileChange/requestApproval").unwrap(), json!({ "decision": "decline" }));
        assert_eq!(
            server_request_answer("execCommandApproval").unwrap(),
            json!({ "decision": { "denied": { "rejection": REFUSAL } } })
        );
        assert_eq!(
            server_request_answer("item/permissions/requestApproval").unwrap(),
            json!({ "permissions": {}, "scope": "turn" })
        );
        assert_eq!(server_request_answer("mcpServer/elicitation/request").unwrap()["action"], "decline");
        assert_eq!(server_request_answer("item/tool/requestUserInput").unwrap(), json!({ "answers": {} }));
        assert_eq!(server_request_answer("item/tool/call").unwrap()["success"], false);
        // Never a token, an attestation or anything new.
        for method in ["account/chatgptAuthTokens/refresh", "attestation/generate", "something/new"] {
            assert_eq!(server_request_answer(method).unwrap_err().0, -32601);
        }
    }

    #[test]
    fn only_the_chats_own_events_go_to_the_editor() {
        let main = Some("thread-main");
        let started = json!({ "threadId": "thread-main", "item": { "type": "mcpToolCall", "id": "a" } });
        assert!(relayed("item/started", started.clone(), main).is_some());
        assert!(relayed("item/started", started, None).is_some(), "before the thread is known");
        let other = json!({ "threadId": "thread-sub", "item": { "type": "agentMessage", "id": "b" } });
        assert!(relayed("item/completed", other, main).is_none(), "a sub-agent's item");
        for kind in ["userMessage", "reasoning"] {
            let item = json!({ "threadId": "thread-main", "item": { "type": kind, "id": "c" } });
            assert!(relayed("item/completed", item, main).is_none(), "{kind} is relayed");
        }
        for method in ["thread/status/changed", "item/reasoning/textDelta", "fs/changed", "account/login/completed"] {
            assert!(relayed(method, json!({ "threadId": "thread-main" }), main).is_none(), "{method} is relayed");
        }
        let done = json!({ "threadId": "thread-main", "turn": { "id": "t", "status": "completed", "items": [1, 2, 3] } });
        assert_eq!(relayed("turn/completed", done, main).unwrap()["turn"]["items"], json!([]));
    }

    #[test]
    fn a_large_picture_loses_its_bytes_on_the_way() {
        let big = "A".repeat(LARGE_LINE + 10);
        let params = json!({
            "threadId": "t",
            "item": { "type": "mcpToolCall", "result": { "content": [
                { "type": "text", "text": "ok" },
                { "type": "image", "mimeType": "image/png", "data": big },
            ] } },
        });
        let out = relayed("item/completed", params, Some("t")).unwrap();
        let image = &out["item"]["result"]["content"][1];
        assert_eq!(image["data"], "");
        assert_eq!(image["elided"], true);
        assert_eq!(out["item"]["result"]["content"][0]["text"], "ok");
        let small = json!({ "threadId": "t", "item": { "type": "mcpToolCall", "result": { "content": [
            { "type": "image", "mimeType": "image/png", "data": "iVBOR" },
        ] } } });
        assert_eq!(relayed("item/completed", small, Some("t")).unwrap()["item"]["result"]["content"][0]["data"], "iVBOR");
    }

    #[test]
    fn a_turn_takes_text_and_base64_pictures_only() {
        let turn = |text: &str, images: Vec<(&str, &str)>| TurnArgs {
            text: text.into(),
            images: images.into_iter().map(|(t, d)| TurnImage { media_type: t.into(), data: d.into() }).collect(),
            model: None,
            effort: None,
        };
        let input = turn_input(&turn("Make it dark", vec![("image/png", "iVBORw0KGgo=")]), &[]).unwrap();
        assert_eq!(input[0], json!({ "type": "text", "text": "Make it dark", "text_elements": [] }));
        assert_eq!(input[1], json!({ "type": "image", "url": "data:image/png;base64,iVBORw0KGgo=" }));
        assert!(turn_input(&turn("x", vec![("image/svg+xml", "PHN2Zz4=")]), &[]).is_err());
        assert!(turn_input(&turn("x", vec![("image/png", "https://evil.example/a.png")]), &[]).is_err());
        assert!(turn_input(&turn("x", vec![("image/png", "")]), &[]).is_err());
        assert!(turn_input(&turn("x", vec![("image/png", "AAAA"); MAX_TURN_IMAGES + 1]), &[]).is_err());
        assert!(turn_input(&turn(&"x".repeat(MAX_TURN_TEXT + 1), vec![]), &[]).is_err());
    }

    #[test]
    fn mentions_of_visible_skills_are_defused() {
        let skills = vec!["skill-installer".to_string(), "imagegen".to_string()];
        assert_eq!(defuse_skill_mentions("Hero $imagegen", &skills), "Hero $\u{2060}imagegen");
        assert_eq!(defuse_skill_mentions("x$imagegen.", &skills), "x$\u{2060}imagegen.");
        assert_eq!(defuse_skill_mentions("($skill-installer)", &skills), "($\u{2060}skill-installer)");
        // Not a skill, or a longer name: left as written.
        assert_eq!(defuse_skill_mentions("Save $5 today", &skills), "Save $5 today");
        assert_eq!(defuse_skill_mentions("$imagegenius", &skills), "$imagegenius");
        assert_eq!(defuse_skill_mentions("$IMAGEGEN", &skills), "$IMAGEGEN");
        assert_eq!(defuse_skill_mentions("ends with $", &skills), "ends with $");
        // With no skills in sight nothing changes.
        assert_eq!(defuse_skill_mentions("Hero $imagegen", &[]), "Hero $imagegen");
        let listed = skill_names(&json!({ "data": [{ "cwd": "/x", "skills": [{ "name": "a" }, { "name": "abc" }, { "name": "bad name" }] }] }));
        assert_eq!(listed, vec!["abc".to_string(), "a".to_string()]);
    }

    #[test]
    fn models_and_the_account_from_the_probe() {
        let result = json!({ "data": [
            { "id": "gpt-6.1-sol", "model": "gpt-6.1-sol", "displayName": "GPT-6.1-Sol", "hidden": false,
              "supportedReasoningEfforts": [{ "reasoningEffort": "low" }, { "reasoningEffort": "max" }, { "reasoningEffort": "ultra" }],
              "defaultReasoningEffort": "low", "inputModalities": ["text", "image"], "isDefault": true },
            { "id": "hidden-one", "model": "hidden-one", "hidden": true, "inputModalities": ["text", "image"] },
            { "id": "text-only", "model": "text-only", "hidden": false, "inputModalities": ["text"] },
            { "id": "bad id", "model": "bad id", "hidden": false },
        ] });
        let models = read_models(&result);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-6.1-sol");
        assert_eq!(models[0].efforts, vec!["low".to_string(), "max".to_string()], "ultra is never offered");
        assert!(models[0].is_default);

        let mut detection = CodexDetection::default();
        read_account(&json!({ "account": { "type": "chatgpt", "email": "me@example.com", "planType": "plus" } }), &mut detection);
        assert_eq!(detection.logged_in, Some(true));
        assert_eq!(detection.auth_method.as_deref(), Some("chatgpt"));
        assert_eq!(detection.plan_type.as_deref(), Some("plus"));
        let mut signed_out = CodexDetection::default();
        read_account(&json!({ "account": null, "requiresOpenaiAuth": true }), &mut signed_out);
        assert_eq!(signed_out.logged_in, Some(false));
        // The e-mail address never reaches the page.
        let text = serde_json::to_string(&detection).unwrap();
        assert!(!text.contains("example.com"));
    }

    #[test]
    fn ids_and_choices_are_checked() {
        assert!(valid_model("gpt-6.1-sol"));
        assert!(!valid_model("-c"));
        assert!(!valid_model("gpt 6"));
        assert!(!valid_model("gpt\"6"));
        assert!(valid_effort("max") && valid_effort("low"));
        assert!(!valid_effort("ultra") && !valid_effort("MAX"));
        assert!(valid_base64("iVBORw0KGgo="));
        assert!(!valid_base64("data:image/png;base64,iVBOR"));
    }
}
