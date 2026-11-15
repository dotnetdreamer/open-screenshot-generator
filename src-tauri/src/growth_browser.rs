//! The browser inside Growth's Ask AI screen.
//!
//! Setting up Growth means visiting App Store Connect, Google Cloud and Play
//! Console: making an API key, reading the vendor number, inviting a service
//! account. The Ask AI assistant does that legwork in a browser drawn inside
//! the editor window, beside its conversation, while the user signs in and
//! approves anything that changes their account.
//!
//! On macOS and Windows the browser is a child webview of the editor window
//! (`Window::add_child`, which needs Tauri's `unstable` feature), placed over
//! a box the page lays out. Linux packs a window's webviews into a GTK box
//! instead of placing them, so there the browser gets a window of its own.
//!
//! The page in the browser is a third-party site and can call no command: no
//! capability names it, and Tauri refuses every app and plugin command from a
//! remote origin that no capability covers. One door stays open in Tauri 2:
//! any webview may fetch a queued Channel message by its number
//! (`plugin:__TAURI_CHANNEL__|fetch` skips the ACL), and Channel messages
//! over 8 KB wait in a queue every webview shares. So the app sends nothing
//! over a `tauri::ipc::Channel` (a test below checks); command replies and
//! events reach the editor directly, never through that queue.
//!
//! Everything else goes the other way. The editor asks Rust to run one of the driver's commands
//! (growth-browser/driver.js, built from src/lib/growth/setup/driver.ts),
//! Rust runs it with `eval_with_callback` and hands the answer back. Rust
//! itself reports page loads, titles, blocked navigations and key files, to
//! the window that opened the browser and to no other.
//!
//! A key file the console downloads (Apple's AuthKey_XXXXXXXXXX.p8, Google's
//! service account JSON) is written to the app's cache, read, checked, sent to
//! that window and deleted. Any other download is refused.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Runtime, Url, WebviewUrl};

/// The browser's webview. One at a time, in the window that opened it.
pub const LABEL: &str = "growth-browser";

/// What Rust tells the window that opened the browser. Must match
/// GROWTH_BROWSER_EVENT in src/lib/growth/setup/browser.ts.
const EVENT: &str = "abs-growth-browser";

/// The driver, bundled by `npm run build:growth-browser` (which
/// `build:assistant-agent` runs too).
const DRIVER_JS: &str = include_str!("../growth-browser/driver.js");

/// Where the assistant may send the browser. Sign-in pages are reached from
/// these, and FRAME_DOMAINS lets them load.
const OPEN_HOSTS: &[&str] = &[
    "appstoreconnect.apple.com",
    "developer.apple.com",
    "console.cloud.google.com",
    "play.google.com",
    "support.google.com",
    "developers.google.com",
];

/// What a page, or a frame inside one, may load: Apple's and Google's own
/// sites, where the consoles, their sign-in pages and their widgets live.
/// wry asks about every frame, not only the page, so this is wider than
/// OPEN_HOSTS: Google's sign-in passes through youtube.com, and its consoles
/// draw frames from googleapis.com and gstatic.com.
const FRAME_DOMAINS: &[&str] = &[
    "apple.com",
    "google.com",
    "googleapis.com",
    "gstatic.com",
    "googleusercontent.com",
    "youtube.com",
    "recaptcha.net",
];

/// Safari's own words for the engine the macOS browser runs. Google's sign-in
/// turns away a WKWebView that does not name Safari, saying the browser may
/// not be secure. It is the same WebKit Safari runs.
#[cfg(target_os = "macos")]
const SAFARI_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

/// The largest command the page may send, and the largest answer passed back.
const MAX_COMMAND: usize = 8 * 1024;
const MAX_ANSWER: usize = 512 * 1024;

/// How long a driver command may take. The driver answers at once; this only
/// covers a page that is busy or between documents.
const RUN_TIMEOUT: Duration = Duration::from_secs(10);

/// The largest key file read. A .p8 is about 250 bytes, a service account
/// JSON about 2.4 KB.
const MAX_KEY_FILE: u64 = 64 * 1024;

#[derive(Default)]
pub struct GrowthBrowserState {
    /// The editor window the browser belongs to. Its events go there, and
    /// only that window may drive it.
    owner: Mutex<Option<String>>,
    /// Downloads under way.
    downloads: Mutex<Downloads>,
    /// Hosts outside FRAME_DOMAINS the user let the browser open, such as a
    /// company's own sign-in page. Forgotten when the browser closes.
    allowed: Mutex<HashSet<String>>,
    /// The last blocked host and when, so a page that keeps trying is
    /// reported once.
    last_blocked: Mutex<Option<(String, Instant)>>,
    /// The last site opened in the system browser, so a page cannot open a
    /// stream of them.
    last_external: Mutex<Option<Instant>>,
    next_file: AtomicU64,
}

struct PendingDownload {
    path: PathBuf,
    name: String,
}

