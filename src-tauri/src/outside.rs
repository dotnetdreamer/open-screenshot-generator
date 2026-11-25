//! Programs the agents need, started outside the Mac App Store sandbox.
//!
//! The App Store build runs in Apple's app sandbox, and a process it starts
//! stays in the sandbox: `claude` could read neither ~/.local/bin nor its
//! login in ~/.claude, and Codex the same. macOS runs a script the user saved
//! in the app's own folder in ~/Library/Application Scripts outside the
//! sandbox (NSUserUnixTask), and the app may read that folder but not write
//! it. So the user saves app-store-helper/helper.sh there once, from a save
//! dialog the app opens on that folder, and from then on `spawn` starts every
//! program through it. In every other build `spawn` is Command::spawn.
//!
//! Measured on macOS 26.6 on 2026-11-24, with a sandboxed test app:
//!   - the script runs with no sandbox, the real HOME and TMPDIR, the app's
//!     PATH and none of the app's other variables, so a variable the app was
//!     started with (an API key among them) reaches the program only if the
//!     command sets it;
//!   - stdin, stdout and stderr are pipes the app hands over, used both ways
//!     at once; the first answer came about 350 ms after the start;
//!   - the script leads a process group of its own;
//!   - the sandbox can't signal it (EPERM), so a stop runs the script again;
//!   - it reads and writes the app's container with no question from macOS;
//!   - the completion handler's error says how it ended: "exited with status
//!     N" in its failure reason, or the signal as its POSIX code.

// Only the macOS build runs anything through the helper.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, ExitStatus, Stdio};

use tauri::{AppHandle, Runtime};

/// The helper, compiled in. Its second line names its version.
const HELPER: &str = include_str!("../app-store-helper/helper.sh");

/// The name the save dialog suggests, and the only file the app runs.
const HELPER_NAME: &str = "Open Screenshot Generator helper.sh";

/// The version this build needs. A helper saved by an older build is outdated.
const HELPER_VERSION: u32 = 1;

/// How the helper's second line starts, before the version.
const VERSION_LINE: &str = "# Open Screenshot Generator helper, version ";

/// The message on the save dialog.
const SAVE_MESSAGE: &str = "Click Save to let the app start Claude Code and Codex";

/// What a start says when the helper isn't there. These can reach a toast.
pub(crate) const HELPER_NEEDED: &str = "Add the helper file first, in the editor's Agent tab. This app needs it to start Claude Code and Codex";
pub(crate) const HELPER_OLD: &str = "Update the helper file first, in the editor's Agent tab. This version of the app needs a newer one";
const WRONG_PLACE: &str = "The helper has to keep the name and folder the save window suggests. Try again and click Save without changing anything";
const NO_FOLDER: &str = "macOS didn't give the app a folder for the helper";

/// Whether this process runs in the app sandbox, which only the Mac App Store
/// build does.
pub(crate) fn sandboxed() -> bool {
    std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some()
}

/// The user's home folder. In the sandbox $HOME is the app's container, and
/// everything this is asked for (where `claude` is installed, ~/.codex) is in
/// the real one.
pub(crate) fn real_home() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    if sandboxed() {
        return mac::account_home();
    }
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Where the helper stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Helper {
    /// Not sandboxed, or saved, runnable and new enough.
    Ready,
    Missing,
    Outdated,
}

/// The version a helper's text names, if it is ours.
fn helper_version(text: &str) -> Option<u32> {
    text.lines().take(3).find_map(|line| line.strip_prefix(VERSION_LINE)?.trim().parse().ok())
}

pub(crate) fn helper() -> Helper {
    #[cfg(target_os = "macos")]
    if sandboxed() {
        let Some(path) = mac::scripts_folder().map(|folder| folder.join(HELPER_NAME)) else {
            return Helper::Missing;
        };
        let Ok(text) = std::fs::read_to_string(&path) else {
            return Helper::Missing;
        };
        use std::os::unix::fs::PermissionsExt;
        let runnable = std::fs::metadata(&path).is_ok_and(|meta| meta.permissions().mode() & 0o100 != 0);
        return match helper_version(&text) {
            Some(version) if version >= HELPER_VERSION && runnable => Helper::Ready,
            _ => Helper::Outdated,
        };
    }
    Helper::Ready
}

/// Why nothing can start, for the detections' `unavailable`: "helper-missing"
/// or "helper-outdated", or None when programs start.
pub(crate) fn unavailable() -> Option<&'static str> {
    match helper() {
        Helper::Ready => None,
        Helper::Missing => Some("helper-missing"),
        Helper::Outdated => Some("helper-outdated"),
    }
}

/// Ok when programs can start, else the sentence that says what to do.
pub(crate) fn require_helper() -> Result<(), String> {
    match helper() {
        Helper::Ready => Ok(()),
        Helper::Missing => Err(HELPER_NEEDED.into()),
        Helper::Outdated => Err(HELPER_OLD.into()),
    }
}

/// Which of a program's standard streams the caller uses. The others are
/// /dev/null. stderr is always a pipe.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Io {
    pub(crate) stdin: bool,
    pub(crate) stdout: bool,
}

impl Io {
    /// An agent, or a one-shot prompt: input in, output out.
    pub(crate) const PIPES: Io = Io { stdin: true, stdout: true };
    /// A short command whose output is read.
    pub(crate) const OUTPUT: Io = Io { stdin: false, stdout: true };
    /// A look whose errors alone count.
    pub(crate) const ERRORS: Io = Io { stdin: false, stdout: false };
}

/// A started program, here or through the helper. The pipes are taken as
/// from std's Child.
pub(crate) struct Proc {
    pub(crate) stdin: Option<Box<dyn Write + Send>>,
    pub(crate) stdout: Option<Box<dyn Read + Send>>,
    pub(crate) stderr: Option<Box<dyn Read + Send>>,
    running: Running,
}

