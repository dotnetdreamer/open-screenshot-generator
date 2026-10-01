//! Code folders: folders of the user's app code that a Claude Code chat may
//! read. claude_code.rs runs the dialog and grants them to the processes it
//! starts; this module decides what a folder may be and what the process is
//! told about it.
//!
//!   - validate_project_folder refuses a folder that holds more than an app (a
//!     drive, home and everything above it, a whole Documents or Downloads),
//!     one that is private or belongs to the system, and one whose path the
//!     deny rules match or Claude Code distrusts, since the agent would then
//!     find every file refused.
//!   - The grant book is every folder the user picked in the dialog. A start
//!     grants only folders in it, so a path the page makes up gets nowhere.
//!   - The deny rules and the settings file are what Claude Code enforces.
//!   - The folder map is the listing the agent otherwise lacks: it has no Glob,
//!     Read refuses a folder and Grep skips binary files.
//!   - The app reads a folder itself in one place, the picture import, and
//!     keeps MCP exports out of every folder a process reads.
//!
//! Every comparison of two paths is by component, and ignores letter case on
//! Windows and macOS, whose file systems do.

use std::collections::{HashMap, VecDeque};
use std::ffi::OsStr;
use std::io::Read;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

// ---------------------------------------------------------------------------
// Names Claude Code is never allowed to read
// ---------------------------------------------------------------------------

/// Files that hold secrets: environment files, keys, signing and provisioning
/// files, cloud credentials. Gitignore patterns, matched against one name.
pub const SECRET_FILES: &[&str] = &[
    ".env",
    ".env.*",
    "*.env",
    ".envrc",
    ".dev.vars",
    "*.pem",
    "*.key",
    "*.p8",
    "*.p12",
    "*.pfx",
    "*.ppk",
    "*.jks",
    "*.keystore",
    "*.mobileprovision",
    "*.provisionprofile",
    "*.xcconfig",
    "key.properties",
    "keystore.properties",
    "gradle.properties",
    "local.properties",
    "secrets.properties",
    "sentry.properties",
    ".npmrc",
    ".yarnrc.yml",
    ".pypirc",
    ".netrc",
    ".git-credentials",
    "id_rsa*",
    "id_ed25519*",
    "id_ecdsa*",
    "id_dsa*",
    "credentials",
    "*credentials*.json",
    "service-account*.json",
    "*serviceAccount*.json",
    "*firebase-adminsdk*.json",
    "client_secret*.json",
    "google-services.json",
    "GoogleService-Info.plist",
    "Secrets.plist",
    "secrets.json",
    "secrets.yml",
    "secrets.yaml",
    "*.tfstate",
    "*.tfstate.*",
    "*.tfvars",
];

/// Folders that hold secrets.
pub const SECRET_DIRS: &[&str] = &[".git"];

/// Dependency and build folders: large, generated, and not the app's own.
pub const NOISE_DIRS: &[&str] = &[
    "node_modules",
    "Pods",
    "Carthage",
    ".gradle",
    ".dart_tool",
    "DerivedData",
    "build",
    "dist",
    ".next",
    ".expo",
    ".turbo",
    "coverage",
    ".build",
    ".venv",
];

/// Lock files and generated bundles, which cost a read and say nothing.
pub const NOISE_FILES: &[&str] = &[
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Podfile.lock",
    "pubspec.lock",
    "Gemfile.lock",
    "Cargo.lock",
    "*.min.js",
    "*.map",
];

/// What wildcard compares: the text lowercased, since letter case never
/// counts. Claude Code matches its rules with node-ignore, whose default
/// ignores case on every platform.
fn letters(text: &str) -> Vec<char> {
    text.to_lowercase().chars().collect()
}

/// A gitignore name pattern against one name, both from `letters`: `*`
/// stands for any run of characters.
fn wildcard(pattern: &[char], name: &[char]) -> bool {
    let (mut p, mut n) = (0, 0);
    // Where the last `*` was, and how much of the name it has taken so far.
    let mut star: Option<(usize, usize)> = None;
    while n < name.len() {
        if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, n));
            p += 1;
        } else if p < pattern.len() && pattern[p] == name[n] {
            p += 1;
            n += 1;
        } else if let Some((at, taken)) = star {
            p = at + 1;
            n = taken + 1;
            star = Some((at, taken + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|c| *c == '*')
}

#[cfg(test)]
fn name_matches(pattern: &str, name: &str) -> bool {
    wildcard(&letters(pattern), &letters(name))
}

/// Every deny pattern, ready for wildcard. The map tests each name it walks.
fn blocked_patterns() -> &'static [Vec<char>] {
    static PATTERNS: OnceLock<Vec<Vec<char>>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        SECRET_FILES.iter().chain(SECRET_DIRS).chain(NOISE_DIRS).chain(NOISE_FILES).map(|pattern| letters(pattern)).collect()
    })
}

/// Whether a deny rule matches this file or folder name. A folder pattern
/// also matches a file of that name and a file pattern a folder, as in
/// gitignore, and everything below a match is refused along with it.
pub fn name_blocked(name: &str) -> bool {
    let name = letters(name);
    blocked_patterns().iter().any(|pattern| wildcard(pattern, &name))
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// How Windows and macOS compare names: without letter case.
fn fold(text: &str) -> String {
    if cfg!(any(windows, target_os = "macos")) {
        text.to_lowercase()
    } else {
        text.to_string()
    }
}

fn key(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| match component {
            Component::Prefix(prefix) => fold(&prefix.as_os_str().to_string_lossy()),
            Component::RootDir => "/".to_string(),
            Component::CurDir => ".".to_string(),
            Component::ParentDir => "..".to_string(),
            Component::Normal(name) => fold(&name.to_string_lossy()),
        })
        .collect()
}

/// `path` is `root` or somewhere below it.
pub fn is_inside(path: &Path, root: &Path) -> bool {
    let (path, root) = (key(path), key(root));
    path.len() >= root.len() && path[..root.len()] == root[..]
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    key(a) == key(b)
}

/// The names below `root` on the way to `path`, or None when it is not inside.
fn names_below(path: &Path, root: &Path) -> Option<Vec<String>> {
    if !is_inside(path, root) {
        return None;
    }
    let skip = root.components().count();
    Some(
        path.components()
            .skip(skip)
            .filter_map(|component| match component {
                Component::Normal(name) => Some(name.to_string_lossy().into_owned()),
                _ => None,
            })
            .collect(),
    )
}

/// `\\?\C:\x` without the prefix, or None for any other path.
fn strip_verbatim_drive(text: &str) -> Option<&str> {
    let rest = text.strip_prefix(r"\\?\")?;
    let bytes = rest.as_bytes();
    let drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    (drive && (bytes.len() == 2 || bytes[2] == b'\\')).then_some(rest)
}

/// What `canonicalize` gives on Windows is `\\?\C:\...`. Claude Code takes
/// that prefix for a suspicious path and refuses it, and it would fail the
/// case-sensitive test for a working folder too, so a drive path goes without.
pub fn plain(path: PathBuf) -> PathBuf {
    if cfg!(windows) {
        if let Some(stripped) = path.to_str().and_then(strip_verbatim_drive) {
            return PathBuf::from(stripped);
        }
    }
    path
}

/// `std::fs::canonicalize`, then `plain`.
pub fn canonical(path: &Path) -> std::io::Result<PathBuf> {
    std::fs::canonicalize(path).map(plain)
}

fn real_or_same(path: &Path) -> PathBuf {
    canonical(path).unwrap_or_else(|_| path.to_path_buf())
}

/// For a Windows path that starts with two backslashes and is not a drive:
/// the refusal a network share gets, or the one anything else gets (a device,
/// a volume with no letter). The mapped drive of a share canonicalizes to one.
fn windows_special_path(text: &str) -> Option<&'static str> {
    let text = text.replace('/', "\\");
    if !text.starts_with(r"\\") || strip_verbatim_drive(&text).is_some() {
        return None;
    }
    let upper = text.to_ascii_uppercase();
    let network = upper.starts_with(r"\\?\UNC\") || !(upper.starts_with(r"\\?\") || upper.starts_with(r"\\.\"));
    Some(if network { NETWORK_DRIVE } else { NOT_ADDED })
}

fn special_path(text: &str) -> Option<&'static str> {
    if cfg!(windows) {
        windows_special_path(text)
    } else {
        None
    }
}

/// A character that must not reach a prompt or a settings file inside a name:
/// a control character, or a line or paragraph separator.
fn unsafe_char(c: char) -> bool {
    c.is_control() || matches!(c, '\u{2028}' | '\u{2029}')
}

/// A drive mounted where macOS and Linux put them (/Volumes/USB,
/// /media/me/USB): a folder on another device than the one above it, under
/// one of those folders. Only there, since a btrfs subvolume anywhere is on a
/// device of its own too and can be somebody's repo.
#[cfg(unix)]
fn mounted_drive(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Some(parent) = path.parent() else {
        return false;
    };
    let (Ok(own), Ok(up)) = (std::fs::metadata(path), std::fs::metadata(parent)) else {
        return false;
    };
    mounted_under(parent, own.dev(), up.dev())
}

#[cfg(not(unix))]
fn mounted_drive(_path: &Path) -> bool {
    false
}

/// mounted_drive's rule, given the device numbers of a folder and of the
/// `parent` it is in.
#[cfg(any(unix, test))]
fn mounted_under(parent: &Path, own_dev: u64, parent_dev: u64) -> bool {
    let under_mounts = ["/Volumes", "/media", "/mnt", "/run/media"]
        .iter()
        .any(|base| parent == Path::new(base) || parent.parent() == Some(Path::new(base)));
    under_mounts && own_dev != parent_dev
}

/// Paths Claude Code takes for disguised Windows paths, on every platform: a
/// `~` followed by a digit anywhere, as in an 8.3 short name, and a name that
/// ends in a dot or in whitespace (JavaScript's, which counts U+FEFF). It
/// asks before every read below one, inside a working folder too, and
/// dontAsk turns each ask into a refusal.
fn path_claude_code_refuses(path: &Path) -> bool {
    let tilde_digit = path.to_string_lossy().as_bytes().windows(2).any(|pair| pair[0] == b'~' && pair[1].is_ascii_digit());
    let odd_end = path.components().any(|component| match component {
        Component::Normal(name) => {
            name.to_string_lossy().ends_with(|c: char| c == '.' || c.is_whitespace() || c == '\u{feff}')
        }
        _ => false,
    });
    tilde_digit || odd_end
}