/// How long after turning a download away its failure may still come in.
const TURNED_AWAY_WINDOW: Duration = Duration::from_secs(10);

/// Downloads under way: where each is written and what the site called it.
///
/// macOS reports a finished download by its address alone, never by where it
/// went, so two downloads from one address at once could not be told apart
/// (a double click on Download does that). One download per address runs at
/// a time and a second is turned away while the first runs. WebKit reports a
/// turned-away download as failed, by the same address, so that failure is
/// matched to the turning away and the download still running is left alone.
#[derive(Default)]
struct Downloads {
    pending: HashMap<String, PendingDownload>,
    turned_away: HashMap<String, Vec<Instant>>,
}

impl Downloads {
    /// Whether a download from `url` to `path` may start.
    fn start(&mut self, url: &str, path: PathBuf, name: String) -> bool {
        if self.pending.contains_key(url) {
            self.turned_away.entry(url.to_string()).or_default().push(Instant::now());
            return false;
        }
        self.pending.insert(url.to_string(), PendingDownload { path, name });
        true
    }

    /// The download a finish report is about, or None when it is not one of
    /// ours: one turned away, or one Windows and Linux name another file for.
    fn finish(&mut self, url: &str, path: Option<&Path>, success: bool) -> Option<PendingDownload> {
        if let Some(path) = path {
            return match self.pending.get(url) {
                Some(download) if download.path == path => self.pending.remove(url),
                _ => None,
            };
        }
        if !success {
            if let Some(times) = self.turned_away.get_mut(url) {
                times.retain(|at| at.elapsed() < TURNED_AWAY_WINDOW);
                let ours = times.pop().is_some();
                if times.is_empty() {
                    self.turned_away.remove(url);
                }
                if ours {
                    return None;
                }
            }
        }
        self.pending.remove(url)
    }

    fn paths(&self) -> HashSet<PathBuf> {
        self.pending.values().map(|download| download.path.clone()).collect()
    }

    fn clear(&mut self) {
        self.pending.clear();
        self.turned_away.clear();
    }
}