enum Running {
    Here(Child),
    #[cfg(target_os = "macos")]
    Outside(mac::Outside),
}

impl Proc {
    pub(crate) fn id(&self) -> u32 {
        match &self.running {
            Running::Here(child) => child.id(),
            #[cfg(target_os = "macos")]
            Running::Outside(outside) => outside.pid,
        }
    }

    pub(crate) fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        match &mut self.running {
            Running::Here(child) => child.try_wait(),
            #[cfg(target_os = "macos")]
            Running::Outside(outside) => Ok(outside.try_wait()),
        }
    }

    /// Closes stdin first, as std's Child::wait does.
    pub(crate) fn wait(&mut self) -> io::Result<ExitStatus> {
        drop(self.stdin.take());
        match &mut self.running {
            Running::Here(child) => child.wait(),
            #[cfg(target_os = "macos")]
            Running::Outside(outside) => outside.wait(),
        }
    }

    /// SIGKILL to the program alone, as std's Child::kill.
    pub(crate) fn kill(&mut self) -> io::Result<()> {
        match &mut self.running {
            Running::Here(child) => child.kill(),
            #[cfg(target_os = "macos")]
            Running::Outside(outside) => outside.kill(),
        }
    }
}

/// Start `command` with the streams `io` names piped. Through the helper in
/// the sandbox, which refuses with HELPER_NEEDED or HELPER_OLD when it can't.
pub(crate) fn spawn(command: &mut Command, io: Io) -> io::Result<Proc> {
    command
        .stdin(if io.stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(if io.stdout { Stdio::piped() } else { Stdio::null() })
        .stderr(Stdio::piped());
    #[cfg(target_os = "macos")]
    if sandboxed() {
        return mac::spawn(command, io);
    }
    let mut child = command.spawn()?;
    Ok(Proc {
        stdin: child.stdin.take().map(|pipe| Box::new(pipe) as Box<dyn Write + Send>),
        stdout: child.stdout.take().map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
        stderr: child.stderr.take().map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
        running: Running::Here(child),
    })
}

/// Send `signal` ("TERM" or "KILL") to `target`, a pid or a negative group,
/// through the helper. Returns at once; the helper runs on.
#[cfg(target_os = "macos")]
pub(crate) fn signal(signal: &str, target: &str) -> io::Result<()> {
    mac::signal(signal, target)
}

/// The names in `dir`. The sandbox may look at a file outside the container
/// but not list a folder there, so in the sandbox `/bin/ls` lists it through
/// the helper. None when it can't be read.
pub(crate) fn folder_names(dir: &std::path::Path) -> Option<Vec<String>> {
    #[cfg(target_os = "macos")]
    if sandboxed() {
        return mac::folder_names(dir);
    }
    let entries = std::fs::read_dir(dir).ok()?;
    Some(entries.flatten().filter_map(|entry| entry.file_name().to_str().map(str::to_string)).collect())
}

/// Up to `limit` bytes of the file at `path`. In the sandbox the app may read
/// a file in a code folder only in the session the folder was picked in, so
/// when the sandbox refuses, `/bin/cat` reads it through the helper.
pub(crate) fn read_file(path: &std::path::Path, limit: u64) -> io::Result<Vec<u8>> {
    let read_here = || -> io::Result<Vec<u8>> {
        let mut bytes = Vec::new();
        std::fs::File::open(path)?.take(limit).read_to_end(&mut bytes)?;
        Ok(bytes)
    };
    #[cfg(target_os = "macos")]
    if sandboxed() {
        return match read_here() {
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => mac::read_file(path, limit),
            other => other,
        };
    }
    read_here()
}

/// What a code folder holds, by folder: each name in it and whether it is a
/// folder. Links are left out, as walk in code_folders.rs leaves them.
pub(crate) type Tree = std::collections::HashMap<PathBuf, Vec<(String, bool)>>;

/// The files and folders under `root`, `depth` deep, for a code folder the
/// sandbox won't list (picked in an earlier session). One `find` through the
/// helper; dot names and names matching `prune` (gitignore patterns with `*`
/// only) are left out with everything below them. The bool says it was cut
/// short by `time` or by size. None outside the sandbox, or when the helper
/// can't list it.
pub(crate) fn tree(root: &std::path::Path, depth: usize, prune: &[&str], time: std::time::Duration) -> Option<(Tree, bool)> {
    #[cfg(target_os = "macos")]
    if sandboxed() {
        return mac::tree(root, depth, prune, time);
    }
    let _ = (root, depth, prune, time);
    None
}

/// The script `tree` runs: folders, an empty record, then files, each path
/// NUL-ended and relative ("./a/b").
const TREE_SCRIPT: &str = r#"cd -- "$1" || exit 1
depth=$2
shift 2
/usr/bin/find . -maxdepth "$depth" \( "$@" \) -prune -o -type d -print0
printf '\0'
/usr/bin/find . -maxdepth "$depth" \( "$@" \) -prune -o -type f -print0
"#;

/// find's arguments for the names `tree` leaves out.
fn prune_arguments(prune: &[&str]) -> Vec<String> {
    let mut args = vec!["-name".to_string(), ".?*".to_string()];
    for pattern in prune {
        // Only `*` means the same to find as to the deny rules.
        if pattern.is_empty() || pattern.contains(['?', '[', ']', '\\']) {
            continue;
        }
        args.extend(["-o".to_string(), "-iname".to_string(), pattern.to_string()]);
    }
    args
}

/// TREE_SCRIPT's output as a Tree. A record that was cut off at the end is
/// dropped.
fn parse_tree(root: &std::path::Path, output: &[u8], complete: bool) -> Tree {
    let mut tree = Tree::new();
    let mut records: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
    if !complete || output.last() != Some(&0) {
        records.pop();
    }
    let mut folders = true;
    for record in records {
        if record.is_empty() {
            folders = false;
            continue;
        }
        let Ok(text) = std::str::from_utf8(record) else {
            continue;
        };
        let Some(rel) = text.strip_prefix("./") else {
            continue;
        };
        let rel = std::path::Path::new(rel);
        let Some(name) = rel.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let mut parent = root.to_path_buf();
        if let Some(dir) = rel.parent() {
            parent.push(dir);
        }
        tree.entry(parent).or_default().push((name.to_string(), folders));
    }
    tree
}

/// The lines the helper reads before it starts a program: each variable the
/// command sets or removes, then an empty line. Values travel on stdin, never
/// as arguments, so Codex's MCP token stays out of the process list.
fn environment_lines(command: &Command) -> io::Result<String> {
    let mut out = String::new();
    for (key, value) in command.get_envs() {
        let key = key.to_str().ok_or_else(|| io::Error::other("an environment name the helper can't pass"))?;
        let plain = |text: &str| !text.contains(['\n', '\r', '\0']);
        if key.is_empty() || key.starts_with('-') || key.contains('=') || !plain(key) {
            return Err(io::Error::other(format!("an environment name the helper can't pass: {key}")));
        }
        match value {
            Some(value) => {
                let value = value.to_str().filter(|value| plain(value));
                let value = value.ok_or_else(|| io::Error::other(format!("a value of {key} the helper can't pass")))?;
                out.push_str(&format!("{key}={value}\n"));
            }
            None => out.push_str(&format!("-{key}\n")),
        }
    }
    out.push('\n');
    Ok(out)
}

/// The helper's arguments for `command`: run <folder> -- <program> <args>.
fn run_arguments(command: &Command) -> io::Result<Vec<String>> {
    let text = |value: &std::ffi::OsStr| {
        value.to_str().map(str::to_string).ok_or_else(|| io::Error::other("an argument the helper can't pass"))
    };
    let folder = command.get_current_dir().map(|dir| text(dir.as_os_str())).transpose()?;
    let mut args = vec!["run".to_string(), folder.unwrap_or_else(|| "/".into()), "--".into(), text(command.get_program())?];
    for arg in command.get_args() {
        args.push(text(arg)?);
    }
    Ok(args)
}

/// What the helper's first line on stderr says: the program's pid.
fn pid_line(line: &str) -> Option<u32> {
    line.strip_prefix("osg-helper-pid ")?.trim().parse().ok().filter(|pid| *pid > 0)
}

/// How a script ended, from the completion handler's failure reason and
/// POSIX code (the macOS wait status layout: code << 8, or the signal).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn wait_status(failed: bool, reason: &str, posix_code: Option<i64>) -> i32 {
    if !failed {
        return 0;
    }
    // "Script task exited with status 3", in the user's language. The number
    // is the last one in it.
    let digits: String = {
        let tail = reason.trim_end_matches(|c: char| !c.is_ascii_digit());
        let start = tail.rfind(|c: char| !c.is_ascii_digit()).map_or(0, |i| i + 1);
        tail[start..].to_string()
    };
    if let Ok(code) = digits.parse::<i32>() {
        return (code & 0xff) << 8;
    }
    match posix_code {
        Some(signal @ 1..=31) => signal as i32,
        _ => 1 << 8,
    }
}