/// The last name in a path, for a chip and the map's heading.
pub fn folder_name(path: &Path) -> String {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(String::from)
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// What a folder may be
// ---------------------------------------------------------------------------

/// Why a folder was refused, in the words the user reads under the button.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal(pub String);

impl From<&str> for Refusal {
    fn from(message: &str) -> Self {
        Refusal(message.to_string())
    }
}

impl From<Refusal> for String {
    fn from(refusal: Refusal) -> Self {
        refusal.0
    }
}

pub const NOT_ADDED: &str = "That folder could not be added";
pub const NETWORK_DRIVE: &str = "Folders on a network drive cannot be added. Copy the folder to this computer first";
pub const WHOLE_DRIVE: &str = "That is a whole drive. Pick your app's own folder";
pub const WHOLE_HOME: &str = "That is your whole home folder. Pick your app's own folder";
pub const TOO_BROAD: &str = "That folder holds more than your app. Pick your app's own folder inside it";
pub const PRIVATE: &str = "That folder holds system or private files, so the agent cannot read it";
/// For a path Claude Code would refuse to read in (path_claude_code_refuses).
pub const UNREADABLE_NAME: &str = "Claude Code cannot read a folder with that name. Rename it or pick another folder";

/// The longest folder path a start or a forget takes, in characters.
pub const MAX_FOLDER_PATH: usize = 1024;

/// The folder, or one it sits in, has a name the deny rules match, so every
/// file in it would be refused and the agent would read nothing.
fn blocked_refusal(name: &str, is_the_folder: bool) -> Refusal {
    let name: String = name.chars().take(60).collect();
    Refusal(if is_the_folder {
        format!("The agent never reads a folder named {name}. Pick your app's own folder")
    } else {
        format!("That folder is inside {name}, which the agent never reads. Move your app out of it first")
    })
}

/// Home folders refused whole, though not what is inside them.
fn broad_name(name: &str) -> bool {
    let name = name.to_lowercase();
    matches!(name.as_str(), "documents" | "desktop" | "downloads" | "pictures" | "movies" | "music" | "videos")
        || name.starts_with("onedrive")
}

/// What validate_project_folder compares a folder with. Built from the
/// running app (for_app), or by hand in the tests.
pub struct FolderRules {
    /// The user's home folder, canonical.
    pub home: Option<PathBuf>,
    /// Folders a code folder may be neither inside nor above: the app's own
    /// data (the MCP token, the webview profile with every assistant login),
    /// the temp folder and the system's folders. refused_by_private has the
    /// two exceptions.
    pub private: Vec<PathBuf>,
    /// Folders refused whole, along with every folder that holds one, though
    /// not what is inside them: where the OS keeps Documents, Desktop,
    /// Downloads, Pictures, Videos and Music, which need not be in home
    /// (OneDrive moves them on Windows, and Windows lets the user move them to
    /// another drive).
    pub broad: Vec<PathBuf>,
    /// macOS only: ~/Library, canonical. It is private, bar the cloud drives
    /// macOS keeps in it (cloud_drive).
    pub library: Option<PathBuf>,
}

/// Where a folder is against the cloud drives in ~/Library on macOS: iCloud
/// Drive (Mobile Documents/com~apple~CloudDocs) and the File Provider folder
/// of each other provider (CloudStorage/Dropbox, CloudStorage/GoogleDrive-...,
/// CloudStorage/OneDrive-...).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Cloud {
    Outside,
    /// A whole drive, or a folder at its top that the home rules would refuse
    /// whole (Documents, Desktop and the rest).
    Whole,
    /// Somewhere inside a drive, where a code folder may be.
    Inside,
}

/// Where `real` is against the cloud drives in `library` (~/Library).
fn cloud_drive(real: &Path, library: &Path) -> Cloud {
    let Some(below) = names_below(real, library) else {
        return Cloud::Outside;
    };
    let named = |name: &String, expected: &str| name.eq_ignore_ascii_case(expected);
    let in_drive = match below.as_slice() {
        [storage, _provider, rest @ ..] if named(storage, "CloudStorage") => rest,
        [mobile, icloud, rest @ ..] if named(mobile, "Mobile Documents") && named(icloud, "com~apple~CloudDocs") => rest,
        _ => return Cloud::Outside,
    };
    match in_drive {
        [] => Cloud::Whole,
        [only] if broad_name(only) => Cloud::Whole,
        _ => Cloud::Inside,
    }
}

/// Whether the private folder `dir` refuses `real`, which is in it or holds
/// it. Two kinds of private folder leave a part of themselves alone: one that
/// holds home leaves home to the home rules (/var on Fedora Atomic, whose
/// homes are in /var/home, and /root for root), and ~/Library leaves the
/// cloud drives in it.
fn refused_by_private(dir: &Path, real: &Path, rules: &FolderRules, cloud: Cloud) -> bool {
    if is_inside(dir, real) {
        return true;
    }
    if !is_inside(real, dir) {
        return false;
    }
    let holds_home = rules.home.as_ref().is_some_and(|home| is_inside(home, dir) && is_inside(real, home));
    let cloud_ok = cloud == Cloud::Inside && rules.library.as_ref().is_some_and(|library| same_path(dir, library));
    !holds_home && !cloud_ok
}

#[cfg(windows)]
fn system_folders() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = [r"C:\Windows", r"C:\Program Files", r"C:\Program Files (x86)", r"C:\ProgramData"]
        .iter()
        .map(PathBuf::from)
        .collect();
    for var in ["SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData"] {
        if let Some(value) = std::env::var_os(var).filter(|value| !value.is_empty()) {
            dirs.push(PathBuf::from(value));
        }
    }
    dirs
}

#[cfg(not(windows))]
fn system_folders() -> Vec<PathBuf> {
    [
        "/etc", "/usr", "/bin", "/sbin", "/var", "/private", "/System", "/Library", "/opt", "/proc", "/sys", "/dev",
        "/root", "/tmp", "/Applications",
    ]
    .iter()
    .map(PathBuf::from)
    .collect()
}

/// Both the path as given and where it really is, so a link on the way
/// (macOS keeps /etc and /tmp under /private) cannot slip past.
fn push_both(list: &mut Vec<PathBuf>, dir: PathBuf) {
    let real = real_or_same(&dir);
    if real != dir {
        list.push(dir);
    }
    list.push(real);
}

impl FolderRules {
    pub fn for_app<R: Runtime>(app: &AppHandle<R>) -> FolderRules {
        let paths = app.path();
        let app_dirs = [paths.app_local_data_dir(), paths.app_data_dir(), paths.app_config_dir()]
            .into_iter()
            .filter_map(Result::ok)
            .collect();
        let known = [
            paths.document_dir(),
            paths.desktop_dir(),
            paths.download_dir(),
            paths.picture_dir(),
            paths.video_dir(),
            paths.audio_dir(),
        ]
        .into_iter()
        .filter_map(Result::ok)
        .collect();
        FolderRules::new(crate::claude_code::home_dir(), app_dirs, known)
    }

    /// The rules with the temp folder and the system's folders added.
    pub fn new(home: Option<PathBuf>, app_dirs: Vec<PathBuf>, known_folders: Vec<PathBuf>) -> FolderRules {
        let home = home.map(|dir| real_or_same(&dir));
        let mut private = Vec::new();
        for dir in app_dirs {
            push_both(&mut private, dir);
        }
        push_both(&mut private, std::env::temp_dir());
        for dir in system_folders() {
            push_both(&mut private, dir);
        }
        let mut library = None;
        if let Some(home) = &home {
            if cfg!(windows) {
                push_both(&mut private, home.join("AppData"));
            }
            if cfg!(target_os = "macos") {
                push_both(&mut private, home.join("Library"));
                library = Some(real_or_same(&home.join("Library")));
            }
        }
        let broad = known_folders.iter().map(|dir| real_or_same(dir)).collect();
        FolderRules { home, private, broad, library }
    }
}

/// The canonical form of a folder the user may attach, or why not.
///
/// Every start runs this again, so a folder that has since moved, become a
/// link to somewhere else or been deleted drops out.
pub fn validate_project_folder(raw: &str, rules: &FolderRules) -> Result<PathBuf, Refusal> {
    if raw.is_empty() || raw.chars().any(unsafe_char) {
        return Err(NOT_ADDED.into());
    }
    let given = Path::new(raw);
    if !given.is_absolute() {
        return Err(NOT_ADDED.into());
    }
    // Before canonicalize, which can wait a long time on a share that is gone.
    if let Some(refusal) = special_path(raw) {
        return Err(refusal.into());
    }
    let real = canonical(given).map_err(|_| Refusal::from(NOT_ADDED))?;
    let text = real.to_str().ok_or_else(|| Refusal::from(NOT_ADDED))?;
    // Longer than a start may send, it could never be granted.
    if text.chars().any(unsafe_char) || text.chars().count() > MAX_FOLDER_PATH {
        return Err(NOT_ADDED.into());
    }
    if let Some(refusal) = special_path(text) {
        return Err(refusal.into());
    }
    if !real.is_dir() {
        return Err(NOT_ADDED.into());
    }
    if real.parent().is_none() || mounted_drive(&real) {
        return Err(WHOLE_DRIVE.into());
    }
    if let Some(home) = &rules.home {
        if is_inside(home, &real) {
            return Err(WHOLE_HOME.into());
        }
        if let Some(below) = names_below(&real, home) {
            // ~/.ssh, ~/.claude, ~/.config, ~/.gradle and the rest.
            if below.first().is_some_and(|first| first.starts_with('.')) {
                return Err(PRIVATE.into());
            }
            let whole = match below.as_slice() {
                [only] => broad_name(only),
                // Documents or Desktop that OneDrive backs up.
                [cloud, inner] => cloud.to_lowercase().starts_with("onedrive") && broad_name(inner),
                _ => false,
            };
            if whole {
                return Err(TOO_BROAD.into());
            }
        }
    }
    // A known folder, or one that holds it (D:\Users\me with Documents moved
    // to D:\Users\me\Documents).
    if rules.broad.iter().any(|dir| is_inside(dir, &real)) {
        return Err(TOO_BROAD.into());
    }
    let cloud = rules.library.as_ref().map_or(Cloud::Outside, |library| cloud_drive(&real, library));
    if cloud == Cloud::Whole {
        return Err(TOO_BROAD.into());
    }
    if rules.private.iter().any(|dir| refused_by_private(dir, &real, rules, cloud)) {
        return Err(PRIVATE.into());
    }
    let names: Vec<&str> = real
        .components()
        .filter_map(|component| match component {
            Component::Normal(name) => name.to_str(),
            _ => None,
        })
        .collect();
    if let Some(at) = names.iter().position(|name| name_blocked(name)) {
        return Err(blocked_refusal(names[at], at + 1 == names.len()));
    }
    // The agent would find every read in it refused.
    if path_claude_code_refuses(&real) {
        return Err(UNREADABLE_NAME.into());
    }
    Ok(real)
}

// ---------------------------------------------------------------------------
// The grant book
// ---------------------------------------------------------------------------

/// The grant book's file, in the agent's workspace.
pub const GRANT_BOOK: &str = "folders.json";

/// The most folders the book remembers. The oldest pick goes first.
pub const MAX_GRANTS: usize = 100;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    /// Canonical, as validate_project_folder returned it.
    pub path: String,
    pub name: String,
    /// Unix time in milliseconds.
    pub picked_at: u64,
}

/// Every folder the user picked in the dialog, newest first, one entry per
/// folder. Only Rust writes it.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
pub struct GrantBook {
    pub v: u32,
    pub folders: Vec<Grant>,
}

impl Default for GrantBook {
    fn default() -> Self {
        GrantBook { v: 1, folders: Vec::new() }
    }
}

impl GrantBook {
    /// The book on disk. One that is missing, unreadable or from another
    /// version counts as empty, so nothing in it is granted.
    pub fn load(file: &Path) -> GrantBook {
        let Ok(bytes) = std::fs::read(file) else {
            return GrantBook::default();
        };
        match serde_json::from_slice::<GrantBook>(&bytes) {
            Ok(book) if book.v == 1 => GrantBook {
                v: 1,
                folders: book
                    .folders
                    .into_iter()
                    .filter(|grant| !grant.path.is_empty() && !grant.path.chars().any(unsafe_char))
                    .take(MAX_GRANTS)
                    .collect(),
            },
            _ => GrantBook::default(),
        }
    }