/// Delete every file in `dir` that no download under way is writing, so no
/// key file stays in the cache after its download ends, whatever order the
/// engine reported things in.
fn sweep(dir: &Path, keep: &HashSet<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() && !keep.contains(&path) {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// A box in the editor window's page, in CSS pixels from its top left, and
/// the height of the page itself (`viewport`), which says where the page
/// starts inside its webview.
#[derive(Deserialize, Clone, Copy)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    #[serde(default)]
    viewport: f64,
}

impl Bounds {
    fn checked(self) -> Result<Self, String> {
        let finite = [self.x, self.y, self.width, self.height, self.viewport].iter().all(|v| v.is_finite());
        if !finite || self.width < 0.0 || self.height < 0.0 || self.width > 20_000.0 || self.height > 20_000.0 {
            return Err("That is not a place in the window".into());
        }
        Ok(Self {
            x: self.x.max(0.0),
            y: self.y.max(0.0),
            width: self.width.max(1.0),
            height: self.height.max(1.0),
            viewport: self.viewport.max(0.0),
        })
    }

    /// The box in the window, where a child webview is placed. On macOS the
    /// title bar lies over the top of the page's webview and WebKit starts
    /// the page below it (32 points, measured November 2026), while a child
    /// webview is placed from the webview's own top. The gap is the webview's
    /// height less the page's; elsewhere, and in full screen, it is zero.
    fn in_window<R: Runtime>(self, page: &tauri::Webview<R>) -> Self {
        let scale = page.window().scale_factor().unwrap_or(1.0);
        let origin = page.position().map(|p| p.to_logical::<f64>(scale)).map(|p| (p.x, p.y)).unwrap_or((0.0, 0.0));
        let inset = page
            .size()
            .map(|size| size.to_logical::<f64>(scale).height - self.viewport)
            .ok()
            .filter(|gap| self.viewport > 0.0 && *gap > 0.5 && *gap < 200.0)
            .unwrap_or(0.0);
        Self { x: self.x + origin.0, y: self.y + origin.1 + inset, ..self }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    /// Drawn inside the editor window. False on Linux, where it has a window of its own.
    embedded: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    open: bool,
    /// This window opened it.
    mine: bool,
    url: Option<String>,
}

fn host_of(url: &Url) -> String {
    url.host_str().unwrap_or("").trim_end_matches('.').to_ascii_lowercase()
}

fn under(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// A debug build may also open pages on 127.0.0.1, for testing the browser
/// with a page of our own. Never `localhost`: the dev server is there, and
/// Tauri treats its origin as the app's own.
fn local_test_page(url: &Url) -> bool {
    cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
}

/// Whether the assistant, or the address the page asked for, may open `url`.
pub(crate) fn may_open(url: &Url) -> bool {
    if local_test_page(url) {
        return true;
    }
    url.scheme() == "https" && url.port().is_none() && OPEN_HOSTS.contains(&host_of(url).as_str())
}

/// Whether the page, or one of its frames, may load `url`.
fn may_load(url: &Url, allowed: &HashSet<String>) -> bool {
    match url.scheme() {
        // Frames a page draws itself, and the key file a page hands over as a blob.
        "about" | "blob" | "data" => true,
        "https" => {
            let host = host_of(url);
            FRAME_DOMAINS.iter().any(|domain| under(&host, domain)) || allowed.contains(&host)
        }
        _ => local_test_page(url),
    }
}

fn guard<R: Runtime>(window: &tauri::Window<R>, webview: &tauri::Webview<R>) -> Result<(), String> {
    // The window's own page, never a webview inside it: the browser lives in
    // the editor window too.
    if crate::settings::is_editor_window(window.label()) && webview.label() == window.label() {
        Ok(())
    } else {
        Err("Only the editor window can use the Growth browser".into())
    }
}

fn owner_guard<R: Runtime>(
    app: &AppHandle<R>,
    window: &tauri::Window<R>,
    webview: &tauri::Webview<R>,
) -> Result<tauri::Webview<R>, String> {
    guard(window, webview)?;
    let state = app.state::<GrowthBrowserState>();
    let owner = state.owner.lock().unwrap().clone();
    if owner.as_deref() != Some(window.label()) {
        return Err("The Growth browser is not open in this window".into());
    }
    app.get_webview(LABEL).ok_or_else(|| "The Growth browser is closed".to_string())
}

fn send<R: Runtime>(app: &AppHandle<R>, payload: Value) {
    let owner = app.state::<GrowthBrowserState>().owner.lock().unwrap().clone();
    if let Some(owner) = owner {
        let _ = app.emit_to(owner.as_str(), EVENT, payload);
    }
}

/// A navigation the browser turned down, reported once per host a minute.
fn report_blocked<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    let host = host_of(url);
    let state = app.state::<GrowthBrowserState>();
    {
        let mut last = state.last_blocked.lock().unwrap();
        if let Some((seen, at)) = &*last {
            if *seen == host && at.elapsed() < Duration::from_secs(60) {
                return;
            }
        }
        *last = Some((host.clone(), Instant::now()));
    }
    send(app, json!({ "type": "blocked", "url": url.as_str(), "host": host }));
}

/// A page's request for a new window. An address the browser may open loads
/// in place; another https site goes to the system browser, one every two
/// seconds at most.
fn new_window<R: Runtime>(app: &AppHandle<R>, url: Url) {
    let allowed = app.state::<GrowthBrowserState>().allowed.lock().unwrap().clone();
    if may_open(&url) || (url.scheme() == "https" && may_load(&url, &allowed)) {
        if let Some(webview) = app.get_webview(LABEL) {
            let _ = webview.navigate(url);
        }
        return;
    }
    if url.scheme() != "https" {
        return;
    }
    let state = app.state::<GrowthBrowserState>();
    let mut last = state.last_external.lock().unwrap();
    if last.is_some_and(|at| at.elapsed() < Duration::from_secs(2)) {
        return;
    }
    *last = Some(Instant::now());
    drop(last);
    use tauri_plugin_opener::OpenerExt;
    let _ = app.opener().open_url(url.as_str(), None::<&str>);
    send(app, json!({ "type": "external", "url": url.as_str() }));
}

fn file_extension(name: &str) -> String {
    name.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).unwrap_or_default()
}

/// What a finished download holds, if it is a key Growth takes.
pub(crate) fn classify_key_file(name: &str, text: &str) -> Result<&'static str, &'static str> {
    match file_extension(name).as_str() {
        "p8" => {
            let trimmed = text.trim();
            if trimmed.starts_with("-----BEGIN PRIVATE KEY-----") && trimmed.ends_with("-----END PRIVATE KEY-----") {
                Ok("apple-key")
            } else {
                Err("The .p8 file holds no private key")
            }
        }
        "json" => {
            let value: Value = serde_json::from_str(text).map_err(|_| "The JSON file could not be read")?;
            let field = |key: &str| value.get(key).and_then(Value::as_str).filter(|v| !v.is_empty());
            if field("type") == Some("service_account") && field("private_key").is_some() && field("client_email").is_some() {
                Ok("play-key")
            } else {
                Err("The JSON file is not a service account key")
            }
        }
        _ => Err("Only key files are downloaded here"),
    }
}

fn download_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("growth-browser");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn on_download<R: Runtime>(app: &AppHandle<R>, event: DownloadEvent<'_>) -> bool {
    let state = app.state::<GrowthBrowserState>();
    match event {
        DownloadEvent::Requested { url, destination } => {
            let name = destination.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            let ext = file_extension(&name);
            if ext != "p8" && ext != "json" {
                send(app, json!({ "type": "download-refused", "fileName": name, "reason": "Only key files are downloaded here" }));
                return false;
            }
            let Ok(dir) = download_dir(app) else {
                send(app, json!({ "type": "download-refused", "fileName": name, "reason": "The key file could not be saved" }));
                return false;
            };
            let serial = state.next_file.fetch_add(1, Ordering::SeqCst);
            let path = dir.join(format!("{}-{serial}.{ext}", std::process::id()));
            if !state.downloads.lock().unwrap().start(url.as_str(), path.clone(), name.clone()) {
                send(app, json!({ "type": "download-refused", "fileName": name, "reason": "That key file is downloading already" }));
                return false;
            }
            *destination = path;
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let finished = state.downloads.lock().unwrap().finish(url.as_str(), path.as_deref(), success);
            let Some(download) = finished else {
                return true;
            };
            let read = if success {
                std::fs::metadata(&download.path)
                    .ok()
                    .filter(|meta| meta.len() <= MAX_KEY_FILE)
                    .and_then(|_| std::fs::read_to_string(&download.path).ok())
            } else {
                None
            };
            let _ = std::fs::remove_file(&download.path);
            if let Some(dir) = download.path.parent() {
                let keep = state.downloads.lock().unwrap().paths();
                sweep(dir, &keep);
            }
            match read.as_deref().map(|text| (text, classify_key_file(&download.name, text))) {
                Some((text, Ok(kind))) => send(
                    app,
                    json!({ "type": "key-file", "kind": kind, "fileName": download.name, "content": text }),
                ),
                Some((_, Err(reason))) => send(app, json!({ "type": "download-refused", "fileName": download.name, "reason": reason })),
                None => send(
                    app,
                    json!({ "type": "download-refused", "fileName": download.name, "reason": "The download did not finish" }),
                ),
            }
            true
        }
        _ => true,
    }
}

fn builder<R: Runtime>(app: &AppHandle<R>, url: Url) -> WebviewBuilder<R> {
    let on_navigation = app.clone();
    let on_window = app.clone();
    let on_load = app.clone();
    let on_title = app.clone();
    let on_file = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(url))
        .initialization_script(DRIVER_JS)
        .on_navigation(move |url| {
            let allowed = on_navigation.state::<GrowthBrowserState>().allowed.lock().unwrap().clone();
            if may_load(url, &allowed) {
                return true;
            }
            report_blocked(&on_navigation, url);
            false
        })
        .on_new_window(move |url, _features| {
            new_window(&on_window, url);
            NewWindowResponse::Deny
        })
        .on_page_load(move |_webview, payload| {
            let phase = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            send(&on_load, json!({ "type": "page", "phase": phase, "url": payload.url().as_str() }));
        })
        .on_document_title_changed(move |_webview, title| {
            send(&on_title, json!({ "type": "title", "title": title }));
        })
        .on_download(move |_webview, event| on_download(&on_file, event));
    #[cfg(target_os = "macos")]
    let builder = builder.user_agent(SAFARI_USER_AGENT);
    builder
}

