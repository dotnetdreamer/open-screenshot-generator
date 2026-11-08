//! In-app updates for the builds we publish ourselves.
//!
//! Updates come from our own update server (infra/vps/update-server), not from
//! GitHub. The server's address and the public key that every download is
//! checked against are written into `plugins.updater` by CI
//! (scripts/updates/configure-build.mjs) when it builds a release. A build made
//! any other way has an empty key and no endpoint, and this module stays off.
//!
//! What an install does about updates depends on how it got onto the machine:
//!
//! - From an installer (NSIS, MSI, the macOS app, AppImage, deb) it downloads
//!   the update, lets the plugin check the signature, installs it and restarts.
//! - From the portable zip it only finds out that a new version exists. That
//!   exe carries no installer's mark, and the updater would run a full
//!   installer beside it, so the page links to the download instead.
//! - From the Microsoft Store (MSIX) or the Mac App Store it never checks. The
//!   store updates it, and Apple allows no other way.
//!
//! The page decides when to check, because the switches that govern it are
//! editor preferences, and calls `abs_update_check`. Everything after that
//! happens here: the request, the download, and the restart. Only `main` may
//! drive it.

use std::collections::HashSet;
use std::fs;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, Runtime, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Every change of state goes to `main` on this channel.
const STATE_EVENT: &str = "abs-update-state";
/// Asks each editor window to write its unsaved edits before an install.
const FLUSH_EVENT: &str = "abs-update-flush";
/// Help > Check for updates. The page runs the check, because it knows the channel.
const CHECK_REQUEST_EVENT: &str = "abs-update-check-requested";

/// A check that has not answered by then has failed.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// A download that receives nothing for this long is stopped.
const STALL_LIMIT: Duration = Duration::from_secs(90);
/// How long an install waits for the editor windows to report their edits written.
const FLUSH_WAIT: Duration = Duration::from_secs(8);
/// Download progress reaches the page at most this often.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// Holds this install's rollout bucket, in the app config dir.
const BUCKET_FILE: &str = "updates.json";

/// Starts the error an install rejects with when an editor window could not
/// write its edits, so the page can tell that apart from a failed install.
const EDITS_NOT_SAVED: &str = "edits-not-saved";

/// What this install does about updates.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Downloads, verifies and installs updates.
    Install,
    /// Finds out about updates but never installs one.
    Notify,
    /// Never checks.
    Off,
}

/// Why the mode is not `Install`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// This build has no update server or no key.
    Unconfigured,
    /// The Mac App Store build.
    AppStore,
    /// The Microsoft Store (MSIX) build.
    #[cfg_attr(not(windows), allow(dead_code))]
    MicrosoftStore,
    /// The portable zip: no installer put this exe where it is.
    Portable,
    /// A debug build, which must never replace itself.
    Development,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Channel {
    Stable,
    Beta,
}

impl Channel {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "stable" => Ok(Self::Stable),
            "beta" => Ok(Self::Beta),
            other => Err(format!("unknown update channel {other:?}")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
        }
    }
}

/// The parts of an update the page shows.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    notes: Option<String>,
    /// RFC 3339, as the server sent it.
    date: Option<String>,
    /// The release fixes something serious enough that the page should keep asking.
    critical: bool,
    /// Where a person can download the release by hand. Always https.
    download_page: Option<String>,
    /// Size of the download in bytes, when the server knows it.
    size: Option<u64>,
}

impl UpdateInfo {
    /// `raw` is the server's whole answer: the plugin reads the fields Tauri
    /// defines, and the rest (critical, download_page, size) are ours.
    fn from_parts(version: &str, current_version: &str, notes: Option<&str>, raw: &Value) -> Self {
        let text = |key: &str| raw.get(key).and_then(Value::as_str).map(str::to_owned);
        Self {
            version: version.to_owned(),
            current_version: current_version.to_owned(),
            notes: notes.map(str::trim).filter(|notes| !notes.is_empty()).map(str::to_owned),
            date: text("pub_date"),
            critical: raw.get("critical").and_then(Value::as_bool).unwrap_or(false),
            // The page opens this in the browser, so nothing but https gets there.
            download_page: text("download_page").filter(|url| url.starts_with("https://")),
            size: raw.get("size").and_then(Value::as_u64),
        }
    }