    pub fn save(&self, file: &Path) -> Result<(), String> {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
        }
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        crate::claude_code::write_private(file, &bytes)
    }

    /// Record a pick, or move a folder picked before to the front.
    pub fn grant(&mut self, path: &Path, name: &str, now_ms: u64) {
        self.folders.retain(|grant| !same_path(Path::new(&grant.path), path));
        self.folders.insert(
            0,
            Grant { path: path.to_string_lossy().into_owned(), name: name.to_string(), picked_at: now_ms },
        );
        self.folders.truncate(MAX_GRANTS);
    }

    /// Take a folder out. False when it was not there.
    pub fn forget(&mut self, path: &Path) -> bool {
        let before = self.folders.len();
        self.folders.retain(|grant| !same_path(Path::new(&grant.path), path));
        self.folders.len() != before
    }

    pub fn holds(&self, path: &Path) -> bool {
        self.folders.iter().any(|grant| same_path(Path::new(&grant.path), path))
    }

    pub fn newest(&self) -> Option<&Grant> {
        self.folders.first()
    }
}

// ---------------------------------------------------------------------------
// What Claude Code is told to refuse
// ---------------------------------------------------------------------------

/// A path in the absolute form Claude Code's rules take: `//` and then the
/// path in POSIX form, the drive letter first on Windows (`//c/Users/me/x`),
/// with every character gitignore treats as special escaped. None for a path
/// with no such form (a network share).
fn rule_path(path: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => match prefix.kind() {
                Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                    parts.push((letter as char).to_ascii_lowercase().to_string());
                }
                _ => return None,
            },
            Component::RootDir => {}
            Component::Normal(name) => parts.push(escape_rule_name(name.to_str()?)),
            Component::CurDir | Component::ParentDir => return None,
        }
    }
    (!parts.is_empty()).then(|| format!("//{}", parts.join("/")))
}