fn place<R: Runtime>(webview: &tauri::Webview<R>, bounds: Bounds, visible: bool) -> Result<(), String> {
    if cfg!(target_os = "linux") {
        // A window of its own: shown or hidden with the screen, never placed.
        let window = webview.window();
        return if visible { window.show() } else { window.hide() }.map_err(|e| e.to_string());
    }
    webview.set_position(LogicalPosition::new(bounds.x, bounds.y)).map_err(|e| e.to_string())?;
    webview.set_size(LogicalSize::new(bounds.width, bounds.height)).map_err(|e| e.to_string())?;
    if visible { webview.show() } else { webview.hide() }.map_err(|e| e.to_string())
}

fn close_browser<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<GrowthBrowserState>();
    if let Some(webview) = app.get_webview(LABEL) {
        if cfg!(target_os = "linux") {
            let _ = webview.window().destroy();
        } else {
            let _ = webview.close();
        }
    }
    state.downloads.lock().unwrap().clear();
    state.allowed.lock().unwrap().clear();
    *state.owner.lock().unwrap() = None;
    if let Ok(dir) = app.path().app_cache_dir() {
        let _ = std::fs::remove_dir_all(dir.join("growth-browser"));
    }
}

/// Open `url` in the browser, placed over `bounds` of the calling window,
/// making the browser if there is none. A browser another window opened
/// moves here: the page that asks last is the one on screen.
///
/// Async, as every command here that makes a webview: a synchronous command
/// runs on the main thread, and `add_child` waits for the main thread.
#[tauri::command]
pub async fn abs_growth_browser_open<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    webview: tauri::Webview<R>,
    url: String,
    bounds: Bounds,
    visible: bool,
) -> Result<Opened, String> {
    guard(&window, &webview)?;
    let bounds = bounds.checked()?.in_window(&webview);
    let url: Url = url.parse().map_err(|_| "That is not a web address".to_string())?;
    if !may_open(&url) {
        return Err(format!("The Growth browser does not open {}", host_of(&url)));
    }
    let embedded = !cfg!(target_os = "linux");
    let state = app.state::<GrowthBrowserState>();
    let owner = state.owner.lock().unwrap().clone();
    if let Some(existing) = app.get_webview(LABEL) {
        if owner.as_deref() == Some(window.label()) {
            existing.navigate(url).map_err(|e| e.to_string())?;
            place(&existing, bounds, visible)?;
            return Ok(Opened { embedded });
        }
        close_browser(&app);
    }

    *state.owner.lock().unwrap() = Some(window.label().to_string());
    // A key file an earlier visit left, if the app stopped mid-download.
    if let Ok(dir) = app.path().app_cache_dir() {
        let _ = std::fs::remove_dir_all(dir.join("growth-browser"));
    }
    let made = if embedded {
        window.add_child(builder(&app, url), LogicalPosition::new(bounds.x, bounds.y), LogicalSize::new(bounds.width, bounds.height))
    } else {
        tauri::window::WindowBuilder::new(&app, format!("{LABEL}-window"))
            .title("Growth setup")
            .inner_size(1100.0, 820.0)
            .build()
            .and_then(|own| {
                let size = own.inner_size()?.to_logical::<f64>(own.scale_factor()?);
                own.add_child(builder(&app, url), LogicalPosition::new(0.0, 0.0), size)
            })
    };
    let child = match made {
        Ok(child) => child,
        Err(error) => {
            *state.owner.lock().unwrap() = None;
            return Err(error.to_string());
        }
    };
    if embedded && !visible {
        let _ = child.hide();
    }
    Ok(Opened { embedded })
}