    fn from_update(update: &Update) -> Self {
        Self::from_parts(&update.version, &update.current_version, update.body.as_deref(), &update.raw_json)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Step {
    Check,
    Download,
}

/// Where the update is. Serialized as `{ "phase": "downloading", ... }`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
enum Phase {
    Idle,
    Checking,
    UpToDate,
    /// Notify mode found a newer version. Nothing is downloaded.
    Available { update: UpdateInfo },
    Downloading { update: UpdateInfo, received: u64, total: Option<u64> },
    /// Downloaded, and the signature checked out.
    Ready { update: UpdateInfo },
    Installing { update: UpdateInfo },
    Failed { step: Step, message: String },
}

/// What the page reads, from `abs_update_state` and with every event.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    mode: Mode,
    reason: Option<Reason>,
    current_version: String,
    phase: Phase,
    /// Unix milliseconds of the last check the server answered.
    checked_at: Option<u64>,
}

struct Inner {
    phase: Phase,
    checked_at: Option<u64>,
    /// Bumped by every check, so the answer to an older one cannot overwrite a newer one.
    generation: u64,
    /// The update behind `Downloading` and `Ready`.
    pending: Option<Arc<Update>>,
    /// Its verified bytes, once they are in.
    bytes: Option<Arc<Vec<u8>>>,
}

/// The editor windows an install is still waiting on.
struct Flush {
    nonce: u64,
    waiting: HashSet<String>,
    /// Set by a window that could not write its edits. The install is called off.
    failed: Option<String>,
}

pub struct UpdateState {
    mode: Mode,
    reason: Option<Reason>,
    current_version: String,
    bucket: u8,
    inner: Mutex<Inner>,
    flush: Arc<(Mutex<Option<Flush>>, Condvar)>,
    flush_nonce: AtomicU64,
}

impl UpdateState {
    fn snapshot(&self) -> Snapshot {
        let inner = self.inner.lock().unwrap();
        Snapshot {
            mode: self.mode,
            reason: self.reason,
            current_version: self.current_version.clone(),
            phase: inner.phase.clone(),
            checked_at: inner.checked_at,
        }
    }

    /// Starts a check, or returns `None` when a download or an install is under
    /// way, which already answers the question.
    fn begin_check(&self) -> Option<u64> {
        let mut inner = self.inner.lock().unwrap();
        if matches!(inner.phase, Phase::Downloading { .. } | Phase::Installing { .. }) {
            return None;
        }
        inner.generation += 1;
        // A ready update stays on screen while the server is asked again.
        if !matches!(inner.phase, Phase::Ready { .. }) {
            inner.phase = Phase::Checking;
        }
        Some(inner.generation)
    }
}

/// Works out the mode once, at startup. Call from `setup`.
pub fn register<R: Runtime>(app: &AppHandle<R>) {
    let (mode, reason) = detect(app);
    let bucket = if mode == Mode::Off { 0 } else { rollout_bucket(app) };
    #[cfg(windows)]
    if mode == Mode::Install {
        let product = app.package_info().name.clone();
        thread::spawn(move || remove_spent_installers(&product));
    }
    app.manage(UpdateState {
        mode,
        reason,
        current_version: app.package_info().version.to_string(),
        bucket,
        inner: Mutex::new(Inner {
            phase: Phase::Idle,
            checked_at: None,
            generation: 0,
            pending: None,
            bytes: None,
        }),
        flush: Arc::new((Mutex::new(None), Condvar::new())),
        flush_nonce: AtomicU64::new(1),
    });
}

/// Whether the Help menu offers "Check for updates". The store builds and the
/// builds without an update server never do.
pub fn offers_check<R: Runtime>(app: &AppHandle<R>) -> bool {
    detect(app).0 != Mode::Off
}

/// Help > Check for updates was picked. The page runs it.
pub fn request_check<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_to("main", CHECK_REQUEST_EVENT, ());
}

