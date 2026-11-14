//! Screenshots and screen recordings from the iOS Simulator and from Android
//! emulators and phones, for the Capture view (src/lib/capture/ and
//! components/open-screenshot-generator/capture/).
//!
//! The page names a device, an app, a language or a link. Each value is
//! checked against a pattern here and handed to a fixed `xcrun simctl` or
//! `adb` subcommand as an argument of its own, never through a shell on this
//! computer. `adb shell` cannot avoid one: adb joins its arguments and the
//! device's shell reads the line, so every value that goes that way is also
//! quoted for that shell (`device_quote`).
//!
//! iOS needs macOS with Xcode. adb is looked for in ANDROID_HOME,
//! ANDROID_SDK_ROOT, the folder Android Studio installs the SDK to, and the
//! PATH of a login shell, because Android Studio does not put adb on the PATH
//! (it was not on it on the Mac this was built on).
//!
//! Two things a capture changes on a device are put back. The tidy status bar
//! (9:41, full signal and battery) is cleared when the app quits, for every
//! device it was set on, and Android's `sysui_demo_allowed` goes back to what
//! it was. A recording belongs to the window that started it, and stops when
//! that window closes or loads another page, or when the app quits, so a
//! forgotten `recordVideo` never fills the disk. Quitting waits until the
//! recorder has stopped and its file on the device is gone.
//!
//! Every command answers editor windows only (`main`, `editor-*`): a detached
//! panel asks the editor, and the assistant windows host other people's sites.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Response;
use tauri::{AppHandle, Manager, Runtime};

use crate::claude_code::{hide_console, kill_tree, login_shell_path, merged_path};

const XCRUN: &str = "/usr/bin/xcrun";
/// Where Android's screen recorder writes on the device. The shell user can
/// write here on every Android version, with no storage permission.
const DEVICE_RECORDING: &str = "/data/local/tmp/osg-capture.mp4";

#[derive(Default)]
pub struct CaptureState {
    /// Devices whose status bar this app tidied, put back on quit.
    tidied: Mutex<Vec<Tidied>>,
    /// Recordings under way, by `device_key`. Shared, so a recording being
    /// saved on another thread can free its device when it is done.
    recordings: Arc<Mutex<Slots<Recording>>>,
    /// The threads throwing away the recordings of windows that closed or
    /// reloaded. Quitting waits for them: a thread cut off between stopping the
    /// recorder and deleting its file left the file on the device.
    cleanups: Mutex<Vec<std::thread::JoinHandle<()>>>,
    /// Where adb was found last. Looked for again while it is missing, so an
    /// SDK installed while the app runs is found on the next refresh.
    adb: Mutex<Option<PathBuf>>,
    /// What each Android device in the last listing was called, by adb serial.
    android_names: Mutex<HashMap<String, AndroidName>>,
}

/// A device whose status bar this app tidied.
struct Tidied {
    platform: Platform,
    id: String,
    /// Android's `sysui_demo_allowed` before the tidy turned it on ("null"
    /// when it was never set), written back with the real status bar.
    demo_allowed: Option<String>,
}

struct Recording {
    child: Child,
    /// The window that started it, which is the one that may stop it.
    window: String,
    /// iOS: the file simctl writes. Android: where the file is pulled to.
    file: PathBuf,
    platform: Platform,
    id: String,
}

const NOT_RECORDING: &str = "That device is not recording";

/// One device's place in the recording table.
enum Slot<T> {
    Recording(T),
    /// Stopped, and the movie is still being saved and cleaned up. The device
    /// stays taken until then: on Android the cleanup stops every screen
    /// recorder on the device and deletes the one file they write, so a
    /// recording started sooner would be stopped and deleted with it.
    Saving,
}

/// The recording table: at most one recording or save per device.
struct Slots<T>(HashMap<String, Slot<T>>);

impl<T> Default for Slots<T> {
    fn default() -> Self {
        Self(HashMap::new())
    }
}

impl<T> Slots<T> {
    /// Ok when the device is neither recording nor saving a recording.
    fn check_free(&self, key: &str) -> Result<(), String> {
        match self.0.get(key) {
            None => Ok(()),
            Some(Slot::Recording(_)) => Err("That device is already recording".into()),
            Some(Slot::Saving) => Err("That device is still saving the last recording. Try again in a few seconds".into()),
        }
    }

    fn start(&mut self, key: String, recording: T) {
        self.0.insert(key, Slot::Recording(recording));
    }

    /// Takes a recording out to be saved, if `allow` agrees. The device stays
    /// taken until `release`.
    fn take(&mut self, key: &str, allow: impl FnOnce(&T) -> Result<(), String>) -> Result<T, String> {
        let Some(slot) = self.0.get_mut(key) else { return Err(NOT_RECORDING.into()) };
        let Slot::Recording(recording) = slot else { return Err(NOT_RECORDING.into()) };
        allow(recording)?;
        match std::mem::replace(slot, Slot::Saving) {
            Slot::Recording(recording) => Ok(recording),
            Slot::Saving => Err(NOT_RECORDING.into()),
        }
    }

    /// Takes out every recording `pick` chooses, each device taken until `release`.
    fn take_where(&mut self, pick: impl Fn(&T) -> bool) -> Vec<(String, T)> {
        let keys: Vec<String> = self
            .0
            .iter()
            .filter(|(_, slot)| matches!(slot, Slot::Recording(recording) if pick(recording)))
            .map(|(key, _)| key.clone())
            .collect();
        keys.into_iter()
            .filter_map(|key| match self.0.insert(key.clone(), Slot::Saving) {
                Some(Slot::Recording(recording)) => Some((key, recording)),
                _ => None,
            })
            .collect()
    }

    /// The recording was saved or thrown away, so the device may record again.
    fn release(&mut self, key: &str) {
        if matches!(self.0.get(key), Some(Slot::Saving)) {
            self.0.remove(key);
        }
    }

    /// The devices whose recording is still being saved, for the app quitting.
    fn saving_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self.0.iter().filter(|(_, slot)| matches!(slot, Slot::Saving)).map(|(key, _)| key.clone()).collect();
        keys.sort();
        keys
    }
}

/// Frees a device when dropped, however the save of its recording ended:
/// done, failed, or panicked.
struct Release<T> {
    slots: Arc<Mutex<Slots<T>>>,
    key: String,
}

impl<T> Drop for Release<T> {
    fn drop(&mut self) {
        self.slots.lock().unwrap_or_else(PoisonError::into_inner).release(&self.key);
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Platform {
    Ios,
    Android,
}

impl Platform {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "ios" => Ok(Self::Ios),
            "android" => Ok(Self::Android),
            _ => Err("That is not a device this app knows".into()),
        }
    }
}

fn device_key(platform: Platform, id: &str) -> String {
    format!("{platform:?}:{id}")
}

