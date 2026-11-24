//! Where a built desktop app finds the editor's files beyond the ones in its
//! binary.
//!
//! Tauri serves the page from the files embedded in the app. `WebAssets` wraps
//! that set, and a path the binary does not hold is looked for in two more
//! places:
//!
//! 1. `web/` in the app's resources. The macOS build ships its pictures there
//!    (tauri.macos.conf.json), so a universal app holds one copy of them rather
//!    than one inside each architecture's binary.
//! 2. Pictures the app downloads the first time it shows them. Template art and
//!    the image library are not shipped at all: `osg-downloads.json`, written by
//!    scripts/desktop-assets.mjs, names each one with its size and sha256, and
//!    it comes from the editor's own site, where the CLI gets it too
//!    (cli/src/editor/assets.ts). A download is kept only when its sha256 is
//!    the one listed, by that sha256, in the app's local data folder, so each
//!    picture is downloaded once and a design always gets the picture it was
//!    made with. A kept copy is checked again each time it is read.
//!
//! A saved project can name a picture by the PNG name it had before the
//! pictures became WebP. That path is answered with the WebP
//! (src/lib/pictureRenames.json, copied into the manifest).
//!
//! The web view on macOS 10.15 cannot decode WebP, so there every WebP is handed
//! over as a PNG, converted here once and kept with the downloads.
//!
//! Tauri asks for a file from a task on its async runtime, not on the main
//! thread (tauri's protocol/tauri.rs), so a download here holds up only the
//! request that needs it. `blocking` tells the runtime before it waits.

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Condvar, Mutex, OnceLock,
    },
    time::Duration,
};

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{
    utils::assets::{AssetKey, AssetsIter, CspHash},
    App, Assets, Manager, Runtime,
};
use tauri_plugin_http::reqwest;

/// The list of downloadable pictures, at the root of the embedded files.
const MANIFEST: &str = "osg-downloads.json";
/// Where the pictures come from unless the manifest or `OSG_DOWNLOADS_URL` says otherwise.
const DEFAULT_BASE_URL: &str = "https://editor.openscrgen.app";
/// Nothing the app downloads comes near this; the largest picture is a few megabytes.
const MAX_DOWNLOAD: u64 = 64 * 1024 * 1024;

#[derive(Deserialize, Default)]
struct Manifest {
    #[serde(rename = "baseUrl", default)]
    base_url: String,
    #[serde(default)]
    files: HashMap<String, Download>,
    /// Folder to the names in it of pictures with a WebP made from their PNG.
    #[serde(default)]
    renamed: HashMap<String, Vec<String>>,
}

#[derive(Deserialize, Clone, Debug)]
struct Download {
    sha256: String,
    #[allow(dead_code)]
    bytes: u64,
}

/// What the app can download, and where it keeps it. One per process, made in
/// `WebAssets::setup`, shared with the commands below.
pub struct Downloads {
    files: HashMap<String, Download>,
    /// Full PNG paths of the pictures with a WebP made from them, e.g. "/data/projects/x.png".
    renamed: HashSet<String>,
    resources: Option<PathBuf>,
    folder: Option<PathBuf>,
    base_url: String,
    as_png: bool,
    user_agent: String,
    client: OnceLock<Result<reqwest::Client, String>>,
    flights: Mutex<HashMap<String, Arc<Flight>>>,
}

/// One download in progress, which later requests for the same file wait on.
#[derive(Default)]
struct Flight {
    outcome: Mutex<Option<Result<(), String>>>,
    landed: Condvar,
}

static DOWNLOADS: OnceLock<Arc<Downloads>> = OnceLock::new();

/// Puts `WebAssets` in front of the files `generate_context!` embedded.
pub fn wrap<R: Runtime>(context: &mut tauri::Context<R>) {
    let embedded = context.set_assets(Box::new(NoAssets));
    context.set_assets(Box::new(WebAssets { embedded }));
}

/// Stands in for a moment while `wrap` swaps the real set out.
struct NoAssets;

impl<R: Runtime> Assets<R> for NoAssets {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }
    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

pub struct WebAssets<R: Runtime> {
    embedded: Box<dyn Assets<R>>,
}