/// Move, resize, show or hide the browser, as the box it sits in changes.
#[tauri::command]
pub async fn abs_growth_browser_place<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    webview: tauri::Webview<R>,
    bounds: Bounds,
    visible: bool,
) -> Result<(), String> {
    let browser = owner_guard(&app, &window, &webview)?;
    place(&browser, bounds.checked()?.in_window(&webview), visible)
}

/// Load another page the assistant may open.
#[tauri::command]
pub async fn abs_growth_browser_go<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    webview: tauri::Webview<R>,
    url: String,
) -> Result<(), String> {
    let browser = owner_guard(&app, &window, &webview)?;
    let url: Url = url.parse().map_err(|_| "That is not a web address".to_string())?;
    if !may_open(&url) {
        return Err(format!("The Growth browser does not open {}", host_of(&url)));
    }
    browser.navigate(url).map_err(|e| e.to_string())
}

/// Back, forward or reload, from the browser's own toolbar.
#[tauri::command]
pub async fn abs_growth_browser_nav<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    webview: tauri::Webview<R>,
    action: String,
) -> Result<(), String> {
    let browser = owner_guard(&app, &window, &webview)?;
    match action.as_str() {
        "back" => browser.eval("history.back()").map_err(|e| e.to_string()),
        "forward" => browser.eval("history.forward()").map_err(|e| e.to_string()),
        "reload" => browser.reload().map_err(|e| e.to_string()),
        _ => Err("The browser cannot do that".into()),
    }
}

/// Let the browser open one more host for the rest of this visit, after the
/// user said yes to a sign-in page on a site of its own.
#[tauri::command]
pub async fn abs_growth_browser_allow<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    webview: tauri::Webview<R>,
    url: String,
) -> Result<(), String> {
    let browser = owner_guard(&app, &window, &webview)?;
    let url: Url = url.parse().map_err(|_| "That is not a web address".to_string())?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err("Only secure sites can open here".into());
    }
    app.state::<GrowthBrowserState>().allowed.lock().unwrap().insert(host_of(&url));
    browser.navigate(url).map_err(|e| e.to_string())
}

/// The driver's answer to one command, as the JSON text it wrote. Empty when
/// the page is between documents and has no driver yet.
#[tauri::command]
pub async fn abs_growth_browser_run<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    webview: tauri::Webview<R>,
    command: String,
) -> Result<String, String> {
    let browser = owner_guard(&app, &window, &webview)?;
    if command.len() > MAX_COMMAND {
        return Err("That command is too long for the browser".into());
    }
    // Parsed and written again, so what reaches the page is a JSON object and
    // never a script.
    let parsed: Value = serde_json::from_str(&command).map_err(|_| "That command is not JSON".to_string())?;
    if !parsed.is_object() {
        return Err("That command is not JSON".into());
    }
    let command = serde_json::to_string(&parsed).map_err(|e| e.to_string())?;
    // The answer must be a string: WebKit hands Rust an object as a native
    // value, and one the JSON writer cannot take ends the app (wry unwraps
    // it). `typeof` is the one check a page cannot redefine.
    let script = format!(
        "(function(){{try{{var d=window.__osgGrowthDriver;var r=d?d.run({command}):'';return typeof r==='string'?r:''}}catch(e){{return '{{\"error\":\"The page did not answer\"}}'}}}})()"
    );
    let (tx, rx) = mpsc::channel::<String>();
    browser
        .eval_with_callback(script, move |answer| {
            let _ = tx.send(answer);
        })
        .map_err(|e| e.to_string())?;
    let answer = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(RUN_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "The page took too long to answer".to_string())?;
    // WebKit and WebView2 both pass the result back as JSON, so a string
    // arrives quoted.
    let text = match serde_json::from_str::<Value>(&answer) {
        Ok(Value::String(text)) => text,
        _ => String::new(),
    };
    if text.len() > MAX_ANSWER {
        return Err("The page answered with too much text".into());
    }
    Ok(text)
}