// ---------------------------------------------------------------------------
// What the page sees
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDevice {
    /// A simulator's UDID, an adb serial, or `avd:<name>` for an emulator
    /// that is not running.
    id: String,
    platform: &'static str,
    /// "simulator", "emulator" or "phone".
    kind: &'static str,
    name: String,
    /// "running", "starting", "off", "unauthorized" or "offline".
    state: &'static str,
    /// "iOS 26.5", "Android 16".
    os: String,
    /// The simulator's device type identifier, so the page can match it to a
    /// frame by more than its name.
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

/// A simulator model the newest iOS on this Mac can run.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorModel {
    id: String,
    name: String,
    /// "iPhone" or "iPad".
    family: String,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDevices {
    /// Why this platform offers nothing on this computer: "mac" (iOS needs a
    /// Mac), "xcode" or "sdk" (no adb found).
    #[serde(skip_serializing_if = "Option::is_none")]
    missing: Option<&'static str>,
    /// The listing failed this time (adb did not answer), so the devices are
    /// unknown, not gone. The page keeps the list and the device it had.
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    devices: Vec<CaptureDevice>,
    /// iOS only, for making a simulator that matches a frame.
    models: Vec<SimulatorModel>,
}

#[derive(Serialize, Debug)]
pub struct CaptureDevices {
    ios: PlatformDevices,
    android: PlatformDevices,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureApp {
    id: String,
    name: String,
    /// Open on the device now. On Android only the app in front counts.
    running: bool,
}

// ---------------------------------------------------------------------------
// Checking what the page sends
// ---------------------------------------------------------------------------

fn valid_udid(value: &str) -> bool {
    value.len() == 36 && value.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn valid_serial(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && !value.starts_with('-')
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '-'))
}

fn valid_avd(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && !value.starts_with('-')
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// A bundle identifier or an Android package name.
fn valid_app_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 155
        && !value.starts_with(['-', '.'])
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// A language tag such as "de", "zh-Hans" or "pt-BR", or an Apple locale such
/// as "de_DE".
fn valid_language(value: &str) -> bool {
    let mut parts = value.split(['-', '_']);
    let Some(first) = parts.next() else { return false };
    if !(2..=3).contains(&first.len()) || !first.chars().all(|c| c.is_ascii_alphabetic()) {
        return false;
    }
    let mut count = 0;
    for part in parts {
        count += 1;
        if count > 3 || !(2..=8).contains(&part.len()) || !part.chars().all(|c| c.is_ascii_alphanumeric()) {
            return false;
        }
    }
    true
}

/// A link with a scheme, such as `myapp://feed` or `https://example.com/a`.
/// No spaces or control characters, and nothing that could read as an option.
fn valid_link(value: &str) -> bool {
    if value.is_empty() || value.len() > 2048 || value.starts_with('-') {
        return false;
    }
    if value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Some((scheme, rest)) = value.split_once(':') else { return false };
    !rest.is_empty()
        && scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

fn device_id(platform: Platform, id: &str) -> Result<(), String> {
    let ok = match platform {
        Platform::Ios => valid_udid(id),
        Platform::Android => valid_serial(id),
    };
    if ok {
        Ok(())
    } else {
        Err("That device id does not look right".into())
    }
}

/// Quote one value for the device's own shell, which reads what `adb shell`
/// joins. Single quotes take everything literally; a single quote inside is
/// closed, escaped and opened again.
fn device_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn require_editor<R: Runtime>(window: &tauri::Window<R>) -> Result<(), String> {
    if crate::settings::is_editor_window(window.label()) {
        Ok(())
    } else {
        Err("Only an editor window can take screenshots from a device".into())
    }
}

// ---------------------------------------------------------------------------
// Running the tools
// ---------------------------------------------------------------------------

struct Ran {
    ok: bool,
    stdout: Vec<u8>,
    stderr: String,
}

impl Ran {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }

    /// The tool's own last words, for the end of an error message.
    fn reason(&self) -> String {
        let source = if self.stderr.trim().is_empty() { self.text() } else { self.stderr.clone() };
        source
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with("Note:"))
            .last()
            .unwrap_or("no reason given")
            .chars()
            .take(300)
            .collect()
    }
}

/// Collect a pipe as it arrives, so the caller can take what came even when
/// a process the tool started keeps the pipe open (adb's server does that on
/// some systems).
fn collect(mut pipe: impl Read + Send + 'static) -> (Arc<Mutex<Vec<u8>>>, std::thread::JoinHandle<()>) {
    let buffer = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&buffer);
    let handle = std::thread::spawn(move || {
        let mut chunk = [0u8; 64 * 1024];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(read) => sink.lock().unwrap().extend_from_slice(&chunk[..read]),
            }
        }
    });
    (buffer, handle)
}

fn command(program: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null());
    hide_console(&mut command);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own group, so a kill on timeout reaches whatever it started.
        command.process_group(0);
    }
    command
}

/// Run `program` to the end within `timeout`, killing it if it overruns.
fn run(program: &Path, args: &[&str], timeout: Duration) -> Result<Ran, String> {
    let mut child = command(program, args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start {}: {e}", program.display()))?;
    let (stdout, out_reader) = collect(child.stdout.take().ok_or("no stdout")?);
    let (stderr, err_reader) = collect(child.stderr.take().ok_or("no stderr")?);
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
            Ok(None) => std::thread::sleep(Duration::from_millis(15)),
            Err(e) => return Err(e.to_string()),
        }
    };
    let grace = Instant::now() + Duration::from_millis(400);
    while !(out_reader.is_finished() && err_reader.is_finished()) && Instant::now() < grace {
        std::thread::sleep(Duration::from_millis(5));
    }
    let ran = Ran {
        ok: status.is_some_and(|s| s.success()),
        stdout: std::mem::take(&mut *stdout.lock().unwrap()),
        stderr: String::from_utf8_lossy(&stderr.lock().unwrap()).into_owned(),
    };
    if status.is_none() {
        return Err(format!("{} took too long and was stopped", program.display()));
    }
    Ok(ran)
}

fn simctl(args: &[&str], timeout: Duration) -> Result<Ran, String> {
    let mut full = vec!["simctl"];
    full.extend_from_slice(args);
    run(Path::new(XCRUN), &full, timeout)
}

/// simctl, and an error with simctl's own reason when it fails.
fn simctl_ok(args: &[&str], timeout: Duration, failed: &str) -> Result<Ran, String> {
    let ran = simctl(args, timeout)?;
    if ran.ok {
        Ok(ran)
    } else {
        Err(format!("{failed}: {}", ran.reason()))
    }
}

fn adb_ok(adb: &Path, serial: &str, args: &[&str], timeout: Duration, failed: &str) -> Result<Ran, String> {
    let mut full = vec!["-s", serial];
    full.extend_from_slice(args);
    let ran = run(adb, &full, timeout)?;
    if ran.ok {
        Ok(ran)
    } else {
        Err(format!("{failed}: {}", ran.reason()))
    }
}

/// One `adb shell` line. Everything in `line` the caller did not write itself
/// has been through `device_quote`.
fn adb_shell(adb: &Path, serial: &str, line: &str, timeout: Duration, failed: &str) -> Result<Ran, String> {
    adb_ok(adb, serial, &["shell", line], timeout, failed)
}

fn temp_file(extension: &str) -> PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    std::env::temp_dir().join(format!("osg-capture-{}-{nanos}.{extension}", std::process::id()))
}

fn read_and_remove(path: &Path) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Could not read the capture: {e}"));
    let _ = std::fs::remove_file(path);
    bytes
}

// ---------------------------------------------------------------------------
// iOS Simulator
// ---------------------------------------------------------------------------

fn xcode_ready() -> bool {
    cfg!(target_os = "macos")
        && Path::new(XCRUN).exists()
        && run(Path::new(XCRUN), &["--find", "simctl"], Duration::from_secs(10)).is_ok_and(|ran| ran.ok)
}

fn ios_state(state: &str) -> &'static str {
    match state {
        "Booted" => "running",
        "Booting" | "Shutting Down" | "Creating" => "starting",
        _ => "off",
    }
}