fn detect<R: Runtime>(app: &AppHandle<R>) -> (Mode, Option<Reason>) {
    if !configured(app) {
        return (Mode::Off, Some(Reason::Unconfigured));
    }
    if crate::claude_code::sandboxed() {
        return (Mode::Off, Some(Reason::AppStore));
    }
    #[cfg(windows)]
    if msix_package() {
        return (Mode::Off, Some(Reason::MicrosoftStore));
    }
    if cfg!(debug_assertions) {
        return (Mode::Notify, Some(Reason::Development));
    }
    // The bundler marks the binary it puts in each installer. The bare exe in
    // the portable zip has no mark. macOS reports the app bundle either way.
    match tauri::utils::platform::bundle_type() {
        Some(_) => (Mode::Install, None),
        None => (Mode::Notify, Some(Reason::Portable)),
    }
}

/// CI fills in both the key and the endpoint, or neither.
fn configured<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(config) = app.config().plugins.0.get("updater") else {
        return false;
    };
    let has_key = config
        .get("pubkey")
        .and_then(Value::as_str)
        .is_some_and(|key| !key.trim().is_empty());
    has_key && endpoint_template(app).is_some()
}

fn endpoint_template<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")?
        .get("endpoints")?
        .as_array()?
        .first()?
        .as_str()
        .map(str::to_owned)
}

/// The configured endpoint with this check's channel and rollout bucket added.
/// The `{{target}}`-style placeholders are left for the plugin to fill in.
fn endpoint_url(template: &str, channel: Channel, bucket: u8) -> Option<Url> {
    let mut url = Url::parse(template).ok()?;
    url.query_pairs_mut()
        .append_pair("channel", channel.as_str())
        .append_pair("bucket", &bucket.to_string());
    Some(url)
}

/// An MSIX install runs with a package identity; nothing else does.
#[cfg(windows)]
fn msix_package() -> bool {
    use windows::Win32::Foundation::APPMODEL_ERROR_NO_PACKAGE;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;

    let mut length = 0u32;
    // Asked with no buffer, a packaged process answers that the buffer is too
    // small, and an unpackaged one that it has no package.
    let answer = unsafe { GetCurrentPackageFullName(&mut length, None) };
    answer != APPMODEL_ERROR_NO_PACKAGE
}

/// Whether a folder in the temp dir is one the updater plugin left behind on
/// Windows: `<product name>-<version>-updater-<random>`, holding the installer
/// it ran.
fn is_spent_installer_folder(folder: &str, product: &str) -> bool {
    folder
        .strip_prefix(product)
        .and_then(|rest| rest.strip_prefix('-'))
        .is_some_and(|rest| rest.contains("-updater-"))
}

/// The plugin runs a Windows update from an installer it writes to a folder of
/// its own in %TEMP%, and the installer has to outlive the app it replaces, so
/// nothing removes it at the time: every update would leave the whole
/// installer behind. The next start removes those folders. One still in use,
/// by an installer finishing as the new version opens, is skipped and goes the
/// time after.
#[cfg(windows)]
fn remove_spent_installers(product: &str) {
    let Ok(entries) = fs::read_dir(std::env::temp_dir()) else {
        return;
    };
    for entry in entries.flatten() {
        let spent = is_spent_installer_folder(&entry.file_name().to_string_lossy(), product);
        if spent && entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[derive(Serialize, Deserialize)]
struct StoredBucket {
    bucket: u8,
}

/// A number from 0 to 99, drawn once per install and kept, so a staged rollout
/// reaches the same installs as it widens. It identifies nobody: every install
/// shares one of a hundred values.
fn rollout_bucket<R: Runtime>(app: &AppHandle<R>) -> u8 {
    let path = app.path().app_config_dir().ok().map(|dir| dir.join(BUCKET_FILE));
    let stored = path
        .as_ref()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<StoredBucket>(&text).ok())
        .map(|stored| stored.bucket)
        .filter(|bucket| *bucket < 100);
    if let Some(bucket) = stored {
        return bucket;
    }
    let bucket = fresh_bucket();
    if let Some(path) = path {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string(&StoredBucket { bucket }) {
            let _ = fs::write(path, json);
        }
    }
    bucket
}

fn fresh_bucket() -> u8 {
    // RandomState takes its keys from the operating system's random source,
    // which is all a rollout bucket needs.
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos()),
    );
    (hasher.finish() % 100) as u8
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
}