/// Close the browser. Its sign-ins stay, in the app's own browser profile.
#[tauri::command]
pub async fn abs_growth_browser_close<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    webview: tauri::Webview<R>,
) -> Result<(), String> {
    guard(&window, &webview)?;
    let owner = app.state::<GrowthBrowserState>().owner.lock().unwrap().clone();
    if owner.as_deref() == Some(window.label()) {
        close_browser(&app);
    }
    Ok(())
}

/// Whether the browser is open, and in this window. A page that loads again
/// finds out here whether a browser it no longer knows about is still open.
#[tauri::command]
pub async fn abs_growth_browser_info<R: Runtime>(
    app: AppHandle<R>,
    window: tauri::Window<R>,
    webview: tauri::Webview<R>,
) -> Result<BrowserInfo, String> {
    guard(&window, &webview)?;
    let owner = app.state::<GrowthBrowserState>().owner.lock().unwrap().clone();
    let browser = app.get_webview(LABEL);
    Ok(BrowserInfo {
        open: browser.is_some(),
        mine: browser.is_some() && owner.as_deref() == Some(window.label()),
        url: browser.and_then(|b| b.url().ok()).map(|url| url.to_string()),
    })
}

/// The app's page-load hook (lib.rs). A new page in the window that owns the
/// browser has lost the conversation that drove it, so the browser closes.
/// The browser's own loads are not this window's.
pub fn on_page_load<R: Runtime>(webview: &tauri::Webview<R>, started: bool) {
    if !started || webview.label() == LABEL {
        return;
    }
    let app = webview.app_handle();
    let owner = app.state::<GrowthBrowserState>().owner.lock().unwrap().clone();
    if owner.as_deref() == Some(webview.label()) {
        close_browser(app);
    }
}