/// Reads `simctl list -j`: every available iPhone and iPad simulator, and the
/// models the newest available iOS can run.
fn parse_simulators(list: &Value) -> (Vec<CaptureDevice>, Vec<SimulatorModel>) {
    let runtimes: Vec<&Value> = list["runtimes"]
        .as_array()
        .map(|all| {
            all.iter()
                .filter(|runtime| runtime["isAvailable"].as_bool().unwrap_or(false))
                .filter(|runtime| runtime["platform"].as_str() == Some("iOS"))
                .collect()
        })
        .unwrap_or_default();
    let runtime_name = |identifier: &str| -> Option<String> {
        runtimes
            .iter()
            .find(|runtime| runtime["identifier"].as_str() == Some(identifier))
            .and_then(|runtime| runtime["name"].as_str().map(str::to_string))
    };

    let mut devices = Vec::new();
    if let Some(groups) = list["devices"].as_object() {
        for (runtime, entries) in groups {
            let Some(os) = runtime_name(runtime) else { continue };
            for entry in entries.as_array().into_iter().flatten() {
                if !entry["isAvailable"].as_bool().unwrap_or(false) {
                    continue;
                }
                let (Some(udid), Some(name)) = (entry["udid"].as_str(), entry["name"].as_str()) else { continue };
                if !valid_udid(udid) {
                    continue;
                }
                let model = entry["deviceTypeIdentifier"].as_str().map(str::to_string);
                // iPhones and iPads only: a Watch or a TV simulator has nothing
                // a store screenshot frame could hold.
                let kind_ok = model
                    .as_deref()
                    .is_none_or(|id| id.contains(".iPhone") || id.contains(".iPad"));
                if !kind_ok {
                    continue;
                }
                devices.push(CaptureDevice {
                    id: udid.to_string(),
                    platform: "ios",
                    kind: "simulator",
                    name: name.to_string(),
                    state: ios_state(entry["state"].as_str().unwrap_or("")),
                    os: os.clone(),
                    model,
                });
            }
        }
    }

    let newest = runtimes.iter().max_by(|a, b| {
        version_key(a["version"].as_str().unwrap_or("")).cmp(&version_key(b["version"].as_str().unwrap_or("")))
    });
    let models = newest
        .and_then(|runtime| runtime["supportedDeviceTypes"].as_array())
        .map(|types| {
            types
                .iter()
                .filter_map(|kind| {
                    let family = kind["productFamily"].as_str()?;
                    if family != "iPhone" && family != "iPad" {
                        return None;
                    }
                    Some(SimulatorModel {
                        id: kind["identifier"].as_str()?.to_string(),
                        name: kind["name"].as_str()?.to_string(),
                        family: family.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    (devices, models)
}

fn version_key(version: &str) -> Vec<u32> {
    version.split('.').map(|part| part.parse().unwrap_or(0)).collect()
}

fn ios_devices() -> PlatformDevices {
    if !cfg!(target_os = "macos") {
        return PlatformDevices { missing: Some("mac"), ..Default::default() };
    }
    if !xcode_ready() {
        return PlatformDevices { missing: Some("xcode"), ..Default::default() };
    }
    let Ok(ran) = simctl(&["list", "-j"], Duration::from_secs(20)) else {
        return PlatformDevices { missing: Some("xcode"), ..Default::default() };
    };
    let Ok(list) = serde_json::from_slice::<Value>(&ran.stdout) else {
        return PlatformDevices { missing: Some("xcode"), ..Default::default() };
    };
    let (devices, models) = parse_simulators(&list);
    PlatformDevices { devices, models, ..Default::default() }
}

/// The installed apps of `simctl listapps`, converted from the old-style
/// property list it prints by plutil, which ships with macOS.
fn ios_apps(udid: &str) -> Result<Vec<CaptureApp>, String> {
    let listed = simctl_ok(&["listapps", udid], Duration::from_secs(20), "Could not list the apps on the simulator")?;
    let plist = temp_file("plist");
    std::fs::write(&plist, &listed.stdout).map_err(|e| e.to_string())?;
    let plist_arg = plist.to_string_lossy().into_owned();
    let converted = run(Path::new("/usr/bin/plutil"), &["-convert", "json", "-o", "-", &plist_arg], Duration::from_secs(10));
    let _ = std::fs::remove_file(&plist);
    let converted = converted?;
    if !converted.ok {
        return Err(format!("Could not read the simulator's app list: {}", converted.reason()));
    }
    let apps: Value = serde_json::from_slice(&converted.stdout).map_err(|e| e.to_string())?;
    let running = simctl(&["spawn", udid, "launchctl", "list"], Duration::from_secs(10))
        .map(|ran| ran.text())
        .unwrap_or_default();
    Ok(parse_ios_apps(&apps, &running))
}

fn parse_ios_apps(apps: &Value, launchctl: &str) -> Vec<CaptureApp> {
    let mut out: Vec<CaptureApp> = apps
        .as_object()
        .map(|all| {
            all.iter()
                .filter(|(_, app)| app["ApplicationType"].as_str() == Some("User"))
                .filter(|(id, _)| valid_app_id(id))
                .map(|(id, app)| {
                    let name = app["CFBundleDisplayName"]
                        .as_str()
                        .or_else(|| app["CFBundleName"].as_str())
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or(id)
                        .to_string();
                    let marker = format!("UIKitApplication:{id}[");
                    CaptureApp { id: id.clone(), name, running: launchctl.contains(&marker) }
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.running.cmp(&a.running).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    out
}

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

fn adb_name() -> &'static str {
    if cfg!(windows) {
        "adb.exe"
    } else {
        "adb"
    }
}

fn sdk_folders() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(value) = std::env::var_os(key).filter(|v| !v.is_empty()) {
            folders.push(PathBuf::from(value));
        }
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    if cfg!(target_os = "macos") {
        if let Some(home) = &home {
            folders.push(home.join("Library/Android/sdk"));
        }
    } else if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            folders.push(PathBuf::from(local).join("Android").join("Sdk"));
        }
    } else if let Some(home) = &home {
        folders.push(home.join("Android/Sdk"));
    }
    folders
}

fn find_adb() -> Option<PathBuf> {
    for folder in sdk_folders() {
        let candidate = folder.join("platform-tools").join(adb_name());
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let path = merged_path(&login_shell_path().unwrap_or_default());
    std::env::split_paths(&path)
        .map(|folder| folder.join(adb_name()))
        .find(|candidate| candidate.is_file())
}

fn adb_path(state: &CaptureState) -> Option<PathBuf> {
    let mut known = state.adb.lock().unwrap();
    if known.as_ref().is_some_and(|path| path.is_file()) {
        return known.clone();
    }
    *known = find_adb();
    known.clone()
}

/// The emulator binary of the SDK adb came from (`<sdk>/platform-tools/adb`).
fn emulator_path(adb: &Path) -> Option<PathBuf> {
    let sdk = adb.parent()?.parent()?;
    let name = if cfg!(windows) { "emulator.exe" } else { "emulator" };
    let candidate = sdk.join("emulator").join(name);
    candidate.is_file().then_some(candidate)
}

/// `adb devices -l`, one (serial, state) per device line.
fn parse_adb_devices(text: &str) -> Vec<(String, String)> {
    text.lines()
        .skip_while(|line| !line.starts_with("List of devices"))
        .skip(1)
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?;
            let state = parts.next()?;
            valid_serial(serial).then(|| (serial.to_string(), state.to_string()))
        })
        .collect()
}

/// What the page says when `adb devices` fails or times out.
const ADB_SILENT: &str = "Could not check for Android devices just now, so this list may be out of date";

/// What `getprop` said about one Android device, a line per property.
#[derive(Debug, Default, PartialEq)]
struct AndroidProps {
    release: String,
    model: String,
    avd: String,
    /// `sys.boot_completed` is 1: Android has finished starting.
    booted: bool,
}

fn parse_props(text: &str) -> AndroidProps {
    let mut lines = text.lines().map(str::trim);
    let mut next = || lines.next().unwrap_or("").to_string();
    let (release, model, avd) = (next(), next(), next());
    AndroidProps { release, model, avd, booted: next() == "1" }
}

/// What an Android device is called in the list, kept from one listing to the
/// next while its serial stays in adb's list.
#[derive(Clone, Debug, PartialEq)]
struct AndroidName {
    name: String,
    /// "Android 15", or "Android" when the version is not known.
    os: String,
    /// The AVD an emulator runs.
    avd: Option<String>,
}

/// One line of `adb devices` as the page shows it. `props` is what `getprop`
/// said, `None` when adb did not call the device ready or its shell did not
/// answer. `earlier` is what the last listing called the same serial. Returns
/// the device and what to call that serial at the next listing.
fn android_device(
    serial: String,
    adb_state: &str,
    props: Option<AndroidProps>,
    earlier: Option<&AndroidName>,
) -> (CaptureDevice, Option<AndroidName>) {
    let is_emulator = serial.starts_with("emulator-");
    let mut state = match adb_state {
        "device" => "running",
        "unauthorized" => "unauthorized",
        "offline" => "offline",
        _ => "starting",
    };
    let known = match props {
        Some(props) => {
            let mut os = "Android".to_string();
            if !props.release.is_empty() {
                os = format!("Android {}", props.release);
                // adb answers an emulator half a minute before its settings
                // and activity services do, and a tidy or an app list sent
                // then fails with "Can't find service".
                if !props.booted {
                    state = "starting";
                }
            }
            let avd = (is_emulator && valid_avd(&props.avd)).then(|| props.avd.clone());
            let name = match &avd {
                Some(avd) => avd_label(avd),
                None if !props.model.is_empty() => props.model.clone(),
                None => serial.clone(),
            };
            Some(AndroidName { name, os, avd })
        }
        None => {
            // An emulator that is shutting down stays in adb's list for a
            // moment after its shell has closed, first as "device" and then
            // as "offline". It keeps its name meanwhile, so the page can still
            // tell which AVD stopped and offer to start it again.
            if state == "running" {
                state = "offline";
            }
            earlier.cloned()
        }
    };
    let shown = known.clone().unwrap_or_else(|| AndroidName { name: serial.clone(), os: "Android".into(), avd: None });
    let device = CaptureDevice {
        id: serial,
        platform: "android",
        kind: if is_emulator { "emulator" } else { "phone" },
        name: shown.name,
        state,
        os: shown.os,
        model: None,
    };
    (device, known)
}

/// `emulator -list-avds`, without the log lines some versions print first.
fn parse_avds(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| valid_avd(line))
        .map(str::to_string)
        .collect()
}

/// An AVD name as a person would write it: "Pixel_9_Pro_API_35" reads
/// "Pixel 9 Pro API 35".
fn avd_label(name: &str) -> String {
    name.replace('_', " ")
}

fn android_devices(state: &CaptureState) -> PlatformDevices {
    let Some(adb) = adb_path(state) else {
        return PlatformDevices { missing: Some("sdk"), ..Default::default() };
    };
    // Started on its own first, so `devices` never waits on a server starting.
    let _ = run(&adb, &["start-server"], Duration::from_secs(15));
    let listed = match run(&adb, &["devices", "-l"], Duration::from_secs(10)) {
        Ok(ran) if ran.ok => ran.text(),
        _ => return PlatformDevices { error: Some(ADB_SILENT.into()), ..Default::default() },
    };
    let mut devices = Vec::new();
    let mut running_avds = Vec::new();
    let earlier = state.android_names.lock().unwrap().clone();
    let mut names = HashMap::new();
    for (serial, adb_state) in parse_adb_devices(&listed) {
        let props = if adb_state == "device" {
            adb_shell(
                &adb,
                &serial,
                "getprop ro.build.version.release; getprop ro.product.model; getprop ro.boot.qemu.avd_name; getprop sys.boot_completed",
                Duration::from_secs(8),
                "Could not read the device",
            )
            .ok()
            .map(|ran| parse_props(&ran.text()))
        } else {
            None
        };
        let (device, known) = android_device(serial.clone(), &adb_state, props, earlier.get(&serial));
        if let Some(known) = known {
            // Listed while it shuts down too, so its AVD is not offered as off
            // until the emulator has really gone.
            if let Some(avd) = &known.avd {
                running_avds.push(avd.clone());
            }
            names.insert(serial, known);
        }
        devices.push(device);
    }
    // Only serials still listed: a serial that left the list is forgotten, so
    // one used again later is never shown under an old name.
    *state.android_names.lock().unwrap() = names;
    if let Some(emulator) = emulator_path(&adb) {
        let avds = run(&emulator, &["-list-avds"], Duration::from_secs(10)).map(|ran| ran.text()).unwrap_or_default();
        for avd in parse_avds(&avds) {
            if running_avds.contains(&avd) {
                continue;
            }
            devices.push(CaptureDevice {
                id: format!("avd:{avd}"),
                platform: "android",
                kind: "emulator",
                name: avd_label(&avd),
                state: "off",
                os: "Android".into(),
                model: None,
            });
        }
    }
    PlatformDevices { devices, ..Default::default() }
}

fn parse_packages(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("package:"))
        .map(str::trim)
        .filter(|id| valid_app_id(id))
        .map(str::to_string)
        .collect()
}

/// The package of the activity in front, from `dumpsys activity activities`.
fn parse_front_package(text: &str) -> Option<String> {
    let line = text
        .lines()
        .find(|line| line.contains("topResumedActivity") || line.contains("ResumedActivity"))?;
    let component = line.split_whitespace().find(|word| word.contains('/'))?;
    let package = component.split('/').next()?;
    valid_app_id(package).then(|| package.to_string())
}

fn android_apps(adb: &Path, serial: &str) -> Result<Vec<CaptureApp>, String> {
    let listed = adb_shell(adb, serial, "pm list packages -3", Duration::from_secs(15), "Could not list the apps on the device")?;
    let front = adb_shell(
        adb,
        serial,
        "dumpsys activity activities | grep -E 'topResumedActivity|ResumedActivity' | head -3",
        Duration::from_secs(10),
        "Could not read the app in front",
    )
    .ok()
    .and_then(|ran| parse_front_package(&ran.text()));
    let mut apps: Vec<CaptureApp> = parse_packages(&listed.text())
        .into_iter()
        .map(|id| CaptureApp { running: front.as_deref() == Some(id.as_str()), name: id.clone(), id })
        .collect();
    apps.sort_by(|a, b| b.running.cmp(&a.running).then_with(|| a.id.cmp(&b.id)));
    Ok(apps)
}

/// The demo mode lines that draw Android's status bar at 9:41 with full Wi-Fi
/// and battery, no mobile signal and no notification icons. `fully true`
/// marks the Wi-Fi as connected to the internet: without it Android 15 draws
/// its "!" for no internet on the icon.
const ANDROID_TIDY: &str = "settings put global sysui_demo_allowed 1; \
am broadcast -a com.android.systemui.demo -e command enter >/dev/null; \
am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null; \
am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null; \
am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e fully true >/dev/null; \
am broadcast -a com.android.systemui.demo -e command network -e mobile hide >/dev/null; \
am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null";
const ANDROID_UNTIDY: &str = "am broadcast -a com.android.systemui.demo -e command exit >/dev/null";
const DEMO_ALLOWED: &str = "settings get global sysui_demo_allowed";

/// A tidy that changed nothing: the phone kept `sysui_demo_allowed` off (a
/// Xiaomi with MIUI did), and then SystemUI ignores every demo command.
const STATUS_BAR_REFUSED: &str = "That phone does not let Capture change its status bar";

/// A value `settings get` printed that can be written back unquoted.
fn valid_setting(value: &str) -> bool {
    value == "null" || (!value.is_empty() && value.len() <= 8 && value.chars().all(|c| c.is_ascii_digit()))
}

/// The line that brings back Android's real status bar and the
/// `sysui_demo_allowed` the device had before the tidy. Exit goes first, and
/// a second later the setting: SystemUI ignores a demo command it is no
/// longer allowed to take, exit included.
fn android_untidy(previous: Option<&str>) -> String {
    match previous.filter(|value| valid_setting(value)) {
        Some("null") => format!("{ANDROID_UNTIDY}; sleep 1; settings delete global sysui_demo_allowed >/dev/null"),
        Some(value) if value != "1" => format!("{ANDROID_UNTIDY}; sleep 1; settings put global sysui_demo_allowed {value}"),
        _ => ANDROID_UNTIDY.to_string(),
    }
}

/// `sysui_demo_allowed` as the device has it, or None when it did not answer.
fn read_demo_allowed(adb: &Path, serial: &str) -> Option<String> {
    adb_shell(adb, serial, DEMO_ALLOWED, Duration::from_secs(10), "")
        .ok()
        .map(|ran| ran.text().trim().to_string())
}

/// Tidies an Android status bar, and fails when the device kept its own.
fn tidy_android(adb: &Path, serial: &str) -> Result<(), String> {
    adb_shell(adb, serial, ANDROID_TIDY, Duration::from_secs(20), "Could not change the status bar")?;
    if read_demo_allowed(adb, serial).as_deref() != Some("1") {
        return Err(STATUS_BAR_REFUSED.into());
    }
    Ok(())
}

/// Notes a device whose status bar this app tidied, with what to put back.
fn remember_tidy(state: &CaptureState, platform: Platform, id: &str, demo_allowed: Option<String>) {
    let mut tidied = state.tidied.lock().unwrap();
    tidied.retain(|entry| !(entry.platform == platform && entry.id == id));
    tidied.push(Tidied { platform, id: id.to_string(), demo_allowed });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> tauri::async_runtime::JoinHandle<Result<T, String>> {
    tauri::async_runtime::spawn_blocking(work)
}

async fn finish<T>(handle: tauri::async_runtime::JoinHandle<Result<T, String>>) -> Result<T, String> {
    handle.await.map_err(|e| e.to_string())?
}

/// What the page says when adb is nowhere to be found.
const NO_ADB: &str = "Android devices need Android Studio. Install it, then try again";

fn need_adb<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    adb_path(&app.state::<CaptureState>()).ok_or_else(|| NO_ADB.to_string())
}

/// Every simulator, emulator and phone this computer can reach.
#[tauri::command]
pub async fn abs_capture_devices<R: Runtime>(app: AppHandle<R>, window: tauri::Window<R>) -> Result<CaptureDevices, String> {
    require_editor(&window)?;
    let ios = blocking(|| Ok(ios_devices()));
    let android = blocking(move || Ok(android_devices(&app.state::<CaptureState>())));
    Ok(CaptureDevices { ios: finish(ios).await?, android: finish(android).await? })
}

/// Start a simulator (and open the Simulator app on it) or an emulator. It
/// answers once the start is under way; the page watches the device list.
#[tauri::command]
pub async fn abs_capture_start_device<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    platform: String,
    id: String,
) -> Result<(), String> {
    require_editor(&window)?;
    match Platform::parse(&platform)? {
        Platform::Ios => {
            device_id(Platform::Ios, &id)?;
            finish(blocking(move || {
                let booted = simctl(&["boot", &id], Duration::from_secs(60))?;
                if !booted.ok && !booted.reason().contains("current state: Booted") {
                    return Err(format!("The simulator did not start: {}", booted.reason()));
                }
                // The Simulator app shows the device, so the user can tap through
                // their app. Its window is theirs from here on.
                let _ = run(
                    Path::new("/usr/bin/open"),
                    &["-a", "Simulator", "--args", "-CurrentDeviceUDID", &id],
                    Duration::from_secs(15),
                );
                Ok(())
            }))
            .await
        }
        Platform::Android => {
            let avd = id.strip_prefix("avd:").filter(|name| valid_avd(name)).ok_or("That emulator name does not look right")?;
            let adb = need_adb(&app)?;
            let emulator = emulator_path(&adb).ok_or("The Android emulator is not installed in the SDK")?;
            // Not a child the app waits on or stops: the emulator is the user's
            // and stays open when the app quits, as it does from Android Studio.
            command(&emulator, &["-avd", avd])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("The emulator did not start: {e}"))
        }
    }
}

/// Make a simulator of one model on the newest iOS that runs it, named after
/// the model. Answers its UDID.
#[tauri::command]
pub async fn abs_capture_create_simulator<R: Runtime>(window: tauri::Window<R>, model: String) -> Result<String, String> {
    require_editor(&window)?;
    let ok = model.starts_with("com.apple.CoreSimulator.SimDeviceType.")
        && model.len() <= 120
        && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !ok {
        return Err("That simulator model does not look right".into());
    }
    finish(blocking(move || {
        let listed = simctl_ok(&["list", "-j", "runtimes"], Duration::from_secs(20), "Could not list the iOS versions")?;
        let list: Value = serde_json::from_slice(&listed.stdout).map_err(|e| e.to_string())?;
        let runtime = list["runtimes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|runtime| runtime["isAvailable"].as_bool().unwrap_or(false) && runtime["platform"].as_str() == Some("iOS"))
            .filter(|runtime| {
                runtime["supportedDeviceTypes"]
                    .as_array()
                    .is_some_and(|types| types.iter().any(|kind| kind["identifier"].as_str() == Some(model.as_str())))
            })
            .max_by(|a, b| version_key(a["version"].as_str().unwrap_or("")).cmp(&version_key(b["version"].as_str().unwrap_or(""))))
            .cloned()
            .ok_or("No iOS version on this Mac runs that model")?;
        let runtime_id = runtime["identifier"].as_str().ok_or("No iOS version on this Mac runs that model")?.to_string();
        let name = runtime["supportedDeviceTypes"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|kind| kind["identifier"].as_str() == Some(model.as_str()))
            .and_then(|kind| kind["name"].as_str())
            .unwrap_or("iPhone")
            .to_string();
        let created = simctl_ok(&["create", &name, &model, &runtime_id], Duration::from_secs(60), "Could not make the simulator")?;
        let udid = created.text().trim().to_string();
        if valid_udid(&udid) {
            Ok(udid)
        } else {
            Err("Could not make the simulator".into())
        }
    }))
    .await
}

/// The apps the user installed on one running device, the open one first.
#[tauri::command]
pub async fn abs_capture_apps<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    platform: String,
    id: String,
) -> Result<Vec<CaptureApp>, String> {
    require_editor(&window)?;
    let platform = Platform::parse(&platform)?;
    device_id(platform, &id)?;
    match platform {
        Platform::Ios => finish(blocking(move || ios_apps(&id))).await,
        Platform::Android => {
            let adb = need_adb(&app)?;
            finish(blocking(move || android_apps(&adb, &id))).await
        }
    }
}

/// Draw the status bar at 9:41 with full signal and battery, or put the real
/// one back.
#[tauri::command]
pub async fn abs_capture_tidy_status_bar<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    platform: String,
    id: String,
    tidy: bool,
) -> Result<(), String> {
    require_editor(&window)?;
    let platform = Platform::parse(&platform)?;
    device_id(platform, &id)?;
    let adb = if platform == Platform::Android { Some(need_adb(&app)?) } else { None };
    // What a tidy this app already did on the device found there before it.
    let mut earlier: Option<String> = app
        .state::<CaptureState>()
        .tidied
        .lock()
        .unwrap()
        .iter()
        .find(|entry| entry.platform == platform && entry.id == id)
        .and_then(|entry| entry.demo_allowed.clone());
    // Android's setting is read (unless an earlier tidy did) and noted before
    // the tidy changes anything. The tidy turns the setting on first, so one
    // cut short after that never noted the value from before. On Windows in
    // November 2026 an emulator closed four seconds after it started was left
    // with the setting on after Capture quit.
    if let (true, None, Some(adb)) = (tidy, &earlier, &adb) {
        let (adb, device) = (adb.clone(), id.clone());
        earlier = finish(blocking(move || Ok(read_demo_allowed(&adb, &device)))).await?;
        remember_tidy(&app.state::<CaptureState>(), platform, &id, earlier.clone());
    }
    let device = id.clone();
    let previous = earlier.clone();
    finish(blocking(move || match (platform, &adb) {
        (Platform::Ios, _) if tidy => simctl_ok(
            &[
                "status_bar", &device, "override", "--time", "9:41", "--dataNetwork", "wifi", "--wifiMode", "active",
                "--wifiBars", "3", "--cellularMode", "active", "--cellularBars", "4", "--operatorName", "",
                "--batteryState", "discharging", "--batteryLevel", "100",
            ],
            Duration::from_secs(15),
            "Could not change the status bar",
        )
        .map(|_| ()),
        (Platform::Ios, _) => simctl_ok(&["status_bar", &device, "clear"], Duration::from_secs(15), "Could not put the status bar back").map(|_| ()),
        (Platform::Android, Some(adb)) if tidy => tidy_android(adb, &device),
        (Platform::Android, Some(adb)) => adb_shell(
            adb,
            &device,
            &android_untidy(previous.as_deref()),
            Duration::from_secs(20),
            "Could not put the status bar back",
        )
        .map(|_| ()),
        (Platform::Android, None) => Err(NO_ADB.into()),
    }))
    .await?;
    let state = app.state::<CaptureState>();
    if tidy {
        remember_tidy(&state, platform, &id, earlier);
    } else {
        state.tidied.lock().unwrap().retain(|entry| !(entry.platform == platform && entry.id == id));
    }
    Ok(())
}