/// Save the helper. A save dialog opens on the app's scripts folder with the
/// helper's name filled in, since the app can't write there on its own. True
/// once saved, false when the dialog was cancelled. Any editor or panel
/// window may ask; the dialog sits on the one that did.
#[tauri::command]
pub async fn abs_add_app_store_helper<R: Runtime>(app: AppHandle<R>, window: tauri::Window<R>) -> Result<bool, String> {
    let label = window.label().to_string();
    if !(crate::settings::is_editor_window(&label) || label.starts_with("panel-")) {
        return Err("only the app's own windows can add the helper".into());
    }
    if !sandboxed() {
        return Ok(true);
    }
    tauri::async_runtime::spawn_blocking(move || add_helper(&app, &label)).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn add_helper<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<bool, String> {
    use std::os::unix::fs::PermissionsExt;
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;
    let folder = mac::scripts_folder().ok_or(NO_FOLDER)?;
    let parent = app.get_webview_window(label);
    let mut dialog = app.dialog().file().set_title(SAVE_MESSAGE).set_directory(&folder).set_file_name(HELPER_NAME);
    if let Some(window) = &parent {
        dialog = dialog.set_parent(window);
    }
    let picked = dialog.blocking_save_file();
    if let Some(window) = &parent {
        let _ = window.set_focus();
    }
    let Some(picked) = picked else {
        return Ok(false);
    };
    let path = picked.into_path().map_err(|_| WRONG_PLACE.to_string())?;
    let same_folder = path.parent().and_then(|dir| dir.canonicalize().ok()) == folder.canonicalize().ok();
    if !same_folder || path.file_name() != Some(std::ffi::OsStr::new(HELPER_NAME)) {
        return Err(WRONG_PLACE.into());
    }
    std::fs::write(&path, HELPER).map_err(|e| format!("The helper could not be saved: {e}"))?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("The helper could not be made runnable: {e}"))?;
    if helper() != Helper::Ready {
        return Err("The helper was saved, but the app can't read it back".into());
    }
    Ok(true)
}

#[cfg(not(target_os = "macos"))]
fn add_helper<R: Runtime>(_app: &AppHandle<R>, _label: &str) -> Result<bool, String> {
    Ok(true)
}

#[cfg(target_os = "macos")]
mod mac {
    use std::io::{self, Read, Write};
    use std::os::fd::{IntoRawFd, OwnedFd};
    use std::path::{Path, PathBuf};
    use std::process::{Command, ExitStatus};
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::AnyThread;
    use objc2_foundation::{
        NSArray, NSError, NSFileHandle, NSFileManager, NSPOSIXErrorDomain, NSSearchPathDirectory, NSSearchPathDomainMask,
        NSString, NSURL, NSUserUnixTask,
    };