impl<R: Runtime> Assets<R> for WebAssets<R> {
    fn setup(&self, app: &App<R>) {
        self.embedded.setup(app);
        // A dev build has nothing embedded, so no manifest: the dev server has every file.
        let manifest = match self.embedded.get(&AssetKey::from(MANIFEST)) {
            Some(bytes) => serde_json::from_slice::<Manifest>(&bytes).unwrap_or_else(|error| {
                eprintln!("[downloads] {MANIFEST} is unreadable, nothing will download: {error}");
                Manifest::default()
            }),
            None => Manifest::default(),
        };
        let resources = app.path().resource_dir().ok().map(|dir| dir.join("web")).filter(|dir| dir.is_dir());
        let folder = app.path().app_local_data_dir().ok().map(|dir| dir.join("downloads"));
        let user_agent = format!("OpenScreenshotGenerator/{}", app.package_info().version);
        let downloads = Downloads::new(manifest, resources, folder, web_view_needs_png(), user_agent);
        let _ = DOWNLOADS.set(Arc::new(downloads));
    }

    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        let downloads = DOWNLOADS.get();
        if let Some(bytes) = self.embedded.get(key) {
            return Some(match downloads {
                Some(downloads) if downloads.as_png => downloads.png_for(bytes),
                _ => bytes,
            });
        }
        let downloads = downloads?;
        let path = key.as_ref();
        if let Some(bytes) = downloads.lookup(path) {
            return Some(Cow::Owned(bytes));
        }
        let renamed = downloads.renamed_to(path)?;
        if let Some(bytes) = self.embedded.get(&AssetKey::from(renamed.as_str())) {
            return Some(if downloads.as_png { downloads.png_for(bytes) } else { bytes });
        }
        downloads.lookup(&renamed).map(Cow::Owned)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.embedded.csp_hashes(html_path)
    }
}

impl Downloads {
    fn new(
        manifest: Manifest,
        resources: Option<PathBuf>,
        folder: Option<PathBuf>,
        as_png: bool,
        user_agent: String,
    ) -> Self {
        // A mirror, or a local server in a test of the built app.
        let base_url = std::env::var("OSG_DOWNLOADS_URL")
            .ok()
            .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
            .unwrap_or_else(|| {
                if manifest.base_url.is_empty() { DEFAULT_BASE_URL.to_string() } else { manifest.base_url.clone() }
            })
            .trim_end_matches('/')
            .to_string();
        let renamed = manifest
            .renamed
            .iter()
            .flat_map(|(dir, names)| names.iter().map(move |name| format!("{dir}{name}.png")))
            .collect();
        let files = manifest.files.into_iter().filter(|(_, entry)| is_sha256(&entry.sha256)).collect();
        Self {
            files,
            renamed,
            resources,
            folder,
            base_url,
            as_png,
            user_agent,
            client: OnceLock::new(),
            flights: Mutex::new(HashMap::new()),
        }
    }

    /// The WebP made from a listed PNG, for the PNG path every project holds.
    fn renamed_to(&self, path: &str) -> Option<String> {
        if !self.renamed.contains(path) {
            return None;
        }
        path.strip_suffix(".png").map(|stem| format!("{stem}.webp"))
    }

    /// A file from the resources or the downloads, downloading it if it has to.
    fn lookup(&self, path: &str) -> Option<Vec<u8>> {
        if !is_safe(path) {
            return None;
        }
        let bytes = self.read_resource(path).or_else(|| self.read_download(path))?;
        Some(if self.as_png { self.png_for(Cow::Owned(bytes)).into_owned() } else { bytes })
    }

    fn read_resource(&self, path: &str) -> Option<Vec<u8>> {
        let dir = self.resources.as_ref()?;
        fs::read(dir.join(path.trim_start_matches('/'))).ok()
    }

    fn read_download(&self, path: &str) -> Option<Vec<u8>> {
        let entry = self.files.get(path)?;
        if let Some(bytes) = self.read_kept(entry) {
            return Some(bytes);
        }
        match self.fetch(path, entry) {
            Ok(()) => self.read_kept(entry),
            Err(error) => {
                eprintln!("[downloads] {path}: {error}");
                None
            }
        }
    }

    /// The kept copy of `entry` when it is still the file the manifest lists.
    /// One that is not (a disk error, a copy written by something else) is
    /// removed, so the next request downloads the right one.
    fn read_kept(&self, entry: &Download) -> Option<Vec<u8>> {
        let file = self.file_for(entry)?;
        let bytes = fs::read(&file).ok()?;
        if hex(&Sha256::digest(&bytes)) == entry.sha256 {
            return Some(bytes);
        }
        eprintln!("[downloads] {} is not the file it should be, removing it", file.display());
        let _ = fs::remove_file(&file);
        None
    }