fn escape_rule_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        match c {
            // Claude Code turns a doubled backslash in a rule into one before
            // gitignore reads it, so one that gitignore should see as a plain
            // backslash is written four times.
            '\\' => out.push_str(r"\\\\"),
            '[' | ']' | '*' | '?' | '!' | '#' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// The deny rules of every process started with code folders. Constant, so
/// no folder path is in them and nothing needs escaping, bar the relocated
/// config folder at the end.
///
/// Each pattern goes in twice. `Read(**/P)` is anchored at the cwd, which is
/// the empty session folder, so it stops no Read in a code folder; Grep turns
/// it into a ripgrep exclude, which is what keeps a secret out of a search
/// over a whole folder. `Read(//**/P)` is absolute on every drive and stops a
/// Read, and a Grep pointed at the file, but Grep leaves it out of its
/// excludes. A folder pattern also takes the `/**` pair for what is inside.
///
/// Then Claude Code's own folder: it lets a Read through to its transcripts
/// (every design chat's, since they all run in one cwd), tasks, teams and
/// agent memory there, working folder or not, and deny rules are checked
/// before that. And its global config beside that folder, ~/.claude.json,
/// which holds the signed-in account.
pub fn deny_rules(config_dir: Option<&Path>) -> Vec<String> {
    let mut rules = Vec::new();
    for pattern in SECRET_FILES.iter().chain(NOISE_FILES) {
        rules.push(format!("Read(**/{pattern})"));
        rules.push(format!("Read(//**/{pattern})"));
    }
    for dir in SECRET_DIRS.iter().chain(NOISE_DIRS) {
        rules.push(format!("Read(**/{dir})"));
        rules.push(format!("Read(//**/{dir})"));
        rules.push(format!("Read(**/{dir}/**)"));
        rules.push(format!("Read(//**/{dir}/**)"));
    }
    rules.push("Read(~/.claude)".to_string());
    rules.push("Read(~/.claude/**)".to_string());
    rules.push("Read(~/.claude.json)".to_string());
    // CLAUDE_CONFIG_DIR moves ~/.claude, and the child inherits it. The path
    // as set and where it leads, when those differ.
    if let Some(dir) = config_dir.filter(|dir| dir.is_absolute()) {
        let mut forms: Vec<String> = Vec::new();
        for path in [dir.to_path_buf(), real_or_same(dir)] {
            if let Some(form) = rule_path(&path) {
                if !forms.contains(&form) {
                    forms.push(form);
                }
            }
        }
        for form in forms {
            rules.push(format!("Read({form})"));
            rules.push(format!("Read({form}/**)"));
        }
    }
    rules
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderSettings<'a> {
    disable_all_hooks: bool,
    permissions: FolderPermissions<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderPermissions<'a> {
    additional_directories: Vec<&'a str>,
    deny: &'a [String],
    /// The hard fence of Claude Code 2.1.257 and later. Older versions pass a
    /// permission key they do not know through, and still apply the rest.
    block_reads_outside_working_directories: bool,
}

/// The `--settings` file of a process started with code folders. Typed
/// structs rather than a JSON literal: in print mode Claude Code drops a
/// settings file with a value of the wrong type whole, and `disableAllHooks`
/// goes with it.
///
/// The folders are granted as `additionalDirectories` here, never with
/// `--add-dir`, which also switches on the plugins a folder's own
/// `.claude/settings.json` names. There is no allow list at all: a tool-wide
/// allow for Read or Grep beats dontAsk and reads the whole disk.
pub fn settings_json(folders: &[PathBuf], deny: &[String]) -> Result<Vec<u8>, String> {
    let additional_directories = folders
        .iter()
        .map(|folder| folder.to_str().ok_or_else(|| NOT_ADDED.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let settings = FolderSettings {
        disable_all_hooks: true,
        permissions: FolderPermissions { additional_directories, deny, block_reads_outside_working_directories: true },
    };
    serde_json::to_vec(&settings).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// The folder map
// ---------------------------------------------------------------------------

/// How much of a folder one map covers.
pub struct MapLimits {
    /// Entries this deep are listed; folders this deep are not walked into.
    pub depth: usize,
    pub entries: usize,
    pub time: Duration,
    pub top_level: usize,
    pub pictures: usize,
    pub useful: usize,
    /// Pictures or useful files from one folder, before the rest get a turn.
    pub per_folder: usize,
    /// One folder's section, in bytes.
    pub section_chars: usize,
}

pub const MAP_LIMITS: MapLimits = MapLimits {
    depth: 8,
    entries: 20_000,
    time: Duration::from_millis(1500),
    top_level: 40,
    pictures: 60,
    useful: 40,
    per_folder: 10,
    section_chars: 8_000,
};

/// Ends a list, or a section, that was cut short. project-folders.md tells
/// the agent what it means.
pub const MORE: &str = "(more not listed)";

/// A path longer than this is left off the map.
const MAX_LISTED_PATH: usize = 300;

const PICTURE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "svg"];

/// One file the map may list.
struct Found {
    /// From the folder's root, with forward slashes.
    rel: String,
    depth: usize,
    /// Lower comes first.
    rank: u8,
    /// The folder it is in, lowercased, for the per-folder cap.
    dir: String,
    /// Files that count as the same kind for `name_cap`.
    name_key: String,
    name_cap: usize,
}

#[derive(Default)]
struct Walked {
    /// The top level in walk order, folders with a trailing slash.
    top: Vec<String>,
    /// The walk stopped before the top level was all read.
    top_cut: bool,
    pictures: Vec<Found>,
    useful: Vec<Found>,
    /// The walk stopped before it saw everything the map may list.
    cut: bool,
}

/// Shown on the map and walked into. A hidden name, a name the deny rules
/// match (Claude Code would refuse it) and a name that could break a line of
/// the prompt are left out.
fn listable(name: &str) -> bool {
    !name.starts_with('.') && !name.chars().any(unsafe_char) && !name_blocked(name)
}

#[cfg(windows)]
fn hidden_on_disk(entry: &std::fs::DirEntry) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    entry.metadata().is_ok_and(|meta| meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0)
}

#[cfg(not(windows))]
fn hidden_on_disk(_entry: &std::fs::DirEntry) -> bool {
    false
}

fn is_picture(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(stem, extension)| !stem.is_empty() && PICTURE_EXTENSIONS.contains(&extension))
}

/// Icons and logos first, then store art, then the rest.
fn picture_rank(rel: &str) -> u8 {
    if ["appicon", "icon", "logo", "launcher", "playstore"].iter().any(|word| rel.contains(word)) {
        0
    } else if ["screenshot", "fastlane", "store", "marketing"].iter().any(|word| rel.contains(word)) {
        1
    } else {
        2
    }
}

fn in_fastlane_metadata(rel: &str) -> bool {
    let parts: Vec<&str> = rel.split('/').collect();
    parts.windows(2).any(|pair| pair[0] == "fastlane" && pair[1] == "metadata")
}

/// The app's default language, which the map lists before the others.
fn base_language(rel: &str) -> bool {
    rel.split('/')
        .any(|part| matches!(part, "en-us" | "en-gb" | "en" | "default" | "values" | "base.lproj" | "en.lproj"))
        || rel.rsplit('/').next().is_some_and(|name| name == "en.arb" || name.ends_with("_en.arb"))
}

/// Where a file with the app's name, copy, colours or languages goes on the
/// list, or None when it is not one. All three arguments are lowercased.
fn useful_rank(name: &str, rel: &str, parent: &str) -> Option<u8> {
    let first = name.starts_with("readme")
        || name.starts_with("app.config.")
        || name.starts_with("tailwind.config.")
        || matches!(
            name,
            "package.json" | "app.json" | "pubspec.yaml" | "info.plist" | "project.pbxproj" | "androidmanifest.xml"
        )
        || (name == "contents.json" && parent.ends_with(".appiconset"));
    if first {
        return Some(0);
    }
    let store = name.ends_with(".txt") && in_fastlane_metadata(rel);
    let look = matches!(name, "colors.xml" | "themes.xml")
        || (name == "contents.json" && parent.ends_with(".colorset"))
        || name.contains("theme");
    if store || look {
        return Some(1);
    }
    let words = matches!(name, "strings.xml" | "localizable.strings") || name.ends_with(".xcstrings") || name.ends_with(".arb");
    words.then_some(2)
}

/// How many useful files of one kind the map lists: one store text per name
/// (the default language's), a couple of release notes, several colours, and
/// three of anything else (Info.plist of the app and two extensions).
fn useful_cap(name: &str, rel: &str, parent: &str) -> (String, usize) {
    if parent == "changelogs" {
        return ("changelogs".to_string(), 2);
    }
    if name == "contents.json" {
        let kind = if parent.ends_with(".colorset") { "colorset" } else { "appiconset" };
        let cap = if kind == "colorset" { 8 } else { 2 };
        return (format!("{name}@{kind}"), cap);
    }
    if name.ends_with(".txt") && in_fastlane_metadata(rel) {
        return (format!("{name}@fastlane"), 1);
    }
    (name.to_string(), 3)
}

/// One breadth-first walk: shallow files are seen first, so a cut drops the
/// deep ones. Links are never followed, and neither listed nor walked into:
/// Claude Code refuses a path that leads outside the folder anyway.
fn walk(root: &Path, limits: &MapLimits) -> Walked {
    let started = Instant::now();
    let mut walked = Walked::default();
    let mut queue: VecDeque<(PathBuf, String, usize)> = VecDeque::from([(root.to_path_buf(), String::new(), 1)]);
    let mut seen = 0usize;
    while let Some((dir, prefix, depth)) = queue.pop_front() {
        if started.elapsed() > limits.time {
            walked.cut = true;
            walked.top_cut |= depth == 1;
            break;
        }
        let Ok(reader) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut entries: Vec<(String, bool)> = Vec::new();
        for entry in reader.flatten() {
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if !listable(&name) || hidden_on_disk(&entry) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir() || kind.is_file() {
                entries.push((name, kind.is_dir()));
            }
        }
        // Folders first, then by name, so the same folder gives the same map.
        entries.sort_by_cached_key(|(name, is_dir)| (!is_dir, name.to_lowercase(), name.clone()));
        let folder = prefix.to_lowercase();
        let parent = folder.rsplit('/').next().unwrap_or("").to_string();
        for (name, is_dir) in entries {
            seen += 1;
            if seen > limits.entries || started.elapsed() > limits.time {
                walked.cut = true;
                walked.top_cut |= depth == 1;
                return walked;
            }
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if depth == 1 {
                walked.top.push(if is_dir { format!("{name}/") } else { name.clone() });
            }
            if is_dir {
                if depth < limits.depth {
                    queue.push_back((dir.join(&name), rel, depth + 1));
                } else {
                    walked.cut = true;
                }
                continue;
            }
            if rel.len() > MAX_LISTED_PATH {
                continue;
            }
            let lower = name.to_lowercase();
            let rel_lower = rel.to_lowercase();
            if is_picture(&lower) {
                let rank = picture_rank(&rel_lower);
                walked.pictures.push(Found {
                    rel,
                    depth,
                    rank,
                    dir: folder.clone(),
                    name_key: lower,
                    name_cap: usize::MAX,
                });
            } else if let Some(rank) = useful_rank(&lower, &rel_lower, &parent) {
                let (name_key, name_cap) = useful_cap(&lower, &rel_lower, &parent);
                let rank = rank * 2 + u8::from(!base_language(&rel_lower));
                walked.useful.push(Found { rel, depth, rank, dir: folder.clone(), name_key, name_cap });
            }
        }
    }
    walked
}

/// Up to `limit` of `found`, best first. A first pass takes at most
/// `per_folder` from each folder and `name_cap` of each kind, so a folder of
/// 300 screenshots cannot push the app icon off; with `fill`, a second pass
/// fills what is left in the same order. True when something was left out.
fn select(mut found: Vec<Found>, limit: usize, per_folder: usize, fill: bool) -> (Vec<String>, bool) {
    found.sort_by_cached_key(|item| (item.rank, item.depth, item.rel.to_lowercase(), item.rel.clone()));
    let mut taken = vec![false; found.len()];
    let mut count = 0;
    let mut per_dir: HashMap<&str, usize> = HashMap::new();
    let mut per_name: HashMap<&str, usize> = HashMap::new();
    for (index, item) in found.iter().enumerate() {
        if count == limit {
            break;
        }
        let in_dir = per_dir.entry(item.dir.as_str()).or_default();
        let of_name = per_name.entry(item.name_key.as_str()).or_default();
        if *in_dir >= per_folder || *of_name >= item.name_cap {
            continue;
        }
        *in_dir += 1;
        *of_name += 1;
        taken[index] = true;
        count += 1;
    }
    if fill {
        for slot in taken.iter_mut() {
            if count == limit {
                break;
            }
            if !*slot {
                *slot = true;
                count += 1;
            }
        }
    }
    let list: Vec<String> = found.iter().zip(&taken).filter(|(_, taken)| **taken).map(|(item, _)| item.rel.clone()).collect();
    let cut = list.len() < found.len();
    (list, cut)
}

fn push_list(lines: &mut Vec<String>, title: &str, items: Vec<String>, cut: bool) {
    if items.is_empty() && !cut {
        lines.push(format!("{title}: none"));
        return;
    }
    lines.push(format!("{title}:"));
    lines.extend(items.into_iter().map(|item| format!("- {item}")));
    if cut {
        lines.push(MORE.to_string());
    }
}

/// The lines, up to `cap` bytes, ending in MORE when some had to go.
fn clip_lines(lines: Vec<String>, cap: usize) -> String {
    let whole = lines.join("\n");
    if whole.len() <= cap {
        return whole;
    }
    let budget = cap.saturating_sub(MORE.len() + 1);
    let mut out = String::new();
    for line in lines {
        let extra = if out.is_empty() { line.len() } else { line.len() + 1 };
        if out.len() + extra > budget {
            break;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&line);
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(MORE);
    out
}

fn render(label: &str, root: &Path, walked: Walked, limits: &MapLimits) -> String {
    let mut lines = vec![format!("## {label}"), format!("Path: {}", root.to_string_lossy())];
    let top_cut = walked.top_cut || walked.top.len() > limits.top_level;
    let top: Vec<String> = walked.top.into_iter().take(limits.top_level).collect();
    push_list(&mut lines, "Top level", top, top_cut);
    let (pictures, cut) = select(walked.pictures, limits.pictures, limits.per_folder, true);
    push_list(&mut lines, "Pictures", pictures, cut || walked.cut);
    let (useful, cut) = select(walked.useful, limits.useful, limits.per_folder, false);
    push_list(&mut lines, "Useful files", useful, cut || walked.cut);
    clip_lines(lines, limits.section_chars)
}

/// What each folder's section is headed: its name, or "parent/name" when two
/// of them share a name (ios/app and android/app).
fn folder_labels(folders: &[PathBuf]) -> Vec<String> {
    let names: Vec<String> = folders.iter().map(|folder| folder_name(folder)).collect();
    folders
        .iter()
        .zip(&names)
        .map(|(folder, name)| {
            let clash = names.iter().filter(|other| other.to_lowercase() == name.to_lowercase()).count() > 1;
            let parent = folder.parent().and_then(Path::file_name).and_then(OsStr::to_str);
            match parent {
                Some(parent) if clash => format!("{parent}/{name}"),
                _ => name.clone(),
            }
        })
        .collect()
}

/// The "Your folders" section at the end of a folder chat's instructions,
/// one map per folder in the order given (sorted by path, so the same set
/// gives the same prompt). The walks run side by side, so three folders take
/// no longer than the slowest.
pub fn folders_section(folders: &[PathBuf], limits: &MapLimits) -> String {
    let labels = folder_labels(folders);
    let maps: Vec<Walked> = std::thread::scope(|scope| {
        let walks: Vec<_> = folders.iter().map(|root| scope.spawn(move || walk(root, limits))).collect();
        walks
            .into_iter()
            .map(|handle| handle.join().unwrap_or_else(|_| Walked { top_cut: true, cut: true, ..Walked::default() }))
            .collect()
    });
    let sections: Vec<String> = folders
        .iter()
        .zip(labels)
        .zip(maps)
        .map(|((root, label), walked)| render(&label, root, walked, limits))
        .collect();
    format!("# Your folders\n\n{}\n", sections.join("\n\n"))
}

// ---------------------------------------------------------------------------
// Pictures the agent imports
// ---------------------------------------------------------------------------

pub const IMAGE_NO_FOLDER: &str = "No code folder is attached to this chat";
pub const IMAGE_OUTSIDE: &str = "That file is not in a code folder attached to this chat";
pub const IMAGE_KIND: &str = "Only PNG, JPEG, WebP, GIF and SVG files can be imported";
pub const IMAGE_TOO_BIG: &str = "That image is over 20 MB";
pub const IMAGE_MISSING: &str = "There is no file at that path";
pub const IMAGE_PRIVATE: &str = "That file is in a build, dependency or private folder, so it cannot be imported";
pub const IMAGE_UNREADABLE: &str = "That image could not be read";

pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// The longest path the import takes, in characters.
const MAX_IMAGE_PATH: usize = 4096;

/// The real path of a picture the agent may import from `roots`, or the short
/// sentence it reads instead. A path that is not there counts as outside
/// unless it would have been in a folder (unresolved_image), so the answer
/// never says whether a file outside the folders exists.
pub fn project_image_path(raw: &str, roots: &[PathBuf]) -> Result<PathBuf, &'static str> {
    if roots.is_empty() {
        return Err(IMAGE_NO_FOLDER);
    }
    if raw.is_empty() || raw.chars().count() > MAX_IMAGE_PATH || raw.chars().any(unsafe_char) {
        return Err(IMAGE_OUTSIDE);
    }
    let given = Path::new(raw);
    if !given.is_absolute() || special_path(raw).is_some() {
        return Err(IMAGE_OUTSIDE);
    }
    let real = match canonical(given) {
        Ok(real) => real,
        Err(_) => return Err(unresolved_image(given, roots)),
    };
    let Some(root) = roots.iter().find(|root| is_inside(&real, root)) else {
        return Err(IMAGE_OUTSIDE);
    };
    let picture = real
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| PICTURE_EXTENSIONS.iter().any(|known| extension.eq_ignore_ascii_case(known)));
    if !picture {
        return Err(IMAGE_KIND);
    }
    if names_below(&real, root).unwrap_or_default().iter().any(|name| name_blocked(name)) {
        return Err(IMAGE_PRIVATE);
    }
    let meta = std::fs::metadata(&real).map_err(|_| IMAGE_UNREADABLE)?;
    if !meta.is_file() {
        return Err(IMAGE_KIND);
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(IMAGE_TOO_BIG);
    }
    Ok(real)
}

/// The answer for a picture path that does not resolve. MISSING only when
/// the file would be in a folder: the path does not climb with `..`, no link
/// on the way leads to something missing, and where the part that exists
/// really is, with the missing names put back, is inside a root. Anything
/// else gets OUTSIDE, the answer a file that exists outside the folders gets,
/// so a link planted in a folder cannot tell the agent whether a file it
/// points at exists.
fn unresolved_image(given: &Path, roots: &[PathBuf]) -> &'static str {
    if given.components().any(|component| matches!(component, Component::ParentDir)) {
        return IMAGE_OUTSIDE;
    }
    for probe in given.ancestors() {
        if canonical(probe).is_ok() {
            break;
        }
        // Something is there, but it does not resolve: a link to nowhere.
        if std::fs::symlink_metadata(probe).is_ok() {
            return IMAGE_OUTSIDE;
        }
    }
    let target = resolved_target(given);
    if roots.iter().any(|root| is_inside(&target, root)) {
        IMAGE_MISSING
    } else {
        IMAGE_OUTSIDE
    }
}

/// The file's bytes, refused past the size cap even if it grew since the check.
pub fn read_project_image(path: &Path) -> Result<Vec<u8>, &'static str> {
    let file = std::fs::File::open(path).map_err(|_| IMAGE_UNREADABLE)?;
    let mut bytes = Vec::new();
    file.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes).map_err(|_| IMAGE_UNREADABLE)?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(IMAGE_TOO_BIG);
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

pub const EXPORT_INSIDE_FOLDER: &str =
    "Exports cannot be saved inside the code folder the agent is reading. Leave directory out to use the default folder";
pub const EXPORT_NOT_ABSOLUTE: &str =
    "directory must be a full folder path without . or .. in it. Leave it out to use the default folder";