    use super::{environment_lines, pid_line, run_arguments, wait_status, Io, Proc, Running, HELPER_NAME};

    /// How long the helper has to say it started the program. Its first run
    /// after a while also starts macOS's script service.
    const START_WAIT: Duration = Duration::from_secs(15);

    /// How long a wait after a kill lasts before giving up on the end.
    const KILLED_WAIT: Duration = Duration::from_secs(5);

    /// The account's home, from the user database rather than $HOME.
    pub(super) fn account_home() -> Option<PathBuf> {
        // SAFETY: getpwuid returns a pointer into static storage or null, and
        // pw_dir is read before anything else could call it on this thread.
        unsafe {
            let entry = libc_getpwuid(libc_getuid());
            if entry.is_null() || (*entry).pw_dir.is_null() {
                return None;
            }
            let dir = std::ffi::CStr::from_ptr((*entry).pw_dir).to_str().ok()?;
            (!dir.is_empty()).then(|| PathBuf::from(dir))
        }
    }

    #[repr(C)]
    struct Passwd {
        pw_name: *const std::ffi::c_char,
        pw_passwd: *const std::ffi::c_char,
        pw_uid: u32,
        pw_gid: u32,
        pw_change: i64,
        pw_class: *const std::ffi::c_char,
        pw_gecos: *const std::ffi::c_char,
        pw_dir: *const std::ffi::c_char,
        pw_shell: *const std::ffi::c_char,
        pw_expire: i64,
    }

    extern "C" {
        #[link_name = "getpwuid"]
        fn libc_getpwuid(uid: u32) -> *const Passwd;
        #[link_name = "getuid"]
        fn libc_getuid() -> u32;
    }

    /// ~/Library/Application Scripts/<bundle id>, which macOS makes with the
    /// container.
    pub(super) fn scripts_folder() -> Option<PathBuf> {
        autoreleasepool(|_| {
            let url = NSFileManager::defaultManager()
                .URLForDirectory_inDomain_appropriateForURL_create_error(
                    NSSearchPathDirectory::ApplicationScriptsDirectory,
                    NSSearchPathDomainMask::UserDomainMask,
                    None,
                    true,
                )
                .ok()?;
            Some(PathBuf::from(url.path()?.to_string()))
        })
    }

    fn helper_path() -> io::Result<PathBuf> {
        scripts_folder().map(|folder| folder.join(HELPER_NAME)).ok_or_else(|| io::Error::other(super::HELPER_NEEDED))
    }

    /// A program the helper started.
    pub(super) struct Outside {
        pub(super) pid: u32,
        /// The helper that started it, which also stops it.
        script: PathBuf,
        ended: mpsc::Receiver<ExitStatus>,
        status: Option<ExitStatus>,
        killed: bool,
    }

    impl Outside {
        pub(super) fn try_wait(&mut self) -> Option<ExitStatus> {
            if self.status.is_none() {
                self.status = self.ended.try_recv().ok();
            }
            self.status
        }

        pub(super) fn wait(&mut self) -> io::Result<ExitStatus> {
            if let Some(status) = self.try_wait() {
                return Ok(status);
            }
            // After a kill the end is bounded: a helper deleted meanwhile
            // stops nothing, and a caller must not hang on that.
            let status = if self.killed {
                self.ended.recv_timeout(KILLED_WAIT).map_err(|_| io::Error::other("the program did not stop"))?
            } else {
                self.ended.recv().map_err(|_| io::Error::other("the helper did not say how the program ended"))?
            };
            self.status = Some(status);
            Ok(status)
        }

        pub(super) fn kill(&mut self) -> io::Result<()> {
            if self.try_wait().is_some() {
                return Ok(());
            }
            self.killed = true;
            signal_with(&self.script, "KILL", &self.pid.to_string())
        }
    }

    /// The task, kept until its completion handler runs. The handler is
    /// called on another thread.
    struct Keep(Option<Retained<NSUserUnixTask>>);
    // SAFETY: NSUserUnixTask is used here only to release its file handles
    // and itself, which Foundation allows from any thread.
    unsafe impl Send for Keep {}