    /// The path this app would download for `path`: itself, or the WebP a PNG name became.
    fn resolve(&self, path: &str) -> Option<(String, Download)> {
        let path = path.split(['?', '#']).next().unwrap_or_default();
        if !is_safe(path) {
            return None;
        }
        if let Some(entry) = self.files.get(path) {
            return Some((path.to_string(), entry.clone()));
        }
        let renamed = self.renamed_to(path)?;
        let entry = self.files.get(&renamed)?.clone();
        Some((renamed, entry))
    }

    /// Whether `path` is a picture this app downloads and does not have yet.
    fn missing(&self, path: &str) -> bool {
        match self.resolve(path) {
            Some((_, entry)) => self.folder.is_some() && self.read_kept(&entry).is_none(),
            None => false,
        }
    }

    /// Downloads `path` now unless it is on disk already. A path the app ships,
    /// or does not know, needs nothing. An error starts with why, for the page
    /// to word: `unreachable:`, `missing:`, `changed:` or `local:`.
    fn fetch_path(&self, path: &str) -> Result<(), String> {
        let Some((path, entry)) = self.resolve(path) else { return Ok(()) };
        if self.folder.is_none() {
            return Err("local: there is no folder to keep downloads in".to_string());
        }
        if self.read_kept(&entry).is_some() {
            return Ok(());
        }
        self.fetch(&path, &entry)
    }

    /// One download per path at a time: a second request for it waits for the first.
    fn fetch(&self, path: &str, entry: &Download) -> Result<(), String> {
        let (flight, first) = {
            let mut flights = self.flights.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            match flights.get(path) {
                Some(flight) => (flight.clone(), false),
                None => {
                    let flight = Arc::new(Flight::default());
                    flights.insert(path.to_string(), flight.clone());
                    (flight, true)
                }
            }
        };
        if first {
            let outcome = self.download(path, entry);
            self.flights.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).remove(path);
            *flight.outcome.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(outcome.clone());
            flight.landed.notify_all();
            return outcome;
        }
        blocking(|| {
            let mut outcome = flight.outcome.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            while outcome.is_none() {
                outcome = flight.landed.wait(outcome).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            outcome.clone().unwrap_or_else(|| Err("The download stopped.".to_string()))
        })
    }

    fn download(&self, path: &str, entry: &Download) -> Result<(), String> {
        let url = format!("{}{}", self.base_url, encode_path(path));
        let client = self.client()?;
        let mut last = String::new();
        for attempt in 0..2 {
            if attempt > 0 {
                blocking(|| std::thread::sleep(Duration::from_millis(500)));
            }
            match get_bytes(&client, &url) {
                Ok(body) => return self.keep(path, entry, &body),
                Err(Failure::Again(error)) => last = format!("unreachable: {error}"),
                Err(Failure::Stop(error)) => return Err(error),
            }
        }
        Err(last)
    }

    /// Keeps a download, only when it is the file the manifest lists. Anything
    /// else is turned down: a design has to show the picture it was made with,
    /// and the site changing a published picture in place is what AGENTS.md
    /// rule 91 rules out.
    fn keep(&self, path: &str, entry: &Download, body: &[u8]) -> Result<(), String> {
        let actual = hex(&Sha256::digest(body));
        if actual != entry.sha256 {
            return Err(format!("changed: the site's {path} is not the file this version lists (sha256 {actual})"));
        }
        let file = self.file_for(entry).ok_or_else(|| "local: there is no folder to keep downloads in".to_string())?;
        write_file(&file, body).map_err(|error| format!("local: {error}"))
    }

    fn client(&self) -> Result<reqwest::Client, String> {
        self.client
            .get_or_init(|| {
                reqwest::Client::builder()
                    .user_agent(self.user_agent.clone())
                    .connect_timeout(Duration::from_secs(15))
                    .timeout(Duration::from_secs(120))
                    .build()
                    .map_err(|error| error.to_string())
            })
            .clone()
    }

    /// Where a download is kept: by its sha256, so two paths with the same
    /// picture share one file.
    fn file_for(&self, entry: &Download) -> Option<PathBuf> {
        let folder = self.folder.as_ref()?;
        Some(folder.join(&entry.sha256[..2]).join(&entry.sha256))
    }