pub const EXPORT_NETWORK: &str =
    "Exports cannot be saved to a network folder while the agent is reading a code folder. Leave directory out to use the default folder";

/// Where a folder that may not exist yet would be: its deepest existing
/// ancestor canonicalized, which resolves links, 8.3 names and letter case,
/// with the missing names put back on the end.
fn resolved_target(dir: &Path) -> PathBuf {
    let mut missing: Vec<&OsStr> = Vec::new();
    let mut probe = dir;
    loop {
        if let Ok(real) = canonical(probe) {
            let mut target = real;
            for name in missing.iter().rev() {
                target.push(name);
            }
            return target;
        }
        match (probe.parent(), probe.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name);
                probe = parent;
            }
            _ => return dir.to_path_buf(),
        }
    }
}

/// Why an MCP export may not go to `dir`, or None. `roots` are the folders a
/// live agent process reads: an export there could overwrite the app's own
/// icons. A relative directory or one that climbs with `..` is refused
/// whether or not a folder is attached, since it lands wherever the app's
/// working directory happens to be.
pub fn export_directory_problem(dir: &Path, roots: &[PathBuf]) -> Option<&'static str> {
    let climbs = dir.components().any(|component| matches!(component, Component::CurDir | Component::ParentDir));
    if !dir.is_absolute() || climbs {
        return Some(EXPORT_NOT_ABSOLUTE);
    }
    if roots.is_empty() {
        return None;
    }
    // A share reaches local folders too (\\localhost\c$\...), and it
    // canonicalizes to itself rather than to the drive path, so while a folder
    // is live no share or device path is taken at all. Checked as written
    // first, because resolving a path on a share that is gone can hang.
    if special_path(&dir.to_string_lossy()).is_some() {
        return Some(EXPORT_NETWORK);
    }
    resolved_export_problem(&resolved_target(dir), roots)
}

/// The rest of export_directory_problem, on where the directory really is.
fn resolved_export_problem(target: &Path, roots: &[PathBuf]) -> Option<&'static str> {
    // A drive letter mapped to a share, or a link to one, resolves to the
    // share (\\?\UNC\localhost\c$\...).
    if special_path(&target.to_string_lossy()).is_some() {
        return Some(EXPORT_NETWORK);
    }
    let inside = roots.iter().any(|root| is_inside(target, root)) || root_on_the_way(target, roots);
    inside.then_some(EXPORT_INSIDE_FOLDER)
}

/// Whether `target` or a folder above it is one of `roots` by device and
/// inode. Canonicalizing resolves links but not a bind mount or a macOS
/// firmlink (/System/Volumes/Data/Users/...), and those name a root by
/// another path.
#[cfg(unix)]
fn root_on_the_way(target: &Path, roots: &[PathBuf]) -> bool {
    use std::os::unix::fs::MetadataExt;
    let ids: Vec<(u64, u64)> =
        roots.iter().filter_map(|root| std::fs::metadata(root).ok()).map(|meta| (meta.dev(), meta.ino())).collect();
    !ids.is_empty()
        && target
            .ancestors()
            .any(|dir| std::fs::metadata(dir).is_ok_and(|meta| ids.contains(&(meta.dev(), meta.ino()))))
}