fn require_main<R: Runtime>(window: &tauri::Window<R>) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("only the editor window can manage updates".into())
    }
}

/// Sends the current state to the page and returns it.
fn publish<R: Runtime>(app: &AppHandle<R>) -> Snapshot {
    let snapshot = app.state::<UpdateState>().snapshot();
    let _ = app.emit_to("main", STATE_EVENT, &snapshot);
    snapshot
}

/// The Claude Code and Codex processes are children of this one. A normal quit
/// stops them from the run loop's Exit event, which an update skips: on Windows
/// the plugin ends the process itself, and elsewhere the app restarts.
fn stop_agents<R: Runtime>(app: &AppHandle<R>) {
    crate::claude_code::kill_all(app);
    crate::codex::kill_all(app);
}

#[tauri::command]
pub fn abs_update_state<R: Runtime>(app: AppHandle<R>) -> Snapshot {
    app.state::<UpdateState>().snapshot()
}

/// Asks the server whether there is a newer version on `channel` ("stable" or
/// "beta"). An installer build starts downloading what it finds right away.
#[tauri::command]
pub async fn abs_update_check<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    channel: String,
) -> Result<Snapshot, String> {
    require_main(&window)?;
    let channel = Channel::parse(&channel)?;
    let state = app.state::<UpdateState>();
    if state.mode == Mode::Off {
        return Ok(state.snapshot());
    }
    let Some(generation) = state.begin_check() else {
        return Ok(state.snapshot());
    };
    publish(&app);
    let outcome = check(&app, channel, state.bucket).await;
    finish_check(&app, generation, outcome);
    Ok(publish(&app))
}

async fn check<R: Runtime>(
    app: &AppHandle<R>,
    channel: Channel,
    bucket: u8,
) -> Result<Option<Update>, String> {
    let endpoint = endpoint_template(app)
        .and_then(|template| endpoint_url(&template, channel, bucket))
        .ok_or_else(|| "this build has no update server".to_string())?;
    let handle = app.clone();
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .timeout(CHECK_TIMEOUT)
        // Windows only: the plugin calls this right before it ends the process
        // to let the installer run. It replaces the plugin's own hook, which
        // did the cleanup on the last line.
        .on_before_exit(move || {
            stop_agents(&handle);
            handle.cleanup_before_exit();
        })
        .build()
        .map_err(|error| error.to_string())?;
    updater.check().await.map_err(|error| error.to_string())
}

fn finish_check<R: Runtime>(app: &AppHandle<R>, generation: u64, outcome: Result<Option<Update>, String>) {
    let state = app.state::<UpdateState>();
    let mut inner = state.inner.lock().unwrap();
    if inner.generation != generation {
        return;
    }
    match outcome {
        Err(message) => {
            eprintln!("[updates] check failed: {message}");
            // An update already downloaded stays ready: a failed check says
            // nothing about it.
            if !matches!(inner.phase, Phase::Ready { .. }) {
                inner.phase = Phase::Failed { step: Step::Check, message };
            }
        }
        Ok(None) => {
            // The server is the authority. If it stopped offering a downloaded
            // update (the rollout was paused or narrowed), that update is dropped.
            inner.checked_at = Some(now_ms());
            inner.phase = Phase::UpToDate;
            inner.pending = None;
            inner.bytes = None;
        }
        Ok(Some(update)) => {
            inner.checked_at = Some(now_ms());
            let info = UpdateInfo::from_update(&update);
            if let Phase::Ready { update: ready } = &inner.phase {
                if ready.version == info.version {
                    return;
                }
            }
            match state.mode {
                Mode::Install => {
                    inner.phase = Phase::Downloading { total: info.size, update: info, received: 0 };
                    inner.pending = Some(Arc::new(update));
                    inner.bytes = None;
                    drop(inner);
                    start_download(app.clone(), generation);
                }
                Mode::Notify => {
                    inner.phase = Phase::Available { update: info };
                    inner.pending = None;
                    inner.bytes = None;
                }
                Mode::Off => {}
            }
        }
    }
}