/// Light or dark appearance for the whole device.
#[tauri::command]
pub async fn abs_capture_appearance<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    platform: String,
    id: String,
    dark: bool,
) -> Result<(), String> {
    require_editor(&window)?;
    let platform = Platform::parse(&platform)?;
    device_id(platform, &id)?;
    match platform {
        Platform::Ios => {
            finish(blocking(move || {
                simctl_ok(&["ui", &id, "appearance", if dark { "dark" } else { "light" }], Duration::from_secs(15), "Could not change light or dark")
                    .map(|_| ())
            }))
            .await
        }
        Platform::Android => {
            let adb = need_adb(&app)?;
            finish(blocking(move || {
                adb_shell(&adb, &id, if dark { "cmd uimode night yes" } else { "cmd uimode night no" }, Duration::from_secs(15), "Could not change light or dark")
                    .map(|_| ())
            }))
            .await
        }
    }
}

/// Open the app from the start, in `language` when one is given, with the
/// `OSGScreenshots` flag the app can read to show its sample content, and on
/// the screen `link` opens when one is given.
///
/// iOS takes the language for this launch only, as launch arguments; Android
/// keeps it as the app's own language setting (Android 13 and later), until
/// the next launch from here sets another.
///
/// A link reaches iOS as the launch argument `-OSGLink`, for the app to open
/// itself: iOS asks "Open in <app>?" before it opens any link `simctl openurl`
/// sends, cold or warm (seen on iOS 26.5), and nothing here can tap Open, so
/// the screenshot would be of the question. Android opens the link with a VIEW
/// intent aimed at the app, which asks nothing.
#[tauri::command]
pub async fn abs_capture_launch<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    platform: String,
    id: String,
    app_id: String,
    language: Option<String>,
    region: Option<String>,
    link: Option<String>,
) -> Result<(), String> {
    require_editor(&window)?;
    let platform = Platform::parse(&platform)?;
    device_id(platform, &id)?;
    if !valid_app_id(&app_id) {
        return Err("That app id does not look right".into());
    }
    let language = language.filter(|value| !value.is_empty());
    let region = region.filter(|value| !value.is_empty());
    if language.as_deref().is_some_and(|value| !valid_language(value)) || region.as_deref().is_some_and(|value| !valid_language(value)) {
        return Err("That language code does not look right".into());
    }
    let link = link.filter(|value| !value.is_empty());
    if link.as_deref().is_some_and(|value| !valid_link(value)) {
        return Err("That link does not look right. It needs a scheme, such as myapp://".into());
    }
    match platform {
        Platform::Ios => {
            finish(blocking(move || {
                let mut args = vec!["launch".to_string(), "--terminate-running-process".into(), id, app_id];
                if let Some(language) = language {
                    args.push("-AppleLanguages".into());
                    args.push(format!("({language})"));
                    if let Some(region) = region {
                        args.push("-AppleLocale".into());
                        args.push(region);
                    }
                }
                args.push("-OSGScreenshots".into());
                args.push("YES".into());
                if let Some(link) = link {
                    args.push("-OSGLink".into());
                    args.push(link);
                }
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                simctl_ok(&refs, Duration::from_secs(60), "The app did not open").map(|_| ())
            }))
            .await
        }
        Platform::Android => {
            let adb = need_adb(&app)?;
            finish(blocking(move || {
                let package = device_quote(&app_id);
                if let Some(language) = language {
                    let set = format!("cmd locale set-app-locales {package} --locales {}", device_quote(&language));
                    let ran = adb_shell(&adb, &id, &set, Duration::from_secs(15), "Could not change the app's language")?;
                    let said = ran.text();
                    if said.contains("Unknown command") || said.contains("No shell command implementation") {
                        return Err("This device needs Android 13 or later to switch your app's language".into());
                    }
                }
                adb_shell(&adb, &id, &format!("am force-stop {package}"), Duration::from_secs(15), "Could not close the app")?;
                if let Some(link) = link {
                    let started = adb_shell(
                        &adb,
                        &id,
                        &format!(
                            "am start -W -a android.intent.action.VIEW -d {} --ez osg_screenshots true {package}",
                            device_quote(&link)
                        ),
                        Duration::from_secs(60),
                        "The app did not open that link",
                    )?;
                    if started.text().contains("Error") {
                        return Err(format!("The app did not open that link: {}", started.reason()));
                    }
                    return Ok(());
                }
                let resolved = adb_shell(
                    &adb,
                    &id,
                    &format!("cmd package resolve-activity --brief -c android.intent.category.LAUNCHER {package}"),
                    Duration::from_secs(15),
                    "Could not find how to open the app",
                )?;
                let component = resolved
                    .text()
                    .lines()
                    .map(str::trim)
                    .rfind(|line| line.contains('/') && !line.contains(' '))
                    .map(str::to_string)
                    .ok_or("Could not find how to open the app")?;
                let started = adb_shell(
                    &adb,
                    &id,
                    &format!("am start -W -n {} --ez osg_screenshots true", device_quote(&component)),
                    Duration::from_secs(60),
                    "The app did not open",
                )?;
                if started.text().contains("Error") {
                    return Err(format!("The app did not open: {}", started.reason()));
                }
                Ok(())
            }))
            .await
        }
    }
}