    /// The same bytes as a PNG when they are a WebP and the web view can't decode WebP.
    ///
    /// A converted picture is kept as png/<the WebP's sha256>: a tag, then the
    /// PNG. The tag is the sha256 of the WebP's digest and the PNG together, so
    /// a kept file is used again only for the WebP it was made from and only
    /// while its bytes are the ones written. Anything else is converted again.
    fn png_for<'a>(&self, bytes: Cow<'a, [u8]>) -> Cow<'a, [u8]> {
        if !self.as_png || !is_webp(&bytes) {
            return bytes;
        }
        let digest = Sha256::digest(&bytes);
        let kept = self.folder.as_ref().map(|folder| folder.join("png").join(hex(&digest)));
        if let Some(png) = kept.as_deref().and_then(|kept| read_converted(kept, &digest)) {
            return Cow::Owned(png);
        }
        match webp_to_png(&bytes) {
            Ok(png) => {
                if let Some(kept) = &kept {
                    let mut body = converted_tag(&digest, &png);
                    body.extend_from_slice(&png);
                    let _ = write_file(kept, &body);
                }
                Cow::Owned(png)
            }
            Err(error) => {
                eprintln!("[downloads] a WebP did not convert to PNG: {error}");
                bytes
            }
        }
    }
}

/// Which of `paths` the app still has to download. A path it ships, or one it
/// does not know, is never in the answer, so the web build and a dev build get
/// an empty list.
#[tauri::command]
pub fn abs_downloads_missing(paths: Vec<String>) -> Vec<String> {
    let Some(downloads) = DOWNLOADS.get() else { return Vec::new() };
    paths.into_iter().filter(|path| downloads.missing(path)).collect()
}

/// Downloads one picture now, so the page can count them off as they land.
#[tauri::command]
pub async fn abs_downloads_fetch(path: String) -> Result<(), String> {
    let downloads = DOWNLOADS.get().cloned().ok_or_else(|| "This build downloads nothing.".to_string())?;
    tauri::async_runtime::spawn_blocking(move || downloads.fetch_path(&path))
        .await
        .map_err(|error| error.to_string())?
}

enum Failure {
    /// Worth one more try: the network, or the server having a bad moment.
    Again(String),
    /// Trying again gets the same answer.
    Stop(String),
}

/// GETs `url` on Tauri's runtime and waits for the body here.
fn get_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, Failure> {
    let (sender, receiver) = mpsc::channel();
    let client = client.clone();
    let url = url.to_string();
    tauri::async_runtime::spawn(async move {
        let _ = sender.send(fetch_body(client, url).await);
    });
    blocking(|| receiver.recv()).unwrap_or_else(|_| Err(Failure::Again("The download stopped.".to_string())))
}

async fn fetch_body(client: reqwest::Client, url: String) -> Result<Vec<u8>, Failure> {
    let response = client.get(&url).send().await.map_err(|error| Failure::Again(error.to_string()))?;
    let status = response.status();
    if status.is_server_error() {
        return Err(Failure::Again(format!("HTTP {status}")));
    }
    if !status.is_success() {
        return Err(Failure::Stop(format!("missing: HTTP {status}")));
    }
    if response.content_length().is_some_and(|length| length > MAX_DOWNLOAD) {
        return Err(Failure::Stop("changed: the file is far too big to be a picture".to_string()));
    }
    let body = response.bytes().await.map_err(|error| Failure::Again(error.to_string()))?;
    if body.len() as u64 > MAX_DOWNLOAD {
        return Err(Failure::Stop("changed: the file is far too big to be a picture".to_string()));
    }
    Ok(body.to_vec())
}

/// Runs `work`, which waits, without starving Tauri's runtime when called from one of its tasks.
fn blocking<T>(work: impl FnOnce() -> T) -> T {
    match tokio::runtime::Handle::try_current() {
        Ok(handle) if handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::MultiThread => {
            tokio::task::block_in_place(work)
        }
        _ => work(),
    }
}