fn start_download<R: Runtime>(app: AppHandle<R>, generation: u64) {
    let Some(update) = app.state::<UpdateState>().inner.lock().unwrap().pending.clone() else {
        return;
    };
    let last_progress = Arc::new(Mutex::new(Instant::now()));
    let done = Arc::new(AtomicBool::new(false));

    let task = {
        let app = app.clone();
        let last_progress = last_progress.clone();
        let done = done.clone();
        tauri::async_runtime::spawn(async move {
            let mut received: u64 = 0;
            let mut last_sent: Option<Instant> = None;
            let result = update
                .download(
                    |chunk, total| {
                        received += chunk as u64;
                        *last_progress.lock().unwrap() = Instant::now();
                        if last_sent.map_or(true, |sent| sent.elapsed() >= PROGRESS_INTERVAL) {
                            last_sent = Some(Instant::now());
                            set_progress(&app, generation, received, total);
                        }
                    },
                    || {},
                )
                .await;
            done.store(true, Ordering::SeqCst);
            finish_download(&app, generation, result.map_err(|error| error.to_string()));
        })
    };

    // A connection can go quiet without failing, and the download has no
    // overall timeout because a slow line is not a broken one. A download that
    // receives nothing for STALL_LIMIT is stopped; the next check starts over.
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        if done.load(Ordering::SeqCst) {
            break;
        }
        if last_progress.lock().unwrap().elapsed() >= STALL_LIMIT {
            task.abort();
            finish_download(&app, generation, Err("the download stopped receiving data".into()));
            break;
        }
    });
}

fn set_progress<R: Runtime>(app: &AppHandle<R>, generation: u64, received_now: u64, total_now: Option<u64>) {
    {
        let state = app.state::<UpdateState>();
        let mut inner = state.inner.lock().unwrap();
        if inner.generation != generation {
            return;
        }
        let Phase::Downloading { received, total, .. } = &mut inner.phase else {
            return;
        };
        *received = received_now;
        if total_now.is_some() {
            *total = total_now;
        }
    }
    publish(app);
}

fn finish_download<R: Runtime>(app: &AppHandle<R>, generation: u64, result: Result<Vec<u8>, String>) {
    {
        let state = app.state::<UpdateState>();
        let mut inner = state.inner.lock().unwrap();
        if inner.generation != generation {
            return;
        }
        let Phase::Downloading { update, .. } = &inner.phase else {
            return;
        };
        let update = update.clone();
        match result {
            // The plugin has already checked the signature against the key in
            // this build; a payload it did not sign never gets here.
            Ok(bytes) => {
                inner.bytes = Some(Arc::new(bytes));
                inner.phase = Phase::Ready { update };
            }
            Err(message) => {
                eprintln!("[updates] download of {} failed: {message}", update.version);
                inner.pending = None;
                inner.bytes = None;
                inner.phase = Phase::Failed { step: Step::Download, message };
            }
        }
    }
    publish(app);
}