/// The screen as it is now: a PNG at the device's full size, or for the live
/// view a smaller file (a JPEG on iOS; Android's screencap only makes PNGs).
#[tauri::command]
pub async fn abs_capture_screenshot<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    platform: String,
    id: String,
    preview: Option<bool>,
) -> Result<Response, String> {
    require_editor(&window)?;
    let platform = Platform::parse(&platform)?;
    device_id(platform, &id)?;
    let preview = preview.unwrap_or(false);
    let bytes = match platform {
        Platform::Ios => {
            finish(blocking(move || {
                let file = temp_file(if preview { "jpg" } else { "png" });
                let file_arg = file.to_string_lossy().into_owned();
                let kind = if preview { "--type=jpeg" } else { "--type=png" };
                let ran = simctl(&["io", &id, "screenshot", kind, "--mask=ignored", &file_arg], Duration::from_secs(30));
                match ran {
                    Ok(ran) if ran.ok => read_and_remove(&file),
                    Ok(ran) => {
                        let _ = std::fs::remove_file(&file);
                        Err(format!("Could not take the screenshot: {}", ran.reason()))
                    }
                    Err(e) => {
                        let _ = std::fs::remove_file(&file);
                        Err(e)
                    }
                }
            }))
            .await?
        }
        Platform::Android => {
            let adb = need_adb(&app)?;
            finish(blocking(move || {
                let ran = adb_ok(&adb, &id, &["exec-out", "screencap", "-p"], Duration::from_secs(30), "Could not take the screenshot")?;
                if ran.stdout.starts_with(b"\x89PNG") {
                    Ok(ran.stdout)
                } else {
                    Err(format!("Could not take the screenshot: {}", ran.reason()))
                }
            }))
            .await?
        }
    };
    Ok(Response::new(bytes))
}