    /// Run `script` with `args`. Each pipe end given becomes the script's
    /// stream (None is /dev/null), and is closed when the script ends, so a
    /// reader on the other end sees EOF. `ended` hears how it ended.
    ///
    /// An Objective-C exception comes back as an error: unwinding into Rust,
    /// it would abort the app.
    fn execute(
        script: &Path,
        args: &[String],
        stdin: Option<OwnedFd>,
        stdout: Option<OwnedFd>,
        stderr: Option<OwnedFd>,
        ended: Option<mpsc::Sender<ExitStatus>>,
    ) -> io::Result<()> {
        let script = script.to_str().ok_or_else(|| io::Error::other(super::HELPER_NEEDED))?.to_string();
        // Never NSFileHandle.fileHandleWithNullDevice: the task sends its
        // handles to macOS's script service, and that one can't be sent
        // (NSInvalidArgumentException, "-[NSNullFileHandle encodeWithCoder:]").
        let null = || -> io::Result<OwnedFd> {
            Ok(std::fs::OpenOptions::new().read(true).write(true).open("/dev/null")?.into())
        };
        let stdin = match stdin {
            Some(fd) => fd,
            None => null()?,
        };
        let stdout = match stdout {
            Some(fd) => fd,
            None => null()?,
        };
        let stderr = match stderr {
            Some(fd) => fd,
            None => null()?,
        };
        let run = std::panic::AssertUnwindSafe(|| autoreleasepool(|_| -> io::Result<()> {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&script));
            let task = NSUserUnixTask::initWithURL_error(NSUserUnixTask::alloc(), &url)
                .map_err(|error| io::Error::other(error.localizedDescription().to_string()))?;
            let handle =
                |fd: OwnedFd| NSFileHandle::initWithFileDescriptor_closeOnDealloc(NSFileHandle::alloc(), fd.into_raw_fd(), true);
            task.setStandardInput(Some(&handle(stdin)));
            task.setStandardOutput(Some(&handle(stdout)));
            task.setStandardError(Some(&handle(stderr)));
            let words: Vec<Retained<NSString>> = args.iter().map(|arg| NSString::from_str(arg)).collect();
            let arguments = NSArray::from_retained_slice(&words);
            // The handler lets go of the task, and the task of the handles,
            // which closes the app's ends of the pipes the script wrote to.
            let keep = Arc::new(Mutex::new(Keep(Some(task.clone()))));
            let block = RcBlock::new(move |error: *mut NSError| {
                // SAFETY: Foundation passes a valid NSError or null.
                let error = unsafe { error.as_ref() };
                let status = ended_status(error);
                if let Some(task) = keep.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).0.take() {
                    task.setStandardInput(None);
                    task.setStandardOutput(None);
                    task.setStandardError(None);
                }
                if let Some(ended) = &ended {
                    let _ = ended.send(status);
                }
            });
            // SAFETY: the block is a valid heap block, which the task copies.
            unsafe { task.executeWithArguments_completionHandler(Some(&arguments), RcBlock::as_ptr(&block)) };
            Ok(())
        }));
        objc2::exception::catch(run).unwrap_or_else(|exception| {
            let reason = exception.map(|exception| format!("{exception:?}")).unwrap_or_default();
            eprintln!("outside: the script task threw {reason}");
            Err(io::Error::other("macOS refused to run the helper"))
        })
    }

    fn ended_status(error: Option<&NSError>) -> ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        let Some(error) = error else {
            return ExitStatus::from_raw(0);
        };
        let reason = error.localizedFailureReason().map(|reason| reason.to_string()).unwrap_or_default();
        // SAFETY: NSPOSIXErrorDomain is a constant Foundation exports.
        let posix = error.domain().isEqualToString(unsafe { NSPOSIXErrorDomain });
        ExitStatus::from_raw(wait_status(true, &reason, posix.then(|| error.code() as i64)))
    }

    pub(super) fn spawn(command: &Command, io: Io) -> io::Result<Proc> {
        match super::helper() {
            super::Helper::Ready => {}
            super::Helper::Missing => return Err(io::Error::other(super::HELPER_NEEDED)),
            super::Helper::Outdated => return Err(io::Error::other(super::HELPER_OLD)),
        }
        spawn_with(&helper_path()?, command, io)
    }

    /// spawn through `script`, which tests point at a copy of the helper.
    fn spawn_with(script: &Path, command: &Command, io: Io) -> io::Result<Proc> {
        let header = environment_lines(command)?;
        let args = run_arguments(command)?;
        let (stdin_read, mut stdin_write) = std::io::pipe()?;
        let (stdout_read, stdout_write) = if io.stdout {
            let (read, write) = std::io::pipe()?;
            (Some(read), Some(write))
        } else {
            (None, None)
        };
        let (stderr_read, stderr_write) = std::io::pipe()?;
        let (ended_tx, ended_rx) = mpsc::channel();
        execute(script, &args, Some(stdin_read.into()), stdout_write.map(Into::into), Some(stderr_write.into()), Some(ended_tx))?;
        // The helper prints its pid before it reads this, so a long PATH
        // can't stall both sides. A helper that died has closed its end, and
        // the write fails rather than waits.
        let not_started = || io::Error::other("The helper file couldn't start the program. Add the helper again in the editor's Agent tab");
        stdin_write.write_all(header.as_bytes()).map_err(|_| not_started())?;
        let (pid, stderr_read) = read_pid(stderr_read).ok_or_else(not_started)?;
        Ok(Proc {
            stdin: io.stdin.then(|| Box::new(stdin_write) as Box<dyn Write + Send>),
            stdout: stdout_read.map(|pipe| Box::new(pipe) as Box<dyn Read + Send>),
            stderr: Some(Box::new(stderr_read)),
            running: Running::Outside(Outside { pid, script: script.to_path_buf(), ended: ended_rx, status: None, killed: false }),
        })
    }

    /// The pid from the helper's first line on stderr, read a byte at a time
    /// so the program's own errors stay in the pipe, and the pipe handed back.
    fn read_pid(mut pipe: std::io::PipeReader) -> Option<(u32, std::io::PipeReader)> {
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let mut line = Vec::new();
            let mut byte = [0u8; 1];
            while line.len() < 200 {
                match pipe.read(&mut byte) {
                    Ok(1) if byte[0] == b'\n' => break,
                    Ok(1) => line.push(byte[0]),
                    _ => break,
                }
            }
            let _ = tx.send((String::from_utf8_lossy(&line).into_owned(), pipe));
        });
        match rx.recv_timeout(START_WAIT) {
            Ok((line, pipe)) => match pid_line(&line) {
                Some(pid) => Some((pid, pipe)),
                None => {
                    eprintln!("outside: the helper's first line was {line:?}");
                    None
                }
            },
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => None,
        }
    }

    pub(super) fn signal(signal: &str, target: &str) -> io::Result<()> {
        signal_with(&helper_path()?, signal, target)
    }

    fn signal_with(script: &Path, signal: &str, target: &str) -> io::Result<()> {
        execute(script, &["signal".into(), signal.into(), target.into()], None, None, None, None)
    }

    pub(super) fn read_file(path: &Path, limit: u64) -> io::Result<Vec<u8>> {
        read_file_with(&helper_path()?, path, limit)
    }

    fn read_file_with(script: &Path, path: &Path, limit: u64) -> io::Result<Vec<u8>> {
        let mut command = Command::new("/bin/cat");
        command.arg("--").arg(path);
        let mut proc = spawn_with(script, &command, Io::OUTPUT)?;
        let mut bytes = Vec::new();
        proc.stdout.take().ok_or_else(|| io::Error::other("no stdout"))?.take(limit).read_to_end(&mut bytes)?;
        // Past the limit cat may still be writing; the caller refuses it anyway.
        if bytes.len() as u64 >= limit {
            let _ = proc.kill();
        }
        let status = proc.wait()?;
        if !status.success() && (bytes.len() as u64) < limit {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "the helper could not read the file"));
        }
        Ok(bytes)
    }

    /// The most `tree` reads before it calls the listing cut.
    const TREE_BYTES: usize = 16 << 20;

    pub(super) fn tree(root: &Path, depth: usize, prune: &[&str], time: Duration) -> Option<(super::Tree, bool)> {
        tree_with(&helper_path().ok()?, root, depth, prune, time)
    }

    fn tree_with(script: &Path, root: &Path, depth: usize, prune: &[&str], time: Duration) -> Option<(super::Tree, bool)> {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg(super::TREE_SCRIPT).arg("sh").arg(root).arg(depth.to_string());
        command.args(super::prune_arguments(prune)).env("LC_ALL", "C");
        let mut proc = spawn_with(script, &command, Io::OUTPUT).ok()?;
        let (bytes, complete) = read_until(&mut proc, time, TREE_BYTES);
        let succeeded = proc.wait().ok().is_some_and(|status| status.success());
        if bytes.is_empty() {
            return None;
        }
        Some((super::parse_tree(root, &bytes, complete), !complete || !succeeded))
    }

    /// `proc`'s stdout up to `limit` bytes or until `time` passes, whichever
    /// comes first, and whether it all came (EOF before either). A listing that
    /// runs long still gives what it has: the program is stopped and the bytes
    /// read so far are kept.
    fn read_until(proc: &mut Proc, time: Duration, limit: usize) -> (Vec<u8>, bool) {
        let Some(mut stdout) = proc.stdout.take() else {
            return (Vec::new(), false);
        };
        let read = Arc::new(Mutex::new(Vec::new()));
        let (done_tx, done_rx) = mpsc::channel();
        {
            let read = read.clone();
            std::thread::spawn(move || {
                let mut chunk = [0u8; 64 * 1024];
                let mut eof = false;
                loop {
                    match stdout.read(&mut chunk) {
                        Ok(0) => {
                            eof = true;
                            break;
                        }
                        Err(_) => break,
                        Ok(n) => {
                            let mut buf = read.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                            buf.extend_from_slice(&chunk[..n]);
                            if buf.len() >= limit {
                                break;
                            }
                        }
                    }
                }
                let _ = done_tx.send(eof);
            });
        }
        let complete = done_rx.recv_timeout(time).unwrap_or(false);
        if !complete {
            crate::claude_code::kill_tree(proc.id());
            let _ = proc.kill();
        }
        let bytes = std::mem::take(&mut *read.lock().unwrap_or_else(|poisoned| poisoned.into_inner()));
        (bytes, complete)
    }

    pub(super) fn folder_names(dir: &Path) -> Option<Vec<String>> {
        let mut command = Command::new("/bin/ls");
        command.arg("-1A").arg("--").arg(dir).env("LC_ALL", "C");
        let mut proc = spawn(&command, Io::OUTPUT).ok()?;
        drop(proc.stdin.take());
        let mut listing = String::new();
        proc.stdout.take()?.read_to_string(&mut listing).ok()?;
        proc.wait().ok().filter(ExitStatus::success)?;
        Some(listing.lines().filter(|name| !name.is_empty()).map(str::to_string).collect())
    }

    /// The same path the App Store build takes, through NSUserUnixTask and
    /// macOS's script service, with a copy of the helper. Outside the sandbox
    /// the task runs a script from any folder.
    #[cfg(test)]
    mod tests {
        use super::super::{Io, HELPER};
        use super::{read_file_with, signal_with, spawn_with, tree_with};
        use std::io::{Read, Write};
        use std::os::unix::process::ExitStatusExt;
        use std::path::PathBuf;
        use std::process::Command;
        use std::time::{Duration, Instant};

        fn script() -> PathBuf {
            use std::os::unix::fs::PermissionsExt;
            use std::sync::atomic::{AtomicUsize, Ordering};
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir().join(format!("osg-task-test-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(format!("helper-{}.sh", NEXT.fetch_add(1, Ordering::SeqCst)));
            std::fs::write(&path, HELPER).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        #[test]
        fn a_program_talks_both_ways_and_its_exit_code_comes_back() {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "read line; echo \"got $line|$A|$(pwd -P)\"; echo oops >&2; exit 3"]).current_dir("/tmp").env("A", "one two");
            let mut proc = spawn_with(&script(), &command, Io::PIPES).unwrap();
            assert!(proc.id() > 0);
            proc.stdin.take().unwrap().write_all(b"hello\n").unwrap();
            let mut out = String::new();
            proc.stdout.take().unwrap().read_to_string(&mut out).unwrap();
            let mut err = String::new();
            proc.stderr.take().unwrap().read_to_string(&mut err).unwrap();
            assert_eq!(out, "got hello|one two|/private/tmp\n");
            assert_eq!(err, "oops\n");
            assert_eq!(proc.wait().unwrap().code(), Some(3));
        }

        #[test]
        fn a_program_whose_output_is_not_read_runs_too() {
            // Its stdout is /dev/null, the stream the null file handle broke.
            let mut proc = spawn_with(&script(), &Command::new("/bin/echo"), Io::ERRORS).unwrap();
            assert!(proc.stdout.is_none() && proc.stdin.is_none());
            assert!(proc.wait().unwrap().success());
            // A signal for a process that is gone is no error either.
            signal_with(&script(), "TERM", "999999").unwrap();
        }

        #[test]
        fn a_file_is_read_through_the_helper_up_to_the_limit() {
            let dir = std::env::temp_dir().join(format!("osg-task-read-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let file = dir.join("icon one.png");
            std::fs::write(&file, vec![7u8; 300_000]).unwrap();
            assert_eq!(read_file_with(&script(), &file, 400_000).unwrap(), vec![7u8; 300_000]);
            assert_eq!(read_file_with(&script(), &file, 1000).unwrap().len(), 1000);
            assert!(read_file_with(&script(), &dir.join("missing.png"), 1000).is_err());
        }

        #[test]
        fn a_tree_is_listed_through_the_helper_without_dot_and_blocked_names() {
            let root = std::env::temp_dir().join(format!("osg-task-tree-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&root);
            for dir in ["ios/App/Assets.xcassets", "node_modules/left", ".git/objects", "deep/a/b/c"] {
                std::fs::create_dir_all(root.join(dir)).unwrap();
            }
            for file in ["package.json", "ios/App/Info.plist", "node_modules/left/index.js", ".env", "deep/a/b/c/far.txt", "two words.png"] {
                std::fs::write(root.join(file), b"x").unwrap();
            }
            std::os::unix::fs::symlink("/etc", root.join("link")).unwrap();
            let (tree, cut) = tree_with(&script(), &root, 3, &["node_modules", "*.env"], Duration::from_secs(10)).unwrap();
            assert!(!cut);
            let mut top = tree[&root].clone();
            top.sort();
            let expect: Vec<(String, bool)> = vec![
                ("deep".into(), true),
                ("ios".into(), true),
                ("package.json".into(), false),
                ("two words.png".into(), false),
            ];
            assert_eq!(top, expect);
            assert_eq!(tree[&root.join("ios/App")], vec![("Assets.xcassets".to_string(), true), ("Info.plist".to_string(), false)]);
            // Three deep: deep/a/b is listed, c inside it is not.
            assert_eq!(tree[&root.join("deep/a")], vec![("b".to_string(), true)]);
            assert!(!tree.contains_key(&root.join("deep/a/b")));
            assert!(!tree.contains_key(&root.join("node_modules")) && !tree.contains_key(&root.join(".git")));
        }

        #[test]
        fn a_listing_past_its_deadline_keeps_what_it_read() {
            // Prints one record, then hangs: the deadline stops it, and the
            // record it gave is kept rather than the whole answer thrown away.
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "printf './ios\\0./ios/App\\0./pack'; sleep 30"]);
            let mut proc = spawn_with(&script(), &command, Io::OUTPUT).unwrap();
            let started = Instant::now();
            let (bytes, complete) = super::read_until(&mut proc, Duration::from_millis(1500), 1 << 20);
            assert!(!complete);
            assert!(started.elapsed() < Duration::from_secs(4));
            let tree = super::super::parse_tree(std::path::Path::new("/r"), &bytes, complete);
            assert_eq!(tree[std::path::Path::new("/r")], vec![("ios".to_string(), true)]);
            assert_eq!(tree[&std::path::Path::new("/r").join("ios")], vec![("App".to_string(), true)]);
            // The cut record at the end is dropped, not read as a name.
            assert!(!tree.values().flatten().any(|(name, _)| name == "pack"));
            assert!(proc.wait().is_ok());
        }

        #[test]
        fn a_kill_stops_the_program_through_the_helper() {
            let mut command = Command::new("/bin/sleep");
            command.arg("30");
            let mut proc = spawn_with(&script(), &command, Io::ERRORS).unwrap();
            let started = Instant::now();
            proc.kill().unwrap();
            assert_eq!(proc.wait().unwrap().signal(), Some(9));
            assert!(started.elapsed() < Duration::from_secs(5));
        }

        #[test]
        fn term_to_the_group_reaches_what_the_program_started() {
            let mut command = Command::new("/bin/sh");
            command.args(["-c", "/bin/sleep 30 & echo $!; wait"]);
            let mut proc = spawn_with(&script(), &command, Io::OUTPUT).unwrap();
            let mut first = [0u8; 16];
            let n = proc.stdout.as_mut().unwrap().read(&mut first).unwrap();
            let child: i32 = String::from_utf8_lossy(&first[..n]).trim().parse().unwrap();
            signal_with(&script(), "TERM", &format!("-{}", proc.id())).unwrap();
            proc.wait().unwrap();
            let gone = || Command::new("/bin/kill").args(["-0", &child.to_string()]).status().is_ok_and(|s| !s.success());
            let until = Instant::now() + Duration::from_secs(5);
            while !gone() && Instant::now() < until {
                std::thread::sleep(Duration::from_millis(50));
            }
            assert!(gone(), "the sleep the program started was stopped with it");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shipped_helper_names_the_version_this_build_needs() {
        assert_eq!(helper_version(HELPER), Some(HELPER_VERSION));
        assert!(HELPER.starts_with("#!/bin/zsh -f\n"), "no rc files, so nothing prints into an agent's stream");
        assert!(HELPER.is_ascii() && !HELPER.contains('\r'));
    }

    #[test]
    fn a_version_is_read_from_the_top_of_the_file_only() {
        assert_eq!(helper_version("#!/bin/zsh -f\n# Open Screenshot Generator helper, version 7\n"), Some(7));
        assert_eq!(helper_version("#!/bin/zsh -f\n# something else\n"), None);
        assert_eq!(helper_version("#!/bin/zsh -f\n\n\n\n# Open Screenshot Generator helper, version 1\n"), None);
    }

    #[test]
    fn environment_changes_become_lines_and_end_with_an_empty_one() {
        let mut command = Command::new("/bin/echo");
        command.env("PATH", "/a b:/c").env_remove("ANTHROPIC_API_KEY").env("OSG_MCP_TOKEN", "t=1");
        let lines = environment_lines(&command).unwrap();
        let mut got: Vec<&str> = lines.lines().collect();
        assert_eq!(got.pop(), Some(""));
        got.sort_unstable();
        assert_eq!(got, ["-ANTHROPIC_API_KEY", "OSG_MCP_TOKEN=t=1", "PATH=/a b:/c"]);
        assert!(lines.ends_with("\n\n"));
    }

    #[test]
    fn a_value_that_would_break_a_line_is_refused() {
        let mut command = Command::new("/bin/echo");
        command.env("X", "one\ntwo");
        assert!(environment_lines(&command).is_err());
        let mut command = Command::new("/bin/echo");
        command.env("-X", "1");
        assert!(environment_lines(&command).is_err());
    }

    #[test]
    fn arguments_name_the_folder_then_the_program() {
        let mut command = Command::new("/usr/local/bin/claude");
        command.current_dir("/w s").arg("-p").arg("two words");
        assert_eq!(run_arguments(&command).unwrap(), ["run", "/w s", "--", "/usr/local/bin/claude", "-p", "two words"]);
        let command = Command::new("/bin/ls");
        assert_eq!(run_arguments(&command).unwrap(), ["run", "/", "--", "/bin/ls"]);
    }

    #[test]
    fn a_tree_listing_is_read_by_folder_and_a_cut_record_is_dropped() {
        let root = std::path::Path::new("/r");
        let output = b"./a\0./a/b\0\0./x.json\0./a/b/y.png\0./a/cut";
        let tree = parse_tree(root, output, false);
        assert_eq!(tree[root], vec![("a".to_string(), true), ("x.json".to_string(), false)]);
        assert_eq!(tree[&root.join("a")], vec![("b".to_string(), true)]);
        assert_eq!(tree[&root.join("a/b")], vec![("y.png".to_string(), false)]);
        assert!(!tree.contains_key(&root.join("a/cut")));
        assert_eq!(prune_arguments(&["node_modules", "a?b", ""]), ["-name", ".?*", "-o", "-iname", "node_modules"]);
    }

    #[test]
    fn the_pid_line_is_read_strictly() {
        assert_eq!(pid_line("osg-helper-pid 123"), Some(123));
        assert_eq!(pid_line("osg-helper-pid 0"), None);
        assert_eq!(pid_line("zsh: no such file"), None);
        assert_eq!(pid_line(""), None);
    }

    #[test]
    fn how_a_script_ended_becomes_a_wait_status() {
        assert_eq!(wait_status(false, "", None), 0);
        assert_eq!(wait_status(true, "Script task exited with status 3", Some(2)), 3 << 8);
        assert_eq!(wait_status(true, "Skript wurde mit Status 127 beendet.", None), 127 << 8);
        assert_eq!(wait_status(true, "", Some(15)), 15);
        assert_eq!(wait_status(true, "", Some(9)), 9);
        assert_eq!(wait_status(true, "", None), 1 << 8);
    }

    /// The helper itself, run here without the sandbox the way macOS runs it:
    /// arguments, the environment lines on stdin, then the program's input.
    #[cfg(target_os = "macos")]
    mod helper_script {
        use super::super::HELPER;
        use std::io::Write;
        use std::process::{Command, Stdio};

        /// A copy of its own for each run: zsh reads a script as it goes, so
        /// one test writing the file under another's running zsh breaks it.
        fn script() -> std::path::PathBuf {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let dir = std::env::temp_dir().join(format!("osg-helper-test-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(format!("helper-{}.sh", NEXT.fetch_add(1, Ordering::SeqCst)));
            std::fs::write(&path, HELPER).unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        fn run(args: &[&str], stdin: &str) -> (i32, String, String) {
            let mut child = Command::new(script())
                .args(args)
                .env("REMOVE_ME", "still here")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
            let out = child.wait_with_output().unwrap();
            (
                out.status.code().unwrap_or(-1),
                String::from_utf8_lossy(&out.stdout).into_owned(),
                String::from_utf8_lossy(&out.stderr).into_owned(),
            )
        }

        #[test]
        fn run_sets_and_removes_variables_then_hands_the_rest_of_stdin_over() {
            let (code, out, err) = run(
                &["run", "/tmp", "--", "/bin/sh", "-c", "echo \"$A|${REMOVE_ME-gone}|$(pwd -P)|$1\"; cat", "sh", "two words"],
                "A=one two=three\n-REMOVE_ME\n\n{\"line\":1}\nlast\n",
            );
            assert_eq!(code, 0, "{err}");
            assert_eq!(out, "one two=three|gone|/private/tmp|two words\n{\"line\":1}\nlast\n");
            let pid = err.lines().next().and_then(super::super::pid_line);
            assert!(pid.is_some(), "{err}");
        }

        #[test]
        fn run_passes_the_programs_exit_code_on() {
            let (code, _, _) = run(&["run", "/", "--", "/bin/sh", "-c", "exit 3"], "\n");
            assert_eq!(code, 3);
        }

        #[test]
        fn run_refuses_a_call_without_the_separator() {
            assert_eq!(run(&["run", "/", "/bin/echo", "x"], "\n").0, 64);
            assert_eq!(run(&["something"], "").0, 64);
        }

        #[test]
        fn signal_takes_only_term_or_kill_and_a_number() {
            assert_eq!(run(&["signal", "HUP", "123"], "").0, 64);
            assert_eq!(run(&["signal", "TERM", "12a"], "").0, 64);
            assert_eq!(run(&["signal", "TERM", "0"], "").0, 64);
            assert_eq!(run(&["signal", "TERM", "-0"], "").0, 64);
            let mut sleeper = Command::new("/bin/sleep").arg("30").spawn().unwrap();
            let pid = sleeper.id().to_string();
            assert_eq!(run(&["signal", "TERM", &pid], "").0, 0);
            use std::os::unix::process::ExitStatusExt;
            assert_eq!(sleeper.wait().unwrap().signal(), Some(15));
        }
    }
}