/// Installs the downloaded update and restarts into it.
///
/// Every editor window is asked to write its unsaved edits first, because the
/// process ends without the window close hooks that normally do that, and a
/// window that cannot write them calls the install off. On Windows the plugin
/// hands over to the installer, which relaunches the app; on macOS and Linux
/// the new version is in place when `install` returns, and the app restarts
/// itself. A failed install leaves the update ready to try again and rejects
/// with the reason.
#[tauri::command]
pub async fn abs_update_install<R: Runtime>(app: AppHandle<R>, window: tauri::Window<R>) -> Result<(), String> {
    require_main(&window)?;
    let (update, bytes, info) = {
        let state = app.state::<UpdateState>();
        let mut inner = state.inner.lock().unwrap();
        let Phase::Ready { update: info } = &inner.phase else {
            return Err("there is no update ready to install".into());
        };
        let info = info.clone();
        let (Some(update), Some(bytes)) = (inner.pending.clone(), inner.bytes.clone()) else {
            return Err("there is no update ready to install".into());
        };
        inner.phase = Phase::Installing { update: info.clone() };
        (update, bytes, info)
    };
    publish(&app);

    let installed = match flush_editor_windows(&app).await {
        Ok(()) => tauri::async_runtime::spawn_blocking(move || update.install(bytes.as_slice()))
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result.map_err(|error| error.to_string())),
        Err(message) => Err(message),
    };

    match installed {
        Ok(()) => {
            stop_agents(&app);
            app.restart()
        }
        Err(message) => {
            eprintln!("[updates] install of {} did not happen: {message}", info.version);
            {
                let state = app.state::<UpdateState>();
                let mut inner = state.inner.lock().unwrap();
                if matches!(inner.phase, Phase::Installing { .. }) {
                    inner.phase = Phase::Ready { update: info };
                }
            }
            publish(&app);
            Err(message)
        }
    }
}

/// Asks every editor window to write its edits and waits until each one has
/// answered, or FLUSH_WAIT runs out. A window that has not answered by then is
/// taken to have nothing to write (it may still be loading); one that answers
/// that it could not write fails the whole thing.
async fn flush_editor_windows<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<UpdateState>();
    let labels: Vec<String> = app
        .webview_windows()
        .into_keys()
        .filter(|label| crate::settings::is_editor_window(label))
        .collect();
    if labels.is_empty() {
        return Ok(());
    }
    let nonce = state.flush_nonce.fetch_add(1, Ordering::SeqCst);
    *state.flush.0.lock().unwrap() = Some(Flush {
        nonce,
        waiting: labels.iter().cloned().collect(),
        failed: None,
    });
    for label in &labels {
        let _ = app.emit_to(label.as_str(), FLUSH_EVENT, nonce);
    }
    let flush = state.flush.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let (lock, answered) = &*flush;
        let guard = lock.lock().unwrap();
        let _ = answered.wait_timeout_while(guard, FLUSH_WAIT, |pending| {
            pending
                .as_ref()
                .is_some_and(|flush| flush.failed.is_none() && !flush.waiting.is_empty())
        });
    })
    .await;
    let finished = state.flush.0.lock().unwrap().take();
    match finished.and_then(|flush| flush.failed) {
        // The page reads the prefix (lib/updates/store.ts) to say why nothing happened.
        Some(label) => Err(format!("{EDITS_NOT_SAVED}: the {label} window could not save its edits")),
        None => Ok(()),
    }
}