/// A root-absolute path with nothing that could leave the folder it is read from.
fn is_safe(path: &str) -> bool {
    path.starts_with('/')
        && !path.contains('\\')
        && !path.contains(':')
        && !path.contains('\0')
        && !path.contains("//")
        && path.split('/').all(|part| part != ".." && part != ".")
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Percent-encodes everything but the characters a plain file path needs.
fn encode_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn is_webp(bytes: &[u8]) -> bool {
    bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
}

/// Write then rename, so a file cut off halfway is never read as a whole one.
/// What ties a kept PNG to the WebP it was converted from (`png_for`).
fn converted_tag(webp_digest: &[u8], png: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(webp_digest);
    hasher.update(png);
    hasher.finalize().to_vec()
}

/// The PNG kept at `file` for the WebP whose sha256 is `webp_digest`, while
/// its tag still matches. A file that doesn't is removed.
fn read_converted(file: &Path, webp_digest: &[u8]) -> Option<Vec<u8>> {
    let mut body = fs::read(file).ok()?;
    if body.len() > 32 && body[..32] == converted_tag(webp_digest, &body[32..])[..] {
        body.drain(..32);
        return Some(body);
    }
    eprintln!("[downloads] {} is not the picture it should be, removing it", file.display());
    let _ = fs::remove_file(file);
    None
}

fn write_file(file: &Path, body: &[u8]) -> Result<(), String> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let dir = file.parent().ok_or("A download has no folder.")?;
    fs::create_dir_all(dir).map_err(|error| format!("could not make {}: {error}", dir.display()))?;
    let part = dir.join(format!(
        ".{}.{}.{}.part",
        file.file_name().and_then(|name| name.to_str()).unwrap_or("download"),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&part, body).map_err(|error| format!("could not write {}: {error}", part.display()))?;
    fs::rename(&part, file).map_err(|error| {
        let _ = fs::remove_file(&part);
        format!("could not keep {}: {error}", file.display())
    })
}

/// Whether this Mac's web view needs PNG in place of WebP. `OSG_WEBP_AS_PNG=1`
/// turns the conversion on anywhere, to try it on a newer Mac.
fn web_view_needs_png() -> bool {
    if std::env::var("OSG_WEBP_AS_PNG").is_ok_and(|value| value == "1") {
        return true;
    }
    #[cfg(target_os = "macos")]
    {
        let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
        // WebP decoding came to macOS with Big Sur, which an app built against
        // an old SDK sees as 10.16.
        version.majorVersion == 10 && version.minorVersion < 16
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
fn webp_to_png(webp: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder =
        image_webp::WebPDecoder::new(std::io::Cursor::new(webp)).map_err(|error| error.to_string())?;
    let (width, height) = decoder.dimensions();
    let alpha = decoder.has_alpha();
    let size = decoder.output_buffer_size().ok_or("the picture is too big")?;
    let mut pixels = vec![0u8; size];
    decoder.read_image(&mut pixels).map_err(|error| error.to_string())?;
    let mut png = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png, width, height);
        encoder.set_color(if alpha { png::ColorType::Rgba } else { png::ColorType::Rgb });
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer.write_image_data(&pixels).map_err(|error| error.to_string())?;
        writer.finish().map_err(|error| error.to_string())?;
    }
    Ok(png)
}

#[cfg(not(target_os = "macos"))]
fn webp_to_png(_webp: &[u8]) -> Result<Vec<u8>, String> {
    Err("only the Mac converts WebP".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// A local site that answers every GET from `routes`, counts what it was
    /// asked, and waits `delay` before answering so concurrent requests overlap.
    struct Site {
        url: String,
        hits: Arc<AtomicUsize>,
    }

    fn site(routes: Vec<(&'static str, u16, Vec<u8>)>, delay: Duration) -> Site {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let url = format!("http://127.0.0.1:{}", server.server_addr().to_ip().unwrap().port());
        let hits = Arc::new(AtomicUsize::new(0));
        let counted = hits.clone();
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                counted.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(delay);
                let found = routes.iter().find(|(path, _, _)| *path == request.url());
                let response = match found {
                    Some((_, status, body)) => tiny_http::Response::from_data(body.clone()).with_status_code(*status),
                    None => tiny_http::Response::from_data(b"not here".to_vec()).with_status_code(404),
                };
                let _ = request.respond(response);
            }
        });
        Site { url, hits }
    }

    fn webp_bytes(seed: u8) -> Vec<u8> {
        // A RIFF/WEBP header is all `is_webp` looks at.
        let mut body = b"RIFF\x20\x00\x00\x00WEBPVP8L".to_vec();
        body.extend(std::iter::repeat(seed).take(24));
        body
    }

    fn walk_files(dir: &Path) -> Vec<PathBuf> {
        let mut found = Vec::new();
        for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                found.extend(walk_files(&path));
            } else {
                found.push(path);
            }
        }
        found
    }

    fn sha(bytes: &[u8]) -> String {
        hex(&Sha256::digest(bytes))
    }

    fn downloads_for(base_url: &str, files: Vec<(&str, &[u8])>, renamed: Vec<(&str, &str)>, resources: Option<PathBuf>) -> (Downloads, tempdir::Dir) {
        let dir = tempdir::Dir::new();
        let mut manifest = Manifest { base_url: base_url.to_string(), ..Manifest::default() };
        for (path, body) in files {
            manifest.files.insert(path.to_string(), Download { sha256: sha(body), bytes: body.len() as u64 });
        }
        for (folder, name) in renamed {
            manifest.renamed.entry(folder.to_string()).or_default().push(name.to_string());
        }
        let downloads = Downloads::new(manifest, resources, Some(dir.path.join("downloads")), false, "test".to_string());
        (downloads, dir)
    }

    /// A scratch folder that goes away with the test.
    mod tempdir {
        use std::path::PathBuf;
        pub struct Dir {
            pub path: PathBuf,
        }
        impl Dir {
            pub fn new() -> Self {
                static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                let path = std::env::temp_dir().join(format!(
                    "osg-web-assets-{}-{}",
                    std::process::id(),
                    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                ));
                std::fs::create_dir_all(&path).unwrap();
                Self { path }
            }
        }
        impl Drop for Dir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.path);
            }
        }
    }

    #[test]
    fn paths_that_could_leave_the_folder_are_refused() {
        for bad in ["data/x.webp", "/../etc/passwd", "/a/../../b", "/a/./b", "/a//b", "/C:/x", "/a\\b", "/a\0b"] {
            assert!(!is_safe(bad), "{bad:?} should be refused");
        }
        assert!(is_safe("/data/projects/x.webp"));
        assert!(is_safe("/elements/images/touch/touch-as1.webp"));
    }

    #[test]
    fn a_download_is_kept_and_read_from_disk_after() {
        let body = webp_bytes(1);
        let site = site(vec![("/data/projects/a.webp", 200, body.clone())], Duration::ZERO);
        let (downloads, _dir) = downloads_for(&site.url, vec![("/data/projects/a.webp", &body)], vec![], None);

        assert!(downloads.missing("/data/projects/a.webp"));
        assert_eq!(downloads.lookup("/data/projects/a.webp"), Some(body.clone()));
        assert!(!downloads.missing("/data/projects/a.webp"));
        assert_eq!(downloads.lookup("/data/projects/a.webp"), Some(body));
        assert_eq!(site.hits.load(Ordering::SeqCst), 1, "the second read must come from disk");
        // Not in the manifest: never asked for, never missing.
        assert_eq!(downloads.lookup("/data/projects/other.webp"), None);
        assert!(!downloads.missing("/data/projects/other.webp"));
        assert_eq!(site.hits.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn requests_for_one_picture_at_once_share_one_download() {
        let body = webp_bytes(2);
        let site = site(vec![("/elements/images/touch/t.webp", 200, body.clone())], Duration::from_millis(400));
        let (downloads, _dir) = downloads_for(&site.url, vec![("/elements/images/touch/t.webp", &body)], vec![], None);
        let downloads = Arc::new(downloads);
        let readers: Vec<_> = (0..8)
            .map(|_| {
                let downloads = downloads.clone();
                std::thread::spawn(move || downloads.lookup("/elements/images/touch/t.webp"))
            })
            .collect();
        for reader in readers {
            assert_eq!(reader.join().unwrap(), Some(body.clone()));
        }
        assert_eq!(site.hits.load(Ordering::SeqCst), 1, "eight readers, one download");
    }

    #[test]
    fn a_file_that_is_not_the_listed_one_is_never_kept() {
        // The site serves another picture at this path, a real WebP all the same.
        let listed = webp_bytes(3);
        let other = webp_bytes(4);
        let site = site(vec![("/data/projects/n.webp", 200, other.clone()), ("/data/projects/same.webp", 200, listed.clone())], Duration::ZERO);
        let (downloads, dir) = downloads_for(
            &site.url,
            vec![("/data/projects/n.webp", &listed), ("/data/projects/same.webp", &listed)],
            vec![],
            None,
        );
        assert_eq!(downloads.lookup("/data/projects/n.webp"), None);
        let error = downloads.fetch_path("/data/projects/n.webp").unwrap_err();
        assert!(error.starts_with("changed:"), "{error}");
        assert!(downloads.missing("/data/projects/n.webp"), "nothing is kept for it");
        // Nothing on disk at all but what a correct download wrote.
        let kept: Vec<_> = walk_files(&dir.path);
        assert!(kept.is_empty(), "{kept:?}");
        // A path whose site copy is right still gets its own file.
        assert_eq!(downloads.lookup("/data/projects/same.webp"), Some(listed.clone()));
        assert_eq!(downloads.lookup("/data/projects/n.webp"), Some(listed), "the right bytes, through the shared sha256 file");
    }

    #[test]
    fn a_kept_copy_that_is_no_longer_the_listed_file_is_downloaded_again() {
        let listed = webp_bytes(8);
        let site = site(vec![("/data/projects/k.webp", 200, listed.clone())], Duration::ZERO);
        let (downloads, _dir) = downloads_for(&site.url, vec![("/data/projects/k.webp", &listed)], vec![], None);
        assert_eq!(downloads.lookup("/data/projects/k.webp"), Some(listed.clone()));
        // Something else ends up in the kept file.
        let entry = downloads.files.get("/data/projects/k.webp").unwrap().clone();
        let file = downloads.file_for(&entry).unwrap();
        fs::write(&file, webp_bytes(9)).unwrap();
        assert!(downloads.missing("/data/projects/k.webp"), "a wrong kept copy counts as missing");
        assert_eq!(downloads.lookup("/data/projects/k.webp"), Some(listed.clone()));
        assert_eq!(fs::read(&file).unwrap(), listed, "the kept file is right again");
        assert_eq!(site.hits.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_missing_file_fails_once_and_a_server_error_is_tried_twice() {
        let body = webp_bytes(5);
        let gone = site(vec![], Duration::ZERO);
        let (downloads, _dir) = downloads_for(&gone.url, vec![("/data/projects/g.webp", &body)], vec![], None);
        let error = downloads.fetch_path("/data/projects/g.webp").unwrap_err();
        assert!(error.starts_with("missing:") && error.contains("404"), "{error}");
        assert_eq!(gone.hits.load(Ordering::SeqCst), 1, "a 404 is not retried");

        let broken = site(vec![("/data/projects/g.webp", 500, b"down".to_vec())], Duration::ZERO);
        let (downloads, _dir2) = downloads_for(&broken.url, vec![("/data/projects/g.webp", &body)], vec![], None);
        let error = downloads.fetch_path("/data/projects/g.webp").unwrap_err();
        assert!(error.starts_with("unreachable:") && error.contains("500"), "{error}");
        assert_eq!(broken.hits.load(Ordering::SeqCst), 2, "a 500 gets one more try");
    }

    #[test]
    fn no_server_at_all_fails_without_hanging() {
        // A port that was free a moment ago: nothing listens there now.
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let body = webp_bytes(6);
        let (downloads, _dir) = downloads_for(&format!("http://127.0.0.1:{port}"), vec![("/data/projects/o.webp", &body)], vec![], None);
        let started = std::time::Instant::now();
        assert!(downloads.fetch_path("/data/projects/o.webp").unwrap_err().starts_with("unreachable:"));
        assert!(started.elapsed() < Duration::from_secs(10), "took {:?}", started.elapsed());
        assert!(downloads.missing("/data/projects/o.webp"));
    }

    #[test]
    fn an_old_png_name_finds_the_webp() {
        let body = webp_bytes(7);
        let site = site(vec![("/data/projects/old.webp", 200, body.clone())], Duration::ZERO);
        let (downloads, _dir) =
            downloads_for(&site.url, vec![("/data/projects/old.webp", &body)], vec![("/data/projects/", "old")], None);
        assert_eq!(downloads.renamed_to("/data/projects/old.png").as_deref(), Some("/data/projects/old.webp"));
        assert_eq!(downloads.renamed_to("/data/projects/new.png"), None, "only names that were renamed");
        assert!(downloads.missing("/data/projects/old.png"));
        downloads.fetch_path("/data/projects/old.png").unwrap();
        assert!(!downloads.missing("/data/projects/old.png"));
        assert_eq!(downloads.lookup("/data/projects/old.webp"), Some(body));
    }

    #[test]
    fn shipped_resources_need_no_network() {
        let resources = tempdir::Dir::new();
        fs::create_dir_all(resources.path.join("data/projects/previews")).unwrap();
        fs::write(resources.path.join("data/projects/previews/p.webp"), b"preview").unwrap();
        fs::write(resources.path.join("secret.txt"), b"no").unwrap();
        let (downloads, _dir) = downloads_for("http://127.0.0.1:9", vec![], vec![], Some(resources.path.join("data")));
        assert_eq!(downloads.lookup("/projects/previews/p.webp"), Some(b"preview".to_vec()));
        assert_eq!(downloads.lookup("/../secret.txt"), None);
    }

    #[test]
    fn paths_are_encoded_for_the_url() {
        assert_eq!(encode_path("/data/projects/a b.webp"), "/data/projects/a%20b.webp");
        assert_eq!(encode_path("/elements/images/x-1_2.webp"), "/elements/images/x-1_2.webp");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn webp_turns_into_the_same_pixels_as_png() {
        let (width, height) = (5u32, 3u32);
        let pixels: Vec<u8> = (0..width * height * 4).map(|i| (i * 37 % 251) as u8).collect();
        let mut webp = Vec::new();
        image_webp::WebPEncoder::new(&mut webp).encode(&pixels, width, height, image_webp::ColorType::Rgba8).unwrap();
        assert!(is_webp(&webp));

        let (size, decoded) = png_pixels(&webp_to_png(&webp).unwrap());
        assert_eq!(size, (width, height));
        assert_eq!(decoded, pixels, "lossless WebP must come back pixel for pixel");
    }

    #[cfg(target_os = "macos")]
    fn png_pixels(png_bytes: &[u8]) -> ((u32, u32), Vec<u8>) {
        let mut reader = png::Decoder::new(std::io::Cursor::new(png_bytes)).read_info().unwrap();
        let mut decoded = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut decoded).unwrap();
        decoded.truncate(info.buffer_size());
        ((info.width, info.height), decoded)
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_kept_png_is_used_only_for_its_own_webp_and_only_while_unchanged() {
        let (width, height) = (4u32, 4u32);
        let pixels_a: Vec<u8> = (0..width * height * 4).map(|i| (i * 11 % 256) as u8).collect();
        let pixels_b: Vec<u8> = (0..width * height * 4).map(|i| (i * 29 % 256) as u8 | 1).collect();
        let encode = |pixels: &[u8]| {
            let mut webp = Vec::new();
            image_webp::WebPEncoder::new(&mut webp).encode(pixels, width, height, image_webp::ColorType::Rgba8).unwrap();
            webp
        };
        let (webp_a, webp_b) = (encode(&pixels_a), encode(&pixels_b));
        let dir = tempdir::Dir::new();
        let folder = dir.path.join("downloads");
        let downloads = Downloads::new(Manifest::default(), None, Some(folder.clone()), true, "test".to_string());
        let convert = |webp: &[u8]| downloads.png_for(Cow::Borrowed(webp)).into_owned();
        let pixels_of = |webp: &[u8]| png_pixels(&convert(webp)).1;
        let kept_a = folder.join("png").join(sha(&webp_a));
        let kept_b = folder.join("png").join(sha(&webp_b));

        assert_eq!(pixels_of(&webp_a), pixels_a);
        assert_eq!(pixels_of(&webp_b), pixels_b);
        assert!(kept_a.is_file() && kept_b.is_file());

        // B's kept file in A's place: A's picture, not B's.
        fs::copy(&kept_b, &kept_a).unwrap();
        assert_eq!(pixels_of(&webp_a), pixels_a);
        // A changed byte in the kept file: converted again.
        let mut body = fs::read(&kept_a).unwrap();
        let last = body.len() - 1;
        body[last] ^= 0xff;
        fs::write(&kept_a, &body).unwrap();
        assert_eq!(pixels_of(&webp_a), pixels_a);
        // A PNG with no tag: converted again.
        fs::write(&kept_a, webp_to_png(&webp_b).unwrap()).unwrap();
        assert_eq!(pixels_of(&webp_a), pixels_a);

        // A file whose tag matches is what comes back, so the check is what keeps a wrong one out.
        let stand_in = webp_to_png(&webp_b).unwrap();
        let mut tagged = converted_tag(&Sha256::digest(&webp_a), &stand_in);
        tagged.extend_from_slice(&stand_in);
        fs::write(&kept_a, &tagged).unwrap();
        assert_eq!(convert(&webp_a), stand_in);
    }
}