/// Start recording the screen. One recording per device at a time.
#[tauri::command]
pub async fn abs_capture_record_start<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    platform: String,
    id: String,
) -> Result<(), String> {
    require_editor(&window)?;
    let platform = Platform::parse(&platform)?;
    device_id(platform, &id)?;
    let key = device_key(platform, &id);
    let state = app.state::<CaptureState>();
    // Found before the lock: looking for adb can run a login shell.
    let adb = match platform {
        Platform::Android => Some(need_adb(&app)?),
        Platform::Ios => None,
    };
    // One lock from the check to the insert, so two starts for one device
    // cannot both pass the check and leave a recorder nothing tracks.
    // Spawning does not wait for the recorder, so the lock is held briefly.
    let mut recordings = state.recordings.lock().unwrap();
    recordings.check_free(&key)?;
    let file = temp_file("mp4");
    let child = match platform {
        Platform::Ios => {
            let file_arg = file.to_string_lossy().into_owned();
            command(Path::new(XCRUN), &["simctl", "io", &id, "recordVideo", "--codec=h264", "--mask=ignored", "--force", &file_arg])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
        }
        Platform::Android => {
            let adb = adb.as_deref().ok_or(NO_ADB)?;
            command(adb, &["-s", &id, "shell", &format!("screenrecord --bit-rate 20000000 {DEVICE_RECORDING}")])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
        }
    }
    .map_err(|e| format!("The recording did not start: {e}"))?;
    recordings.start(key, Recording { child, window: window.label().to_string(), file, platform, id });
    Ok(())
}

/// How long Stop waits at most for an Android encoder to catch up with the screen.
const ENCODER_CATCH_UP: Duration = Duration::from_secs(20);
/// The encoder has used next to no CPU for this long: it has caught up.
const ENCODER_IDLE: Duration = Duration::from_secs(1);
/// CPU clock ticks (10 ms each) in a quarter second that still count as idle.
const ENCODER_BUSY_TICKS: u64 = 2;

/// CPU time spent encoding on the device so far, in clock ticks: screenrecord
/// itself and the software codec service an emulator encodes in. None when
/// the device does not answer.
fn encoder_ticks(adb: &Path, serial: &str) -> Option<u64> {
    let ran = adb_shell(
        adb,
        serial,
        "for p in $(pidof screenrecord) $(pidof media.swcodec); do cut -d' ' -f14,15 /proc/$p/stat; done",
        Duration::from_secs(5),
        "",
    )
    .ok()?;
    Some(ran.text().split_whitespace().filter_map(|ticks| ticks.parse::<u64>().ok()).sum())
}

/// Waits until the encoder has gone idle, or ENCODER_CATCH_UP at most. An
/// emulator's software encoder runs seconds behind a changing screen, and
/// screenrecord drops whatever it has not encoded when it is interrupted:
/// measured on Windows, 6.3 s of a changing screen came out as a 0.8 s clip
/// when interrupted at once, and whole after waiting 6.8 s for the encoder.
/// The size of the file on the device says nothing here, because the muxer
/// holds the frames in memory until the end.
fn wait_for_encoder(adb: &Path, serial: &str) {
    let started = Instant::now();
    let Some(mut last) = encoder_ticks(adb, serial) else { return };
    let mut idle_since = Instant::now();
    while started.elapsed() < ENCODER_CATCH_UP {
        std::thread::sleep(Duration::from_millis(250));
        let Some(now) = encoder_ticks(adb, serial) else { return };
        if now.saturating_sub(last) > ENCODER_BUSY_TICKS {
            idle_since = Instant::now();
        }
        last = now;
        if idle_since.elapsed() >= ENCODER_IDLE {
            return;
        }
    }
}

/// Asks a recorder to finish its file, and waits up to `patience` for it to
/// exit. An interrupt, as Ctrl+C in a terminal: the recorder writes the movie
/// out and exits, where a kill would leave a file that does not play.
fn stop_recorder<R: Runtime>(app: &AppHandle<R>, recording: &mut Recording, patience: Duration) {
    let pid = recording.child.id();
    match recording.platform {
        Platform::Ios => {
            #[cfg(unix)]
            {
                let _ = run(Path::new("/bin/kill"), &["-INT", &pid.to_string()], Duration::from_secs(5));
            }
        }
        Platform::Android => {
            if let Some(adb) = adb_path(&app.state::<CaptureState>()) {
                let _ = adb_shell(&adb, &recording.id, "pkill -INT screenrecord", Duration::from_secs(10), "");
            }
        }
    }
    let deadline = Instant::now() + patience;
    loop {
        match recording.child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() >= deadline => {
                kill_tree(pid);
                let _ = recording.child.kill();
                let _ = recording.child.wait();
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => break,
        }
    }
}

/// Stops a recorder once its encoder has caught up, then takes the movie.
fn finish_recording<R: Runtime>(app: &AppHandle<R>, mut recording: Recording) -> Result<Vec<u8>, String> {
    if recording.platform == Platform::Android {
        if let Some(adb) = adb_path(&app.state::<CaptureState>()) {
            wait_for_encoder(&adb, &recording.id);
        }
    }
    stop_recorder(app, &mut recording, Duration::from_secs(20));
    if recording.platform == Platform::Android {
        let adb = adb_path(&app.state::<CaptureState>()).ok_or(NO_ADB)?;
        let target = recording.file.to_string_lossy().into_owned();
        let pulled = adb_ok(&adb, &recording.id, &["pull", DEVICE_RECORDING, &target], Duration::from_secs(60), "Could not copy the recording from the device");
        let _ = adb_shell(&adb, &recording.id, &format!("rm -f {DEVICE_RECORDING}"), Duration::from_secs(10), "");
        pulled?;
    }
    let bytes = read_and_remove(&recording.file)?;
    if bytes.len() < 1024 {
        return Err("The recording came out empty. Record for at least a second".into());
    }
    Ok(bytes)
}