/// An editor window answered the install numbered `nonce`: `ok` is whether it
/// wrote its edits.
#[tauri::command]
pub fn abs_update_flushed<R: Runtime>(app: AppHandle<R>, window: tauri::Window<R>, nonce: u64, ok: bool) {
    let state = app.state::<UpdateState>();
    let (lock, answered) = &*state.flush;
    let mut pending = lock.lock().unwrap();
    if let Some(flush) = pending.as_mut().filter(|flush| flush.nonce == nonce) {
        flush.waiting.remove(window.label());
        if !ok {
            flush.failed.get_or_insert_with(|| window.label().to_string());
        }
        answered.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TEMPLATE: &str =
        "https://updates.example.com/v1/desktop/{{target}}/{{arch}}/{{bundle_type}}/{{current_version}}";

    #[test]
    fn the_endpoint_keeps_its_placeholders_and_gains_channel_and_bucket() {
        let url = endpoint_url(TEMPLATE, Channel::Beta, 7).unwrap();
        let text = url.to_string();
        // The url crate encodes the braces in the path; the plugin replaces
        // both spellings.
        assert!(text.contains("%7B%7Btarget%7D%7D"), "{text}");
        assert!(text.contains("%7B%7Bcurrent_version%7D%7D"), "{text}");
        assert!(text.ends_with("?channel=beta&bucket=7"), "{text}");
    }

    #[test]
    fn an_endpoint_that_does_not_parse_is_no_endpoint() {
        assert!(endpoint_url("not a url", Channel::Stable, 1).is_none());
    }

    #[test]
    fn only_the_two_channels_are_accepted() {
        assert_eq!(Channel::parse("stable"), Ok(Channel::Stable));
        assert_eq!(Channel::parse("beta"), Ok(Channel::Beta));
        assert!(Channel::parse("nightly").is_err());
    }

    #[test]
    fn update_info_reads_our_extra_fields_from_the_answer() {
        let raw = json!({
            "version": "1.0.8",
            "pub_date": "2026-11-07T10:00:00.000Z",
            "critical": true,
            "download_page": "https://github.com/dotnetdreamer/open-screenshot-generator/releases/tag/v1.0.8",
            "size": 1234
        });
        let info = UpdateInfo::from_parts("1.0.8", "1.0.7", Some("  Fixes export.  "), &raw);
        assert_eq!(info.notes.as_deref(), Some("Fixes export."));
        assert_eq!(info.date.as_deref(), Some("2026-11-07T10:00:00.000Z"));
        assert!(info.critical);
        assert_eq!(info.size, Some(1234));
        assert!(info.download_page.unwrap().starts_with("https://github.com/"));
    }

    #[test]
    fn a_download_page_that_is_not_https_is_dropped() {
        let raw = json!({ "download_page": "file:///etc/passwd" });
        let info = UpdateInfo::from_parts("1.0.8", "1.0.7", Some("   "), &raw);
        assert_eq!(info.download_page, None);
        assert_eq!(info.notes, None);
        assert!(!info.critical);
    }

    #[test]
    fn a_phase_serializes_the_way_the_page_reads_it() {
        let info = UpdateInfo::from_parts("1.0.8", "1.0.7", None, &json!({}));
        let phase = Phase::Downloading { update: info, received: 10, total: Some(20) };
        let value = serde_json::to_value(&phase).unwrap();
        assert_eq!(value["phase"], "downloading");
        assert_eq!(value["received"], 10);
        assert_eq!(value["total"], 20);
        assert_eq!(value["update"]["currentVersion"], "1.0.7");
        assert_eq!(serde_json::to_value(Phase::UpToDate).unwrap(), json!({ "phase": "upToDate" }));
        let failed = Phase::Failed { step: Step::Download, message: "x".into() };
        assert_eq!(serde_json::to_value(failed).unwrap()["step"], "download");
    }

    #[test]
    fn only_the_folders_the_updater_left_are_spent() {
        let product = "Open Screenshot Generator";
        assert!(is_spent_installer_folder("Open Screenshot Generator-1.0.7-updater-vHuHuM", product));
        assert!(is_spent_installer_folder("Open Screenshot Generator-2.0.0-beta.1-updater-a1B2c3", product));
        assert!(!is_spent_installer_folder("Open Screenshot Generator-cache", product));
        assert!(!is_spent_installer_folder("Open Screenshot Generator", product));
        assert!(!is_spent_installer_folder("Open Screenshot Generator Beta-1.0.7-updater-x", product));
        assert!(!is_spent_installer_folder("Another App-1.0.7-updater-x", product));
    }

    #[test]
    fn a_fresh_bucket_is_below_a_hundred() {
        for _ in 0..200 {
            assert!(fresh_bucket() < 100);
        }
    }
}