#[cfg(not(unix))]
fn root_on_the_way(_target: &Path, _roots: &[PathBuf]) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of its own under the temp folder for one test, emptied first.
    fn sandbox(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("osg-code-folders-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        canonical(&dir).unwrap()
    }

    fn touch(path: &Path, bytes: &[u8]) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn rules_with_home(home: &Path) -> FolderRules {
        FolderRules { home: Some(home.to_path_buf()), private: Vec::new(), broad: Vec::new(), library: None }
    }

    fn refusal(result: Result<PathBuf, Refusal>) -> String {
        result.expect_err("refused").0
    }

    #[test]
    fn names_match_like_gitignore() {
        assert!(name_matches(".env", ".env"));
        assert!(name_matches(".env", ".ENV"));
        assert!(name_matches(".env.*", ".env.local"));
        assert!(!name_matches(".env.*", ".env"));
        assert!(name_matches("*.pem", "server.pem"));
        assert!(name_matches("*firebase-adminsdk*.json", "app-firebase-adminsdk-1a2b.json"));
        assert!(name_matches("id_rsa*", "id_rsa.pub"));
        assert!(name_matches("*.tfstate.*", "prod.tfstate.backup"));
        assert!(!name_matches("*.map", "roadmap"));
        assert!(name_matches("Pods", "pods"));
        assert!(name_blocked("node_modules"));
        assert!(name_blocked("GoogleService-Info.plist"));
        assert!(name_blocked("Build"));
        assert!(!name_blocked("src"));
        assert!(!name_blocked("icon.png"));
        assert!(!name_blocked("README.md"));
        // Where mobile and web tooling keeps tokens and keys.
        for secret in [
            "sentry.properties",
            "secrets.properties",
            ".envrc",
            "prod.env",
            "serviceAccountKey.json",
            "play-store-credentials.json",
            "credentials.json",
            "client_secret_123.apps.googleusercontent.com.json",
            "Secrets.plist",
            "id.ppk",
            ".env.local",
            "service-account.json",
            "app-firebase-adminsdk-1a2b.json",
            "key.properties",
        ] {
            assert!(name_blocked(secret), "{secret}");
        }
        for plain in ["environment.ts", "envoy.yaml", "Info.plist", "strings.xml", "credentials.md"] {
            assert!(!name_blocked(plain), "{plain}");
        }
    }

    #[test]
    fn a_folder_inside_home_passes() {
        let home = sandbox("ok");
        let app = home.join("code").join("Marbly");
        std::fs::create_dir_all(&app).unwrap();
        let granted = validate_project_folder(app.to_str().unwrap(), &rules_with_home(&home)).unwrap();
        assert!(same_path(&granted, &app));
        assert!(granted.is_dir());
        assert!(!granted.to_string_lossy().starts_with(r"\\?\"), "no verbatim prefix");
        // Inside Documents is fine, only Documents itself is too much.
        let inside = home.join("Documents").join("Marbly");
        std::fs::create_dir_all(&inside).unwrap();
        assert!(validate_project_folder(inside.to_str().unwrap(), &rules_with_home(&home)).is_ok());
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn roots_home_and_above_are_refused() {
        let home = sandbox("home");
        let rules = rules_with_home(&home);
        let root = if cfg!(windows) { r"C:\" } else { "/" };
        assert_eq!(refusal(validate_project_folder(root, &rules)), WHOLE_DRIVE);
        assert_eq!(refusal(validate_project_folder(home.to_str().unwrap(), &rules)), WHOLE_HOME);
        let above = home.parent().unwrap();
        assert_eq!(refusal(validate_project_folder(above.to_str().unwrap(), &rules)), WHOLE_HOME);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn whole_home_folders_are_refused() {
        let home = sandbox("broad");
        let rules = rules_with_home(&home);
        for name in ["Documents", "Desktop", "Downloads", "Pictures", "Movies", "Music", "Videos", "OneDrive - Personal"] {
            let dir = home.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            assert_eq!(refusal(validate_project_folder(dir.to_str().unwrap(), &rules)), TOO_BROAD, "{name}");
        }
        let backed_up = home.join("OneDrive").join("Documents");
        std::fs::create_dir_all(&backed_up).unwrap();
        assert_eq!(refusal(validate_project_folder(backed_up.to_str().unwrap(), &rules)), TOO_BROAD);
        // Where the OS says Documents is, wherever that is.
        let elsewhere = home.join("elsewhere").join("MyDocs");
        std::fs::create_dir_all(&elsewhere).unwrap();
        let rules = FolderRules { broad: vec![elsewhere.clone()], ..rules_with_home(&home) };
        assert_eq!(refusal(validate_project_folder(elsewhere.to_str().unwrap(), &rules)), TOO_BROAD);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_folder_holding_a_known_folder_outside_home_is_refused() {
        // Documents moved to another drive with Windows' Location tab.
        let base = sandbox("moved-docs");
        let home = base.join("C").join("Users").join("me");
        let user = base.join("D").join("Users").join("me");
        let documents = user.join("Documents");
        let app = documents.join("code").join("Marbly");
        let beside = user.join("code").join("Marbly");
        for dir in [&home, &app, &beside] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let rules = FolderRules { broad: vec![documents.clone()], ..rules_with_home(&home) };
        for whole in [&documents, &user, &base.join("D").join("Users")] {
            assert_eq!(refusal(validate_project_folder(whole.to_str().unwrap(), &rules)), TOO_BROAD, "{}", whole.display());
        }
        assert!(validate_project_folder(app.to_str().unwrap(), &rules).is_ok());
        assert!(validate_project_folder(beside.to_str().unwrap(), &rules).is_ok());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_home_inside_a_system_folder_keeps_its_code_folders() {
        // Fedora Atomic keeps homes in /var/home, and /var is a system folder.
        let base = sandbox("var-home");
        let var = base.join("var");
        let home = var.join("home").join("me");
        let app = home.join("code").join("Marbly");
        let sibling = var.join("lib").join("x");
        let dot = home.join(".ssh");
        for dir in [&app, &sibling, &dot] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let rules = FolderRules { private: vec![var.clone()], ..rules_with_home(&home) };
        assert!(validate_project_folder(app.to_str().unwrap(), &rules).is_ok());
        // The rest of /var, and what the home rules refuse, stay out.
        assert_eq!(refusal(validate_project_folder(sibling.to_str().unwrap(), &rules)), PRIVATE);
        assert_eq!(refusal(validate_project_folder(dot.to_str().unwrap(), &rules)), PRIVATE);
        assert_eq!(refusal(validate_project_folder(home.to_str().unwrap(), &rules)), WHOLE_HOME);
        assert_eq!(refusal(validate_project_folder(var.to_str().unwrap(), &rules)), WHOLE_HOME);
        // A private folder inside home is still private (~/AppData, ~/Library).
        let data = home.join("AppData");
        std::fs::create_dir_all(data.join("Local")).unwrap();
        let rules = FolderRules { private: vec![var.clone(), data.clone()], ..rules_with_home(&home) };
        assert_eq!(refusal(validate_project_folder(data.join("Local").to_str().unwrap(), &rules)), PRIVATE);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn cloud_drives_in_the_mac_library() {
        let library = Path::new("/Users/me/Library");
        let at = |rest: &str| cloud_drive(&library.join(rest), library);
        assert_eq!(at("CloudStorage/Dropbox/code/Marbly"), Cloud::Inside);
        assert_eq!(at("CloudStorage/GoogleDrive-me@example.com/My Drive"), Cloud::Inside);
        assert_eq!(at("CloudStorage/OneDrive-Personal/Documents/app"), Cloud::Inside);
        assert_eq!(at("Mobile Documents/com~apple~CloudDocs/Marbly"), Cloud::Inside);
        // A whole drive, and a whole Documents or Desktop at the top of one.
        assert_eq!(at("CloudStorage/Dropbox"), Cloud::Whole);
        assert_eq!(at("Mobile Documents/com~apple~CloudDocs"), Cloud::Whole);
        assert_eq!(at("Mobile Documents/com~apple~CloudDocs/Documents"), Cloud::Whole);
        assert_eq!(at("CloudStorage/OneDrive-Personal/Desktop"), Cloud::Whole);
        // Everything else in ~/Library.
        for rest in ["", "CloudStorage", "Mobile Documents", "Mobile Documents/com~apple~Pages/Documents", "Caches/x", "Application Support/app"] {
            assert_eq!(at(rest), Cloud::Outside, "{rest}");
        }
        assert_eq!(cloud_drive(Path::new("/Users/me/code/app"), library), Cloud::Outside);

        // The same rule inside validate_project_folder, which gets a library
        // from FolderRules::new on macOS only.
        let home = sandbox("cloud");
        let library = home.join("Library");
        let dropbox = library.join("CloudStorage").join("Dropbox");
        let icloud = library.join("Mobile Documents").join("com~apple~CloudDocs");
        let caches = library.join("Caches").join("app");
        for dir in [&dropbox.join("code").join("Marbly"), &icloud.join("Marbly"), &caches] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let rules = FolderRules { private: vec![library.clone()], library: Some(library.clone()), ..rules_with_home(&home) };
        let check = |dir: &Path| validate_project_folder(dir.to_str().unwrap(), &rules);
        assert!(check(&dropbox.join("code").join("Marbly")).is_ok());
        assert!(check(&dropbox.join("code")).is_ok());
        assert!(check(&icloud.join("Marbly")).is_ok());
        assert_eq!(refusal(check(&dropbox)), TOO_BROAD);
        assert_eq!(refusal(check(&icloud)), TOO_BROAD);
        assert_eq!(refusal(check(&library.join("CloudStorage"))), PRIVATE);
        assert_eq!(refusal(check(&caches)), PRIVATE);
        assert_eq!(refusal(check(&library)), PRIVATE);
        // Without a library, as on Windows and Linux, all of it is private.
        let elsewhere = FolderRules { library: None, ..rules };
        assert_eq!(refusal(validate_project_folder(dropbox.join("code").to_str().unwrap(), &elsewhere)), PRIVATE);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn dot_folders_and_app_folders_are_refused() {
        let home = sandbox("dots");
        let rules = rules_with_home(&home);
        for dir in [home.join(".ssh"), home.join(".config").join("gh"), home.join(".claude").join("projects")] {
            std::fs::create_dir_all(&dir).unwrap();
            assert_eq!(refusal(validate_project_folder(dir.to_str().unwrap(), &rules)), PRIVATE, "{}", dir.display());
        }
        // A dot folder deeper down is the app's own business.
        let deeper = home.join("code").join("app").join(".github");
        std::fs::create_dir_all(&deeper).unwrap();
        assert!(validate_project_folder(deeper.to_str().unwrap(), &rules).is_ok());

        let data = home.join("appdata").join("com.example.app");
        std::fs::create_dir_all(data.join("claude-agent")).unwrap();
        let rules = FolderRules { private: vec![data.clone()], ..rules_with_home(&home) };
        let inside = data.join("claude-agent");
        assert_eq!(refusal(validate_project_folder(inside.to_str().unwrap(), &rules)), PRIVATE);
        let holding = home.join("appdata");
        assert_eq!(refusal(validate_project_folder(holding.to_str().unwrap(), &rules)), PRIVATE);
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn temp_and_system_folders_are_refused() {
        let rules = FolderRules::new(None, Vec::new(), Vec::new());
        // The live check's fixture cannot sit in the temp folder, on purpose.
        let temp = sandbox("temp");
        let inside = temp.join("app");
        std::fs::create_dir_all(&inside).unwrap();
        assert_eq!(refusal(validate_project_folder(inside.to_str().unwrap(), &rules)), PRIVATE);
        let system: &[&str] = if cfg!(windows) {
            &[r"C:\Windows", r"C:\Windows\System32", r"C:\Program Files"]
        } else {
            &["/usr/bin", "/etc"]
        };
        for dir in system {
            if Path::new(dir).is_dir() {
                assert_eq!(refusal(validate_project_folder(dir, &rules)), PRIVATE, "{dir}");
            }
        }
        let _ = std::fs::remove_dir_all(&temp);
    }

    #[test]
    fn files_relative_paths_and_odd_characters_are_refused() {
        let home = sandbox("odd");
        let rules = rules_with_home(&home);
        let file = home.join("code").join("notes.txt");
        touch(&file, b"x");
        assert_eq!(refusal(validate_project_folder(file.to_str().unwrap(), &rules)), NOT_ADDED);
        assert_eq!(refusal(validate_project_folder("code/app", &rules)), NOT_ADDED);
        assert_eq!(refusal(validate_project_folder("", &rules)), NOT_ADDED);
        let missing = home.join("code").join("gone");
        assert_eq!(refusal(validate_project_folder(missing.to_str().unwrap(), &rules)), NOT_ADDED);
        let control = format!("{}\nsecond line", home.join("code").display());
        assert_eq!(refusal(validate_project_folder(&control, &rules)), NOT_ADDED);
        let separator = format!("{}\u{2028}x", home.join("code").display());
        assert_eq!(refusal(validate_project_folder(&separator, &rules)), NOT_ADDED);
        // Names Claude Code would refuse every read under.
        let tilde = home.join("code").join("react~18-demo");
        std::fs::create_dir_all(tilde.join("src")).unwrap();
        assert_eq!(refusal(validate_project_folder(tilde.to_str().unwrap(), &rules)), UNREADABLE_NAME);
        assert_eq!(refusal(validate_project_folder(tilde.join("src").to_str().unwrap(), &rules)), UNREADABLE_NAME);
        let fine = home.join("code").join("app~x");
        std::fs::create_dir_all(&fine).unwrap();
        assert!(validate_project_folder(fine.to_str().unwrap(), &rules).is_ok());
        // Windows drops a trailing dot or space when it makes a folder.
        #[cfg(unix)]
        {
            for name in ["My App ", "app.", "..."] {
                let odd = home.join("code").join(name);
                std::fs::create_dir_all(&odd).unwrap();
                assert_eq!(refusal(validate_project_folder(odd.to_str().unwrap(), &rules)), UNREADABLE_NAME, "{name:?}");
            }
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn paths_claude_code_distrusts() {
        for odd in [
            r"C:\code\react~18-demo",
            r"C:\PROGRA~1\app",
            "/home/me/code/My App ",
            "/home/me/code/app.",
            "/home/me/.../app",
            "/home/me/code/app\u{feff}",
            "/home/me/code/app\u{a0}/src",
        ] {
            assert!(path_claude_code_refuses(Path::new(odd)), "{odd:?}");
        }
        for fine in ["/home/me/code/app", "/home/me/code/my.app/src", "/home/me/code/app~x", "/home/me/~/x", "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/app"] {
            assert!(!path_claude_code_refuses(Path::new(fine)), "{fine:?}");
        }
    }

    #[test]
    fn mounted_drives_are_told_apart_by_device() {
        assert!(mounted_under(Path::new("/Volumes"), 2, 1));
        assert!(mounted_under(Path::new("/media/me"), 2, 1));
        assert!(mounted_under(Path::new("/run/media/me"), 2, 1));
        assert!(mounted_under(Path::new("/mnt"), 2, 1));
        // The same device, or a device of its own somewhere else (a btrfs
        // subvolume holding a repo).
        assert!(!mounted_under(Path::new("/Volumes"), 1, 1));
        assert!(!mounted_under(Path::new("/home/me/code"), 2, 1));
        assert!(!mounted_under(Path::new("/Volumes/USB/code"), 2, 1));
    }

    #[test]
    fn a_path_the_deny_rules_would_empty_is_refused() {
        let home = sandbox("blocked");
        let rules = rules_with_home(&home);
        let under_build = home.join("build").join("MyApp");
        std::fs::create_dir_all(&under_build).unwrap();
        let message = refusal(validate_project_folder(under_build.to_str().unwrap(), &rules));
        assert!(message.starts_with("That folder is inside build,"), "{message}");
        let modules = home.join("code").join("node_modules");
        std::fs::create_dir_all(&modules).unwrap();
        let message = refusal(validate_project_folder(modules.to_str().unwrap(), &rules));
        assert!(message.starts_with("The agent never reads a folder named node_modules"), "{message}");
        let pods = home.join("code").join("Pods");
        std::fs::create_dir_all(&pods).unwrap();
        assert!(validate_project_folder(pods.to_str().unwrap(), &rules).is_err());
        for message in [
            blocked_refusal("build", false).0,
            blocked_refusal("node_modules", true).0,
            NOT_ADDED.into(),
            NETWORK_DRIVE.into(),
            WHOLE_DRIVE.into(),
            WHOLE_HOME.into(),
            TOO_BROAD.into(),
            PRIVATE.into(),
            UNREADABLE_NAME.into(),
        ] {
            assert!(!message.contains(['\u{2013}', '\u{2014}']), "no dashes: {message}");
            assert!(!message.ends_with('.'), "no trailing period: {message}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn windows_prefixes() {
        assert_eq!(strip_verbatim_drive(r"\\?\C:\Users\me\app"), Some(r"C:\Users\me\app"));
        assert_eq!(strip_verbatim_drive(r"\\?\d:\"), Some(r"d:\"));
        assert_eq!(strip_verbatim_drive(r"\\?\UNC\server\share"), None);
        assert_eq!(strip_verbatim_drive(r"C:\Users"), None);
        assert_eq!(windows_special_path(r"\\?\UNC\server\share\app"), Some(NETWORK_DRIVE));
        assert_eq!(windows_special_path(r"\\server\share\app"), Some(NETWORK_DRIVE));
        assert_eq!(windows_special_path("//server/share/app"), Some(NETWORK_DRIVE));
        assert_eq!(windows_special_path(r"\\?\Volume{0a1b2c3d-0000-0000-0000-000000000000}\app"), Some(NOT_ADDED));
        assert_eq!(windows_special_path(r"\\.\PhysicalDrive0"), Some(NOT_ADDED));
        assert_eq!(windows_special_path(r"\\?\C:\app"), None);
        assert_eq!(windows_special_path(r"C:\app"), None);
        #[cfg(windows)]
        {
            assert_eq!(plain(PathBuf::from(r"\\?\C:\x")), PathBuf::from(r"C:\x"));
            assert_eq!(plain(PathBuf::from(r"\\?\UNC\s\x")), PathBuf::from(r"\\?\UNC\s\x"));
            let real = canonical(&std::env::temp_dir()).unwrap();
            assert!(!real.to_string_lossy().starts_with(r"\\?\"));
            let rules = rules_with_home(Path::new(r"C:\Users\nobody-here"));
            assert_eq!(refusal(validate_project_folder(r"\\server\share\app", &rules)), NETWORK_DRIVE);
        }
    }

    #[test]
    fn paths_compare_by_component() {
        assert!(is_inside(Path::new("/a/b/c"), Path::new("/a/b")));
        assert!(is_inside(Path::new("/a/b"), Path::new("/a/b")));
        assert!(!is_inside(Path::new("/a/bc"), Path::new("/a/b")));
        assert!(!is_inside(Path::new("/a"), Path::new("/a/b")));
        if cfg!(any(windows, target_os = "macos")) {
            assert!(same_path(Path::new("/Users/Me/App"), Path::new("/users/me/app")));
        } else {
            assert!(!same_path(Path::new("/home/Me/App"), Path::new("/home/me/app")));
        }
    }

    #[test]
    fn the_grant_book_remembers_picks() {
        let dir = sandbox("book");
        let file = dir.join("claude-agent").join(GRANT_BOOK);
        assert_eq!(GrantBook::load(&file), GrantBook::default());

        let a = dir.join("a");
        let b = dir.join("b");
        let mut book = GrantBook::default();
        book.grant(&a, "a", 1);
        book.grant(&b, "b", 2);
        book.grant(&a, "a", 3);
        assert_eq!(book.folders.iter().map(|g| g.name.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(book.newest().unwrap().picked_at, 3);
        assert!(book.holds(&a) && book.holds(&b));
        assert!(!book.holds(&dir.join("c")));
        if cfg!(any(windows, target_os = "macos")) {
            let shouted = PathBuf::from(a.to_string_lossy().to_uppercase());
            assert!(book.holds(&shouted));
            book.grant(&shouted, "A", 4);
            assert_eq!(book.folders.len(), 2, "one entry per folder, whatever the case");
        }

        book.save(&file).unwrap();
        let text = std::fs::read_to_string(&file).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["v"], 1);
        assert!(value["folders"][0]["pickedAt"].is_u64());
        assert!(value["folders"][0]["path"].is_string());
        assert_eq!(GrantBook::load(&file), book);

        assert!(book.forget(&b));
        assert!(!book.forget(&b));
        assert!(!book.holds(&b));

        for n in 0..(MAX_GRANTS + 5) {
            book.grant(&dir.join(format!("f{n}")), "f", n as u64);
        }
        assert_eq!(book.folders.len(), MAX_GRANTS);
        assert_eq!(book.newest().unwrap().path, dir.join(format!("f{}", MAX_GRANTS + 4)).to_string_lossy());

        std::fs::write(&file, b"{not json").unwrap();
        assert_eq!(GrantBook::load(&file), GrantBook::default());
        std::fs::write(&file, br#"{"v":2,"folders":[{"path":"/x","name":"x","pickedAt":1}]}"#).unwrap();
        assert_eq!(GrantBook::load(&file), GrantBook::default());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            book.save(&file).unwrap();
            assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deny_rules_cover_every_pattern_both_ways() {
        let rules = deny_rules(None);
        for pattern in SECRET_FILES.iter().chain(NOISE_FILES) {
            assert!(rules.contains(&format!("Read(**/{pattern})")), "{pattern}");
            assert!(rules.contains(&format!("Read(//**/{pattern})")), "{pattern}");
        }
        for dir in SECRET_DIRS.iter().chain(NOISE_DIRS) {
            for rule in [
                format!("Read(**/{dir})"),
                format!("Read(//**/{dir})"),
                format!("Read(**/{dir}/**)"),
                format!("Read(//**/{dir}/**)"),
            ] {
                assert!(rules.contains(&rule), "{rule}");
            }
        }
        assert!(rules.contains(&"Read(~/.claude)".to_string()));
        assert!(rules.contains(&"Read(~/.claude/**)".to_string()));
        assert!(rules.contains(&"Read(~/.claude.json)".to_string()));
        // 46 secret and 9 noise file patterns twice, 15 folders four times,
        // and the three for Claude Code's own files. The forms were
        // live-verified on Claude Code 2.1.202 and 2.1.285.
        assert_eq!(rules.len(), 173);
        assert_eq!(rules.len(), rules.iter().collect::<std::collections::HashSet<_>>().len(), "no repeats");
        for rule in &rules {
            assert!(rule.starts_with("Read(") && rule.ends_with(')'), "{rule}");
            assert!(!rule.contains("Glob") && !rule.contains(':'), "{rule}");
        }
        // The secrets a mobile repo keeps.
        for secret in ["*.p8", "*.jks", "key.properties", "google-services.json", "GoogleService-Info.plist", "*.xcconfig"] {
            assert!(SECRET_FILES.contains(&secret), "{secret}");
        }
    }

    #[test]
    fn a_moved_config_folder_is_denied_too() {
        let base = if cfg!(windows) { PathBuf::from(r"C:\nowhere-osg") } else { PathBuf::from("/nowhere-osg") };
        let dir = base.join("cfg [a]*?!#");
        let rules = deny_rules(Some(&dir));
        assert_eq!(rules.len(), 175);
        let expected = if cfg!(windows) {
            r"//c/nowhere-osg/cfg \[a\]\*\?\!\#"
        } else {
            r"//nowhere-osg/cfg \[a\]\*\?\!\#"
        };
        assert_eq!(rules[173], format!("Read({expected})"));
        assert_eq!(rules[174], format!("Read({expected}/**)"));
        assert_eq!(escape_rule_name(r"a\b"), r"a\\\\b");
        // A relative one says nothing about where the folder is.
        assert_eq!(deny_rules(Some(Path::new("cfg"))).len(), 173);
    }

    #[test]
    fn settings_file_shape() {
        let folders = if cfg!(windows) {
            vec![PathBuf::from(r"C:\code\Marbly")]
        } else {
            vec![PathBuf::from("/home/me/code/Marbly")]
        };
        let deny = vec!["Read(**/.env)".to_string(), "Read(//**/.env)".to_string()];
        let bytes = settings_json(&folders, &deny).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        let folder = serde_json::to_string(folders[0].to_str().unwrap()).unwrap();
        assert_eq!(
            text,
            format!(
                r#"{{"disableAllHooks":true,"permissions":{{"additionalDirectories":[{folder}],"deny":["Read(**/.env)","Read(//**/.env)"],"blockReadsOutsideWorkingDirectories":true}}}}"#
            )
        );
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(value["permissions"].get("allow").is_none(), "no allow list at all");
        assert!(value.get("enabledPlugins").is_none());
    }

    fn map_of(root: &Path, limits: &MapLimits) -> String {
        folders_section(&[root.to_path_buf()], limits)
    }

    fn list_in<'a>(map: &'a str, title: &str) -> Vec<&'a str> {
        let mut lines = map.lines().skip_while(|line| !line.starts_with(title)).skip(1);
        let mut out = Vec::new();
        for line in lines.by_ref() {
            if let Some(item) = line.strip_prefix("- ") {
                out.push(item);
            } else {
                if line == MORE {
                    out.push(MORE);
                }
                break;
            }
        }
        out
    }

    #[test]
    fn the_map_lists_what_the_agent_needs() {
        let root = sandbox("map").join("Marbly");
        touch(&root.join("README.md"), b"Marbly");
        touch(&root.join("package.json"), b"{}");
        touch(&root.join("assets").join("icon.png"), b"png");
        touch(&root.join("assets").join("hero.jpg"), b"jpg");
        touch(&root.join("fastlane").join("screenshots").join("en-US").join("1.png"), b"png");
        touch(&root.join("ios").join("App").join("Assets.xcassets").join("AppIcon.appiconset").join("Contents.json"), b"{}");
        touch(&root.join("ios").join("App").join("Assets.xcassets").join("AccentColor.colorset").join("Contents.json"), b"{}");
        touch(&root.join("android").join("app").join("src").join("main").join("res").join("values").join("strings.xml"), b"<r/>");
        touch(&root.join("fastlane").join("metadata").join("en-US").join("name.txt"), b"Marbly");
        touch(&root.join("fastlane").join("metadata").join("de-DE").join("name.txt"), b"Marbly");
        // Left out: hidden, secret, dependency and build names.
        touch(&root.join(".env"), b"SECRET=1");
        touch(&root.join(".github").join("logo.png"), b"png");
        touch(&root.join("node_modules").join("pkg").join("logo.png"), b"png");
        touch(&root.join("android").join("app").join("build").join("icon.png"), b"png");
        touch(&root.join("keys").join("server.pem"), b"x");
        touch(&root.join("package-lock.json"), b"{}");

        let map = map_of(&root, &MAP_LIMITS);
        assert!(map.starts_with("# Your folders\n\n## Marbly\nPath: "), "{map}");
        assert!(map.contains(&format!("Path: {}", root.display())));
        let top = list_in(&map, "Top level:");
        assert_eq!(top, ["android/", "assets/", "fastlane/", "ios/", "keys/", "package.json", "README.md"]);
        let pictures = list_in(&map, "Pictures:");
        assert_eq!(pictures, ["assets/icon.png", "fastlane/screenshots/en-US/1.png", "assets/hero.jpg"]);
        let useful = list_in(&map, "Useful files:");
        assert_eq!(useful[..2], ["package.json", "README.md"]);
        assert!(useful.contains(&"ios/App/Assets.xcassets/AppIcon.appiconset/Contents.json"));
        assert!(useful.contains(&"ios/App/Assets.xcassets/AccentColor.colorset/Contents.json"));
        assert!(useful.contains(&"android/app/src/main/res/values/strings.xml"));
        assert!(useful.contains(&"fastlane/metadata/en-US/name.txt"));
        assert!(!useful.contains(&"fastlane/metadata/de-DE/name.txt"), "one store text per name, the default language's");
        for hidden in [".env", ".github", "node_modules", "build/", "server.pem", "package-lock.json"] {
            assert!(!map.contains(hidden), "{hidden} is on the map");
        }
        // Leaving the German name.txt out counts as cutting the list short.
        assert_eq!(useful.last(), Some(&MORE));
        assert_eq!(map.matches(MORE).count(), 1);
        for item in top.iter().chain(&pictures).chain(&useful) {
            assert!(!item.contains('\\'), "forward slashes only: {item}");
        }
        let _ = std::fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn the_map_keeps_to_its_limits() {
        let root = sandbox("map-caps").join("Big");
        for n in 0..45 {
            touch(&root.join(format!("file{n:02}.txt")), b"x");
        }
        for n in 0..70 {
            touch(&root.join("shots").join(format!("shot{n:02}.png")), b"png");
        }
        touch(&root.join("brand").join("logo.svg"), b"<svg/>");
        let deep = (1..=9).fold(root.join("deep"), |dir, n| dir.join(format!("d{n}")));
        touch(&deep.join("buried.png"), b"png");

        let map = map_of(&root, &MAP_LIMITS);
        let top = list_in(&map, "Top level:");
        assert_eq!(top.len(), 41);
        assert_eq!(top[..3], ["brand/", "deep/", "shots/"]);
        assert_eq!(top.last(), Some(&MORE));
        let pictures = list_in(&map, "Pictures:");
        assert_eq!(pictures.len(), 61);
        assert_eq!(pictures[0], "brand/logo.svg", "the logo beats 70 screenshots");
        assert_eq!(pictures.last(), Some(&MORE));
        assert!(!map.contains("buried.png"), "past the depth limit");

        // A tiny entry budget cuts the walk, and the lists say so.
        let tight = MapLimits { entries: 5, ..MAP_LIMITS };
        let map = map_of(&root, &tight);
        assert_eq!(list_in(&map, "Pictures:"), [MORE]);

        // A section never runs past its cap.
        let small = MapLimits { section_chars: 400, ..MAP_LIMITS };
        let map = map_of(&root, &small);
        let section = map.trim_start_matches("# Your folders\n\n").trim_end();
        assert!(section.len() <= 400, "{}", section.len());
        assert!(section.ends_with(MORE));
        let _ = std::fs::remove_dir_all(root.parent().unwrap());
    }

    #[test]
    fn an_empty_folder_and_two_folders_of_one_name() {
        let base = sandbox("map-names");
        let ios = base.join("ios").join("app");
        let android = base.join("android").join("app");
        std::fs::create_dir_all(&ios).unwrap();
        touch(&android.join("icon.png"), b"png");
        let map = folders_section(&[android.clone(), ios.clone()], &MAP_LIMITS);
        assert!(map.contains("## android/app\n"));
        assert!(map.contains("## ios/app\n"));
        assert!(map.contains("Top level: none\nPictures: none\nUseful files: none"));
        assert_eq!(folder_labels(&[base.join("one")]), ["one"]);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn the_map_follows_no_link_and_lists_no_odd_name() {
        let base = sandbox("map-links");
        let root = base.join("app");
        let outside = base.join("outside");
        touch(&outside.join("secret.png"), b"png");
        std::fs::create_dir_all(&root).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linked")).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.png"), root.join("icon.png")).unwrap();
        touch(&root.join("bad\nname.png"), b"png");
        let map = map_of(&root, &MAP_LIMITS);
        assert!(!map.contains("linked"));
        assert!(!map.contains("secret.png"));
        assert!(!map.contains("icon.png"));
        assert!(!map.contains("bad"));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn picture_import_checks() {
        let base = sandbox("images");
        let root = base.join("app");
        let icon = root.join("assets").join("Icon.PNG");
        touch(&icon, b"png");
        touch(&root.join("assets").join("notes.txt"), b"x");
        touch(&root.join("node_modules").join("pkg").join("logo.png"), b"png");
        touch(&root.join("keys").join("x.png"), b"png");
        touch(&base.join("outside").join("secret.png"), b"png");
        std::fs::create_dir_all(root.join("folder.png")).unwrap();
        let roots = vec![root.clone()];
        let path = |p: &Path| p.to_str().unwrap().to_string();

        assert_eq!(project_image_path(&path(&icon), &[]), Err(IMAGE_NO_FOLDER));
        let found = project_image_path(&path(&icon), &roots).unwrap();
        assert!(same_path(&found, &icon));
        assert_eq!(read_project_image(&found).unwrap(), b"png");
        assert!(project_image_path(&path(&root.join("keys").join("x.png")), &roots).is_ok());
        assert_eq!(project_image_path(&path(&root.join("assets").join("notes.txt")), &roots), Err(IMAGE_KIND));
        assert_eq!(project_image_path(&path(&root.join("folder.png")), &roots), Err(IMAGE_KIND));
        assert_eq!(
            project_image_path(&path(&root.join("node_modules").join("pkg").join("logo.png")), &roots),
            Err(IMAGE_PRIVATE)
        );
        assert_eq!(project_image_path(&path(&base.join("outside").join("secret.png")), &roots), Err(IMAGE_OUTSIDE));
        let climbing = root.join("..").join("outside").join("secret.png");
        assert_eq!(project_image_path(&path(&climbing), &roots), Err(IMAGE_OUTSIDE));
        assert_eq!(project_image_path(&path(&root.join("gone.png")), &roots), Err(IMAGE_MISSING));
        assert_eq!(project_image_path(&path(&base.join("outside").join("gone.png")), &roots), Err(IMAGE_OUTSIDE));
        assert_eq!(project_image_path("assets/icon.png", &roots), Err(IMAGE_OUTSIDE));
        assert_eq!(project_image_path("", &roots), Err(IMAGE_OUTSIDE));

        let big = root.join("big.png");
        std::fs::File::create(&big).unwrap().set_len(MAX_IMAGE_BYTES + 1).unwrap();
        assert_eq!(project_image_path(&path(&big), &roots), Err(IMAGE_TOO_BIG));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(base.join("outside").join("secret.png"), root.join("link.png")).unwrap();
            assert_eq!(project_image_path(&path(&root.join("link.png")), &roots), Err(IMAGE_OUTSIDE));
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A link at `link` to the folder `target`, which may not exist: a
    /// junction on Windows, which needs no special rights. False when this
    /// system will not make one.
    #[cfg(windows)]
    fn link_folder(target: &Path, link: &Path) -> bool {
        std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    #[cfg(unix)]
    fn link_folder(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    /// A link at `link` to the file `target`, which may not exist. Windows
    /// makes one only in Developer Mode or for an administrator.
    #[cfg(windows)]
    fn link_file(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }

    #[cfg(unix)]
    fn link_file(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[test]
    fn a_missing_picture_says_nothing_about_files_outside() {
        let base = sandbox("image-links");
        let root = base.join("app");
        let outside = base.join("outside");
        std::fs::create_dir_all(&root).unwrap();
        touch(&outside.join("secret.png"), b"png");
        let roots = vec![root.clone()];
        let ask = |path: &Path| project_image_path(path.to_str().unwrap(), &roots);

        // Missing inside the folder is missing.
        assert_eq!(ask(&root.join("gone.png")), Err(IMAGE_MISSING));
        assert_eq!(ask(&root.join("new").join("gone.png")), Err(IMAGE_MISSING));
        // A folder link that leads outside: one answer whether the file there
        // exists or not.
        assert!(link_folder(&outside, &root.join("linked")), "a folder link");
        assert_eq!(ask(&root.join("linked").join("secret.png")), Err(IMAGE_OUTSIDE));
        assert_eq!(ask(&root.join("linked").join("nope.png")), Err(IMAGE_OUTSIDE));
        // A folder link to nowhere, before and after its target appears.
        assert!(link_folder(&base.join("later"), &root.join("later")), "a dangling folder link");
        assert_eq!(ask(&root.join("later").join("x.png")), Err(IMAGE_OUTSIDE));
        touch(&base.join("later").join("x.png"), b"png");
        assert_eq!(ask(&root.join("later").join("x.png")), Err(IMAGE_OUTSIDE));
        // A file link to nowhere, the same.
        if link_file(&outside.join("key.png"), &root.join("a.png")) {
            assert_eq!(ask(&root.join("a.png")), Err(IMAGE_OUTSIDE));
            touch(&outside.join("key.png"), b"png");
            assert_eq!(ask(&root.join("a.png")), Err(IMAGE_OUTSIDE));
        } else {
            eprintln!("skipped the file link: this system makes none without more rights");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn exports_stay_out_of_live_folders() {
        let base = sandbox("exports");
        let root = base.join("app");
        std::fs::create_dir_all(root.join("fastlane")).unwrap();
        std::fs::create_dir_all(base.join("Downloads")).unwrap();
        let roots = vec![root.clone()];

        assert_eq!(export_directory_problem(Path::new("exports"), &roots), Some(EXPORT_NOT_ABSOLUTE));
        assert_eq!(export_directory_problem(Path::new("exports"), &[]), Some(EXPORT_NOT_ABSOLUTE));
        let climbing = base.join("Downloads").join("..").join("app").join("res");
        assert_eq!(export_directory_problem(&climbing, &[]), Some(EXPORT_NOT_ABSOLUTE));
        assert_eq!(export_directory_problem(&climbing, &roots), Some(EXPORT_NOT_ABSOLUTE));

        assert_eq!(export_directory_problem(&root, &roots), Some(EXPORT_INSIDE_FOLDER));
        assert_eq!(export_directory_problem(&root.join("fastlane"), &roots), Some(EXPORT_INSIDE_FOLDER));
        // Not there yet: its deepest existing ancestor decides.
        let deeper = root.join("fastlane").join("screenshots").join("en-US");
        assert_eq!(export_directory_problem(&deeper, &roots), Some(EXPORT_INSIDE_FOLDER));
        if cfg!(any(windows, target_os = "macos")) {
            let shouted = PathBuf::from(root.join("new").to_string_lossy().to_uppercase());
            assert_eq!(export_directory_problem(&shouted, &roots), Some(EXPORT_INSIDE_FOLDER));
        }
        assert_eq!(export_directory_problem(&base.join("Downloads").join("Open Screenshot Generator"), &roots), None);
        assert_eq!(export_directory_problem(&root, &[]), None);
        #[cfg(windows)]
        {
            // An admin share of the local drive leads into the folder too.
            let share = format!(r"\\localhost\{}", root.to_string_lossy().replacen(':', "$", 1));
            assert_eq!(export_directory_problem(Path::new(&share), &roots), Some(EXPORT_NETWORK));
            assert_eq!(export_directory_problem(Path::new(r"\\.\C:\x"), &roots), Some(EXPORT_NETWORK));
            assert_eq!(export_directory_problem(Path::new(&share), &[]), None);
            let verbatim = format!(r"\\?\{}", root.join("res").to_string_lossy());
            assert_eq!(export_directory_problem(Path::new(&verbatim), &roots), Some(EXPORT_INSIDE_FOLDER));
        }
        #[cfg(unix)]
        {
            let link = base.join("Downloads").join("shortcut");
            std::os::unix::fs::symlink(&root, &link).unwrap();
            assert_eq!(export_directory_problem(&link.join("res"), &roots), Some(EXPORT_INSIDE_FOLDER));
            // A path that reaches a root without resolving to it, as a bind
            // mount or a firmlink does. The link stands in for one, since
            // root_on_the_way is given it unresolved.
            assert!(root_on_the_way(&link.join("res"), &roots));
            assert!(root_on_the_way(&link, &roots));
            assert!(!root_on_the_way(&base.join("Downloads").join("res"), &roots));
            assert!(!root_on_the_way(&link, &[]));
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn a_resolved_share_path_is_refused() {
        // What a mapped drive or a link to a share of this machine resolves to.
        let roots = if cfg!(windows) { vec![PathBuf::from(r"C:\code\app")] } else { vec![PathBuf::from("/code/app")] };
        if cfg!(windows) {
            let unc = Path::new(r"\\?\UNC\localhost\c$\code\app\ios");
            assert_eq!(resolved_export_problem(unc, &roots), Some(EXPORT_NETWORK));
            let volume = Path::new(r"\\?\Volume{0a1b2c3d-0000-0000-0000-000000000000}\code\app\ios");
            assert_eq!(resolved_export_problem(volume, &roots), Some(EXPORT_NETWORK));
        }
        let inside = roots[0].join("ios");
        assert_eq!(resolved_export_problem(&inside, &roots), Some(EXPORT_INSIDE_FOLDER));
        let elsewhere = roots[0].parent().unwrap().join("exports");
        assert_eq!(resolved_export_problem(&elsewhere, &roots), None);
    }

    /// The link a mapped drive amounts to, end to end: a folder link to the
    /// code folder through the loopback admin share. Skipped where the share
    /// is off or this system makes no such link.
    #[cfg(windows)]
    #[test]
    fn an_export_through_a_share_link_is_refused() {
        let base = sandbox("share-link");
        let root = base.join("app");
        std::fs::create_dir_all(root.join("res")).unwrap();
        let share = PathBuf::from(format!(r"\\localhost\{}", root.to_string_lossy().replacen(':', "$", 1)));
        let link = base.join("alias");
        if share.is_dir() && std::os::windows::fs::symlink_dir(&share, &link).is_ok() {
            let roots = vec![root.clone()];
            assert_eq!(export_directory_problem(&link.join("res"), &roots), Some(EXPORT_NETWORK));
            assert_eq!(export_directory_problem(&link.join("new").join("deeper"), &roots), Some(EXPORT_NETWORK));
            assert_eq!(export_directory_problem(&link.join("res"), &[]), None);
        } else {
            eprintln!("skipped: no loopback share, or no right to make a folder link to it");
        }
        let _ = std::fs::remove_dir_all(&base);
    }
}