/// Stop recording and answer the movie (an MP4).
#[tauri::command]
pub async fn abs_capture_record_stop<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    platform: String,
    id: String,
) -> Result<Response, String> {
    require_editor(&window)?;
    let platform = Platform::parse(&platform)?;
    device_id(platform, &id)?;
    let key = device_key(platform, &id);
    let (recording, release) = {
        let state = app.state::<CaptureState>();
        let mut recordings = state.recordings.lock().unwrap();
        let recording = recordings.take(&key, |recording| {
            if recording.window == window.label() {
                Ok(())
            } else {
                Err("Another window started that recording".into())
            }
        })?;
        (recording, Release { slots: state.recordings.clone(), key })
    };
    let handle = app.clone();
    let bytes = finish(blocking(move || {
        // Held until the save is over, even when this window goes away first.
        let _release = release;
        finish_recording(&handle, recording)
    }))
    .await?;
    Ok(Response::new(bytes))
}

/// Stops a recording nobody will use and leaves nothing behind: no recorder,
/// no file on the device, no file here.
fn discard_recording<R: Runtime>(app: &AppHandle<R>, mut recording: Recording) {
    stop_recorder(app, &mut recording, Duration::from_secs(5));
    if recording.platform == Platform::Android {
        if let Some(adb) = adb_path(&app.state::<CaptureState>()) {
            let _ = adb_shell(&adb, &recording.id, &format!("rm -f {DEVICE_RECORDING}"), Duration::from_secs(10), "");
        }
    }
    let _ = std::fs::remove_file(&recording.file);
}

/// Throws away the recordings one window started (all of them with `None`),
/// on a thread `stop_all` waits for.
fn drop_recordings<R: Runtime>(app: &AppHandle<R>, window: Option<&str>) {
    let state = app.state::<CaptureState>();
    let dropped: Vec<(Release<Recording>, Recording)> = {
        let mut recordings = state.recordings.lock().unwrap();
        recordings
            .take_where(|recording| window.is_none_or(|label| recording.window == label))
            .into_iter()
            .map(|(key, recording)| (Release { slots: state.recordings.clone(), key }, recording))
            .collect()
    };
    if dropped.is_empty() {
        return;
    }
    let handle = app.clone();
    let cleanup = std::thread::spawn(move || {
        for (release, recording) in dropped {
            discard_recording(&handle, recording);
            drop(release);
        }
    });
    let mut cleanups = state.cleanups.lock().unwrap();
    cleanups.retain(|thread| !thread.is_finished());
    cleanups.push(cleanup);
}

/// A window closed: its recordings stop.
pub fn stop_window<R: Runtime>(app: &AppHandle<R>, window: &str) {
    drop_recordings(app, Some(window));
}

/// A page started loading in a window, so whatever it was recording has no
/// one left to hand the movie to.
pub fn on_page_load<R: Runtime>(webview: &tauri::Webview<R>, payload: &tauri::webview::PageLoadPayload<'_>) {
    if payload.event() == tauri::webview::PageLoadEvent::Started {
        drop_recordings(webview.app_handle(), Some(webview.window().label()));
    }
}

/// How long quitting waits for the recordings being thrown away.
const QUIT_CLEANUP: Duration = Duration::from_secs(10);