/// The window that owned the browser closed. A child webview goes with its
/// window, so only the bookkeeping is left.
pub fn window_closed<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let state = app.state::<GrowthBrowserState>();
    let owner = state.owner.lock().unwrap().clone();
    let own_window = format!("{LABEL}-window");
    if owner.as_deref() == Some(label) || label == own_window {
        close_browser(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        text.parse().unwrap()
    }

    #[test]
    fn opens_the_consoles_only() {
        assert!(may_open(&url("https://appstoreconnect.apple.com/access/integrations/api")));
        assert!(may_open(&url("https://console.cloud.google.com/iam-admin/serviceaccounts")));
        assert!(may_open(&url("https://play.google.com/console/u/0/developers")));
        assert!(!may_open(&url("http://appstoreconnect.apple.com/")));
        assert!(!may_open(&url("https://appstoreconnect.apple.com:8443/")));
        assert!(!may_open(&url("https://appstoreconnect.apple.com.evil.example/")));
        assert!(!may_open(&url("https://example.com/")));
        assert!(!may_open(&url("https://idmsa.apple.com/")));
        assert!(!may_open(&url("http://localhost:9002/")));
        assert!(!may_open(&url("file:///etc/passwd")));
    }

    #[test]
    fn frames_stay_with_apple_and_google() {
        let none = HashSet::new();
        assert!(may_load(&url("https://idmsa.apple.com/appleauth/auth/authorize/signin"), &none));
        assert!(may_load(&url("https://accounts.google.com/v3/signin"), &none));
        assert!(may_load(&url("https://accounts.youtube.com/accounts/SetSID"), &none));
        assert!(may_load(&url("about:blank"), &none));
        assert!(may_load(&url("blob:https://appstoreconnect.apple.com/2c1e"), &none));
        assert!(!may_load(&url("https://notgoogle.com/"), &none));
        assert!(!may_load(&url("https://google.com.evil.example/"), &none));
        assert!(!may_load(&url("http://accounts.google.com/"), &none));
        assert!(!may_load(&url("javascript:alert(1)"), &none));
        assert!(!may_load(&url("http://localhost:9002/"), &none));
        let mut sso = HashSet::new();
        sso.insert("login.example.com".to_string());
        assert!(may_load(&url("https://login.example.com/sso"), &sso));
    }

    #[test]
    fn takes_key_files_only() {
        let p8 = "-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49\n-----END PRIVATE KEY-----\n";
        assert_eq!(classify_key_file("AuthKey_2X9R4HXF34.p8", p8), Ok("apple-key"));
        assert!(classify_key_file("AuthKey_2X9R4HXF34.p8", "hello").is_err());
        let json = r#"{"type":"service_account","client_email":"a@b.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\n"}"#;
        assert_eq!(classify_key_file("osg-1234.json", json), Ok("play-key"));
        assert!(classify_key_file("client_secret.json", r#"{"installed":{"client_id":"x"}}"#).is_err());
        assert!(classify_key_file("report.csv", "a,b").is_err());
    }

    #[test]
    fn one_download_per_address_runs_at_a_time() {
        let key = "https://appstoreconnect.apple.com/iris/v1/apiKeys/2X9R4HXF34/download";
        let mut downloads = Downloads::default();
        assert!(downloads.start(key, PathBuf::from("/cache/1-0.p8"), "AuthKey_2X9R4HXF34.p8".into()));
        // A double click: the second is turned away while the first runs.
        assert!(!downloads.start(key, PathBuf::from("/cache/1-1.p8"), "AuthKey_2X9R4HXF34.p8".into()));
        // WebKit reports the turned-away one as failed, by the same address,
        // and the one still running is left alone.
        assert!(downloads.finish(key, None, false).is_none());
        assert_eq!(downloads.paths(), HashSet::from([PathBuf::from("/cache/1-0.p8")]));
        let done = downloads.finish(key, None, true).expect("the first download");
        assert_eq!(done.path, PathBuf::from("/cache/1-0.p8"));
        assert!(downloads.paths().is_empty());
    }

    #[test]
    fn a_turned_away_failure_that_comes_last_is_still_its_own() {
        let key = "https://example.apple.com/key";
        let mut downloads = Downloads::default();
        assert!(downloads.start(key, PathBuf::from("/cache/a.p8"), "a.p8".into()));
        assert!(!downloads.start(key, PathBuf::from("/cache/b.p8"), "a.p8".into()));
        assert_eq!(downloads.finish(key, None, true).map(|d| d.path), Some(PathBuf::from("/cache/a.p8")));
        assert!(downloads.finish(key, None, false).is_none());
        // Nothing is left over to confuse the next download from there.
        assert!(downloads.start(key, PathBuf::from("/cache/c.p8"), "a.p8".into()));
        assert_eq!(downloads.finish(key, None, false).map(|d| d.path), Some(PathBuf::from("/cache/c.p8")));
    }

    #[test]
    fn a_named_file_must_be_the_one_written() {
        let key = "https://example.apple.com/key";
        let mut downloads = Downloads::default();
        assert!(downloads.start(key, PathBuf::from("/cache/a.p8"), "a.p8".into()));
        assert!(downloads.finish(key, Some(Path::new("/Users/me/Downloads/a.p8")), true).is_none());
        assert!(downloads.finish(key, Some(Path::new("/cache/a.p8")), true).is_some());
    }

    #[test]
    fn the_sweep_keeps_only_downloads_under_way() {
        let dir = std::env::temp_dir().join(format!("osg-growth-sweep-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let running = dir.join("1-0.p8");
        let left = dir.join("1-1.p8");
        std::fs::write(&running, "half a key").unwrap();
        std::fs::write(&left, "a key nobody tracks").unwrap();
        sweep(&dir, &HashSet::from([running.clone()]));
        assert!(running.exists());
        assert!(!left.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The identifiers in Rust source, leaving out comments, strings and
    /// character literals, so a path is found however it is spaced or split.
    fn identifiers(code: &str) -> Vec<String> {
        let chars: Vec<char> = code.chars().collect();
        let at = |i: usize| chars.get(i).copied().unwrap_or('\0');
        let mut words = Vec::new();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if c == '/' && at(i + 1) == '/' {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            } else if c == '/' && at(i + 1) == '*' {
                let mut depth = 0;
                while i < chars.len() {
                    if chars[i] == '/' && at(i + 1) == '*' {
                        depth += 1;
                        i += 2;
                    } else if chars[i] == '*' && at(i + 1) == '/' {
                        depth -= 1;
                        i += 2;
                        if depth == 0 {
                            break;
                        }
                    } else {
                        i += 1;
                    }
                }
            } else if c == '"' {
                i += 1;
                while i < chars.len() && chars[i] != '"' {
                    i += if chars[i] == '\\' { 2 } else { 1 };
                }
                i += 1;
            } else if c == '\'' {
                // 'x' and '\n' are characters; 'a in <'a> is a lifetime.
                if at(i + 1) == '\\' {
                    i += 2;
                    while i < chars.len() && chars[i] != '\'' {
                        i += 1;
                    }
                    i += 1;
                } else if at(i + 2) == '\'' {
                    i += 3;
                } else {
                    i += 1;
                }
            } else if c.is_alphabetic() || c == '_' {
                let start = i;
                while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                    i += 1;
                }
                let word: String = chars[start..i].iter().collect();
                // r#Channel is the identifier Channel, written raw.
                if word == "r" && at(i) == '#' && (at(i + 1).is_alphabetic() || at(i + 1) == '_') {
                    i += 1;
                    continue;
                }
                // r"..", r#".."#, br#".."#: raw strings, which end at a quote
                // and as many hashes as they start with.
                if (word == "r" || word == "br") && (at(i) == '"' || at(i) == '#') {
                    let mut hashes = 0;
                    while at(i) == '#' {
                        hashes += 1;
                        i += 1;
                    }
                    i += 1;
                    while i < chars.len() && !(chars[i] == '"' && (1..=hashes).all(|n| at(i + n) == '#')) {
                        i += 1;
                    }
                    i += 1 + hashes;
                } else if word == "b" && at(i) == '"' {
                    i += 1;
                    while i < chars.len() && chars[i] != '"' {
                        i += if chars[i] == '\\' { 2 } else { 1 };
                    }
                    i += 1;
                } else {
                    words.push(word);
                }
            } else {
                i += 1;
            }
        }
        words
    }

    /// Where `code` could reach Tauri's IPC Channel: any identifier with
    /// Channel in it (Channel, JavaScriptChannelId, ChannelDataIpcQueue) but
    /// updater.rs's ReleaseChannel, and the helpers that hand one out. Naming
    /// Tauri's type takes one of those words, however it is imported, aliased
    /// in another file, written raw (r#Channel) or passed through a macro.
    fn channel_uses(code: &str) -> Vec<String> {
        let channel = ["Chan", "nel"].concat();
        let ours = ["Release", &channel].concat();
        let helpers = [["channel", "_on"].concat(), ["send_", "channel", "_data"].concat()];
        identifiers(code)
            .into_iter()
            .filter(|word| (word.contains(&channel) && *word != ours) || helpers.contains(word))
            .collect()
    }

    #[test]
    fn the_channel_check_sees_through_spacing_aliases_and_globs() {
        let finds = |code: &str| !channel_uses(code).is_empty();
        let word = ["Chan", "nel"].concat();
        assert!(finds(&format!("use tauri::ipc :: {word};")));
        assert!(finds(&format!("use tauri::ipc::{{\n    Response,\n    {word} as Pipe,\n}};")));
        assert!(finds(&format!("use tauri::ipc as transport;\nfn f(c: transport::{word}<u8>) {{}}")));
        assert!(finds(&format!("use tauri::{{ipc::{{self as i}}}};\nfn f(c: i::{word}<u8>) {{}}")));
        assert!(finds(&format!("use tauri::ipc::*;\nfn f(c: {word}<u8>) {{}}")));
        assert!(finds(&format!("let id = \"x\".parse::<tauri::ipc::JavaScript{word}Id>();")));
        // An alias made in one file and used in another, a macro, a raw name.
        assert!(finds(&format!("use crate::pipes::{word} as Pipe;")));
        assert!(finds(&format!("fn f(c: crate::transport::{word}<u8>) {{}}")));
        assert!(finds(&format!("macro_rules! pipe {{ () => {{ tauri::ipc::{word}::<String>::new(|_| Ok(())) }} }}")));
        assert!(finds(&format!("fn f(c: r#{word}<u8>) {{}}")));
        // The updater's own enum, comments and strings are not the IPC Channel.
        assert!(!finds(&format!("enum Release{word} {{ Stable, Beta }}\nfn f(c: Release{word}) {{}}")));
        assert!(!finds(&format!("// tauri::ipc::{word}\n/* ipc::{word} */\nlet s = \"ipc::{word}\"; let r = r#\"ipc::{word}\"#;")));
        assert!(!finds("use tauri::ipc::Response;\nfn f() -> Response { Response::new(vec![]) }"));
        assert!(!finds("fn f<'a>(s: &'a str) -> char { let _ = '\"'; 'x' }"));
    }

    /// Tauri 2 lets every webview, the browser's third-party page included,
    /// fetch a queued Channel message by its number: the channel fetch
    /// command skips the ACL. So the app's Rust code reaches no Channel.
    #[test]
    fn the_app_sends_nothing_over_a_tauri_channel() {
        fn walk(dir: &Path, files: &mut Vec<PathBuf>) {
            for entry in std::fs::read_dir(dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, files);
                } else if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                    files.push(path);
                }
            }
        }
        let mut files = Vec::new();
        walk(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut files);
        assert!(files.len() > 10, "found the sources");
        for path in files {
            let uses = channel_uses(&std::fs::read_to_string(&path).unwrap());
            assert!(uses.is_empty(), "{} reaches Tauri's IPC Channel: {uses:?}", path.display());
        }
    }

    #[test]
    fn bounds_must_be_a_place() {
        let at = |x: f64, width: f64| Bounds { x, y: 2.0, width, height: 200.0, viewport: 823.0 };
        assert!(at(1.0, 300.0).checked().is_ok());
        assert!(at(f64::NAN, 300.0).checked().is_err());
        assert!(at(1.0, -1.0).checked().is_err());
        let clamped = at(-5.0, 0.0).checked().unwrap();
        assert_eq!((clamped.x, clamped.width), (0.0, 1.0));
    }
}