/// The app is quitting: every recording stops and leaves nothing on its
/// device, and every status bar this app tidied is put back. It waits, at
/// most QUIT_CLEANUP for the recordings, because the process ends after this.
/// A window closing first has already handed its recordings to a thread; the
/// process ending with that thread between the recorder stopping and the file
/// going left the file on the device.
pub fn stop_all<R: Runtime>(app: &AppHandle<R>) {
    drop_recordings(app, None);
    let state = app.state::<CaptureState>();
    let cleanups: Vec<std::thread::JoinHandle<()>> = state.cleanups.lock().unwrap().drain(..).collect();
    let deadline = Instant::now() + QUIT_CLEANUP;
    for cleanup in cleanups {
        while !cleanup.is_finished() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(25));
        }
        if cleanup.is_finished() {
            let _ = cleanup.join();
        }
    }
    let adb = state.adb.lock().unwrap().clone();
    // A Stop still saving belongs to a page that is going away with the app.
    let saving = state.recordings.lock().unwrap().saving_keys();
    for key in saving {
        if let (Some(serial), Some(adb)) = (key.strip_prefix("Android:"), &adb) {
            let line = format!("pkill -INT screenrecord; sleep 1; rm -f {DEVICE_RECORDING}");
            let _ = adb_shell(adb, serial, &line, Duration::from_secs(8), "");
        }
    }
    let tidied: Vec<Tidied> = state.tidied.lock().unwrap().drain(..).collect();
    for entry in tidied {
        match entry.platform {
            Platform::Ios => {
                let _ = simctl(&["status_bar", &entry.id, "clear"], Duration::from_secs(5));
            }
            Platform::Android => {
                if let Some(adb) = &adb {
                    let _ = adb_shell(adb, &entry.id, &android_untidy(entry.demo_allowed.as_deref()), Duration::from_secs(8), "");
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_from_the_page_are_checked() {
        assert!(valid_udid("B0DE85F2-7E38-4083-9EA2-C4525D1D3040"));
        assert!(!valid_udid("B0DE85F2-7E38-4083-9EA2-C4525D1D304; rm"));
        assert!(valid_serial("emulator-5554"));
        assert!(valid_serial("192.168.1.20:5555"));
        assert!(!valid_serial("-s"));
        assert!(!valid_serial("emulator 5554"));
        assert!(valid_app_id("com.example.my-app"));
        assert!(!valid_app_id("com.example;reboot"));
        assert!(!valid_app_id("-n"));
        assert!(valid_language("de"));
        assert!(valid_language("zh-Hans"));
        assert!(valid_language("pt-BR"));
        assert!(valid_language("de_DE"));
        assert!(valid_language("sr-Latn-RS"));
        assert!(!valid_language("d"));
        assert!(!valid_language("de DE"));
        assert!(!valid_language("de-$(x)"));
        assert!(valid_link("myapp://feed/today"));
        assert!(valid_link("https://example.com/a?b=c"));
        assert!(!valid_link("feed/today"));
        assert!(!valid_link("myapp://a b"));
        assert!(!valid_link("-a"));
        assert!(!valid_link("1app://x"));
    }

    #[test]
    fn device_shell_quoting_keeps_a_value_whole() {
        assert_eq!(device_quote("myapp://a"), "'myapp://a'");
        assert_eq!(device_quote("it's;rm -rf /"), "'it'\\''s;rm -rf /'");
    }

    #[test]
    fn reads_simctl_list() {
        let list: Value = serde_json::json!({
            "runtimes": [
                { "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-18-5", "name": "iOS 18.5", "version": "18.5", "platform": "iOS", "isAvailable": true,
                  "supportedDeviceTypes": [] },
                { "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-5", "name": "iOS 26.5", "version": "26.5", "platform": "iOS", "isAvailable": true,
                  "supportedDeviceTypes": [
                    { "identifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max", "name": "iPhone 17 Pro Max", "productFamily": "iPhone" },
                    { "identifier": "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3-49mm", "name": "Apple Watch Ultra 3", "productFamily": "Apple Watch" }
                  ] },
                { "identifier": "com.apple.CoreSimulator.SimRuntime.watchOS-26-0", "name": "watchOS 26.0", "version": "26.0", "platform": "watchOS", "isAvailable": true, "supportedDeviceTypes": [] }
            ],
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
                    { "udid": "B0DE85F2-7E38-4083-9EA2-C4525D1D3040", "name": "iPhone 17 Pro Max", "state": "Booted", "isAvailable": true,
                      "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max" },
                    { "udid": "11111111-2222-3333-4444-555555555555", "name": "Old", "state": "Shutdown", "isAvailable": false,
                      "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro" }
                ],
                "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [
                    { "udid": "66666666-2222-3333-4444-555555555555", "name": "Watch", "state": "Shutdown", "isAvailable": true,
                      "deviceTypeIdentifier": "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra-3-49mm" }
                ]
            }
        });
        let (devices, models) = parse_simulators(&list);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].state, "running");
        assert_eq!(devices[0].os, "iOS 26.5");
        assert_eq!(models, vec![SimulatorModel {
            id: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max".into(),
            name: "iPhone 17 Pro Max".into(),
            family: "iPhone".into(),
        }]);
    }

    #[test]
    fn reads_the_simulator_app_list() {
        let apps: Value = serde_json::json!({
            "com.apple.Preferences": { "ApplicationType": "System", "CFBundleDisplayName": "Settings" },
            "com.example.notes": { "ApplicationType": "User", "CFBundleDisplayName": "Notes Pro" },
            "com.example.zeta": { "ApplicationType": "User", "CFBundleName": "Zeta" }
        });
        let launchctl = "-\t0\tUIKitApplication:com.example.zeta[1a2b][rb-legacy]\n";
        let parsed = parse_ios_apps(&apps, launchctl);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0], CaptureApp { id: "com.example.zeta".into(), name: "Zeta".into(), running: true });
        assert_eq!(parsed[1].name, "Notes Pro");
    }

    #[test]
    fn reads_adb_output() {
        let devices = "* daemon started successfully\nList of devices attached\nemulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:12\nR58M12345     unauthorized usb:1-1 transport_id:3\n\n";
        assert_eq!(
            parse_adb_devices(devices),
            vec![("emulator-5554".to_string(), "device".to_string()), ("R58M12345".to_string(), "unauthorized".to_string())]
        );
        assert_eq!(parse_avds("INFO    | Storing crashdata\nPixel_9_Pro_API_35\nPocketBase_Replay_API_36\n"), vec!["Pixel_9_Pro_API_35", "PocketBase_Replay_API_36"]);
        assert_eq!(parse_packages("package:com.example.app\npackage:org.other\n"), vec!["com.example.app", "org.other"]);
        let front = "      topResumedActivity=ActivityRecord{159956691 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity t6}\n";
        assert_eq!(parse_front_package(front).as_deref(), Some("com.google.android.apps.nexuslauncher"));
        assert_eq!(avd_label("Pixel_9_Pro_API_35"), "Pixel 9 Pro API 35");
    }

    const EMULATOR: &str = "Android:emulator-5554";

    fn slots() -> Arc<Mutex<Slots<&'static str>>> {
        Arc::new(Mutex::new(Slots::default()))
    }

    fn same_window(window: &'static str) -> impl FnOnce(&&'static str) -> Result<(), String> {
        move |started| if *started == window { Ok(()) } else { Err("Another window started that recording".into()) }
    }

    #[test]
    fn a_stopped_recording_keeps_its_device_until_it_is_saved() {
        let slots = slots();
        slots.lock().unwrap().start(EMULATOR.into(), "main");
        assert_eq!(slots.lock().unwrap().check_free(EMULATOR).unwrap_err(), "That device is already recording");
        // Another window may not stop it, and trying leaves it recording.
        assert!(slots.lock().unwrap().take(EMULATOR, same_window("panel")).is_err());
        assert!(slots.lock().unwrap().check_free(EMULATOR).unwrap_err().contains("already recording"));

        let taken = slots.lock().unwrap().take(EMULATOR, same_window("main")).unwrap();
        assert_eq!(taken, "main");
        let release = Release { slots: slots.clone(), key: EMULATOR.to_string() };
        // While the movie is saved, a new recording on that device is refused.
        assert!(slots.lock().unwrap().check_free(EMULATOR).unwrap_err().contains("still saving"));
        assert_eq!(slots.lock().unwrap().take(EMULATOR, same_window("main")).unwrap_err(), NOT_RECORDING);
        drop(release);
        assert!(slots.lock().unwrap().check_free(EMULATOR).is_ok());
    }

    #[test]
    fn a_save_that_panics_still_frees_its_device() {
        let slots = slots();
        slots.lock().unwrap().start(EMULATOR.into(), "main");
        slots.lock().unwrap().take(EMULATOR, same_window("main")).unwrap();
        let release = Release { slots: slots.clone(), key: EMULATOR.to_string() };
        let saved = std::thread::spawn(move || {
            let _release = release;
            panic!("the save broke");
        })
        .join();
        assert!(saved.is_err());
        assert!(slots.lock().unwrap().check_free(EMULATOR).is_ok());
    }

    #[test]
    fn a_closed_window_takes_only_its_own_recordings() {
        let slots = slots();
        let ios = "Ios:B0DE85F2-7E38-4083-9EA2-C4525D1D3040";
        slots.lock().unwrap().start(EMULATOR.into(), "main");
        slots.lock().unwrap().start(ios.into(), "panel");
        let taken = slots.lock().unwrap().take_where(|window| *window == "main");
        assert_eq!(taken, vec![(EMULATOR.to_string(), "main")]);
        assert!(slots.lock().unwrap().check_free(EMULATOR).unwrap_err().contains("still saving"));
        // A release for a device that is recording, not saving, leaves the recording alone.
        slots.lock().unwrap().release(ios);
        assert!(slots.lock().unwrap().check_free(ios).unwrap_err().contains("already recording"));
        // Quitting takes what is still recording, then knows every device still saving.
        assert_eq!(slots.lock().unwrap().take_where(|_| true), vec![(ios.to_string(), "panel")]);
        assert_eq!(slots.lock().unwrap().saving_keys(), vec![EMULATOR.to_string(), ios.to_string()]);
    }

    #[test]
    fn a_device_runs_once_android_has_started() {
        let booted = parse_props("15\nsdk_gphone64_x86_64\nOSG_Test_API_35\n1\n");
        assert_eq!(
            booted,
            AndroidProps { release: "15".into(), model: "sdk_gphone64_x86_64".into(), avd: "OSG_Test_API_35".into(), booted: true }
        );
        // adb answers while Android is still starting, and sys.boot_completed is empty then.
        assert!(!parse_props("15\nsdk_gphone64_x86_64\nOSG_Test_API_35\n\n").booted);
        // A phone has no AVD name; its empty line keeps the others in place.
        let phone = parse_props("11\nM2006C3LG\n\n1\n");
        assert_eq!((phone.model.as_str(), phone.avd.as_str(), phone.booted), ("M2006C3LG", "", true));
        assert_eq!(parse_props(""), AndroidProps::default());
    }

    #[test]
    fn the_real_status_bar_comes_back_with_the_setting_it_had() {
        assert!(ANDROID_TIDY.contains("-e wifi show -e level 4 -e fully true"));
        assert_eq!(android_untidy(Some("0")), format!("{ANDROID_UNTIDY}; sleep 1; settings put global sysui_demo_allowed 0"));
        assert_eq!(android_untidy(Some("null")), format!("{ANDROID_UNTIDY}; sleep 1; settings delete global sysui_demo_allowed >/dev/null"));
        // Allowed before the tidy, or never read: only the exit.
        assert_eq!(android_untidy(Some("1")), ANDROID_UNTIDY);
        assert_eq!(android_untidy(None), ANDROID_UNTIDY);
        // Anything else a device printed is never written back.
        assert_eq!(android_untidy(Some("0; reboot")), ANDROID_UNTIDY);
        assert_eq!(android_untidy(Some("")), ANDROID_UNTIDY);
    }

    #[test]
    fn a_tidy_cut_short_still_knows_what_to_put_back() {
        let state = CaptureState::default();
        // Noted before the tidy runs. The tidy then fails half way, so
        // nothing after this line is ever reached for it.
        remember_tidy(&state, Platform::Android, "emulator-5554", Some("0".into()));
        // Noting the same device again replaces its entry, never adds one.
        remember_tidy(&state, Platform::Android, "emulator-5554", Some("0".into()));
        let tidied = state.tidied.lock().unwrap();
        assert_eq!(tidied.len(), 1);
        assert_eq!(
            android_untidy(tidied[0].demo_allowed.as_deref()),
            format!("{ANDROID_UNTIDY}; sleep 1; settings put global sysui_demo_allowed 0")
        );
    }

    #[test]
    fn an_emulator_that_shuts_down_keeps_its_name_until_it_has_gone() {
        let serial = || "emulator-5554".to_string();
        let (running, known) = android_device(serial(), "device", Some(parse_props("15\nsdk_gphone64_x86_64\nOSG_Test_API_35\n1\n")), None);
        assert_eq!((running.name.as_str(), running.state, running.os.as_str()), ("OSG Test API 35", "running", "Android 15"));
        let known = known.expect("a device that answered is remembered");
        assert_eq!(known.avd.as_deref(), Some("OSG_Test_API_35"));

        // Measured on Windows: two seconds after `emu kill` adb still lists
        // the emulator as "device" while its shell answers "error: closed",
        // then "offline", then nothing.
        let (closing, kept) = android_device(serial(), "device", None, Some(&known));
        assert_eq!((closing.name.as_str(), closing.state, closing.os.as_str()), ("OSG Test API 35", "offline", "Android 15"));
        assert_eq!(kept.as_ref(), Some(&known));
        let (offline, kept) = android_device(serial(), "offline", None, kept.as_ref());
        assert_eq!((offline.name.as_str(), offline.state), ("OSG Test API 35", "offline"));
        assert_eq!(kept, Some(known));

        // Never seen answering: the serial is all there is to show.
        let (unknown, kept) = android_device(serial(), "device", None, None);
        assert_eq!((unknown.name.as_str(), unknown.state), ("emulator-5554", "offline"));
        assert_eq!(kept, None);
        // A phone has no AVD, and its model is its name.
        let (phone, kept) = android_device("YPKRA6VS754L6XTO".into(), "device", Some(parse_props("11\nM2006C3LG\n\n1\n")), None);
        assert_eq!((phone.name.as_str(), phone.kind, phone.state), ("M2006C3LG", "phone", "running"));
        assert_eq!(kept.and_then(|known| known.avd), None);
    }
}
