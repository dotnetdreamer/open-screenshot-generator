//! The app icon export's two ways onto the user's disk besides a zip
//! (src/lib/appIcon/projectWrite.ts):
//!
//! - `abs_write_export_files` writes a whole export, folders and all, into a
//!   folder the user picked. The fs plugin cannot: picking a folder widens its
//!   scope to that folder's contents but grants no mkdir (see desktop.ts).
//! - `abs_scan_icon_targets` looks through an app's own project for the places
//!   its icons live: Xcode's `.appiconset` folders and Android's `res` folders,
//!   so the icon can replace the one there.
//! - `abs_write_export_zip` writes the one zip of a desktop "Save as a zip"
//!   where the save dialog said: in full under another name, then renamed over
//!   the old one in one step (`save_zip`), so the zip there is always whole.
//!
//! Both take only a folder the user picked in the native dialog this session:
//! the dialog adds it to the fs plugin's scope (desktop.ts asks it to), and
//! anything else is turned away, so the page can't name a folder of its own.
//! Every path inside it is checked here too, whatever the page sent: plain
//! segments only (no root, no drive, no `.` or `..`, none of the characters
//! Windows reserves), no deeper than the scan looks, ending in one of the file
//! types an icon export writes.
//!
//! A write is all or nothing:
//!
//! 1. Check everything: every path, every byte, that every folder that already
//!    exists on the way is inside the picked folder once links are followed,
//!    and that every icon set or res folder to clean up gets new files in this
//!    same request. The old files step 4 removes are listed here too, so a
//!    folder that can't be looked in stops the write before it starts.
//!    Nothing on disk changes before this passes.
//! 2. Stage: each file goes into a new temporary file beside its place, made
//!    with `create_new`, which refuses anything already at that name (a link
//!    included), so no byte is ever sent through a link. If any file fails,
//!    the temporary files and the folders made for them are removed.
//! 3. Commit: each old file is renamed aside, and its temporary file renamed
//!    into its place. A rename replaces a link where a file goes; it never
//!    writes through one. If any rename fails, every file done so far is put
//!    back as it was.
//! 4. Only then remove what the new files replace: the renamed-aside old files;
//!    in a cleared `.appiconset`, the PNG and JSON files the new set doesn't
//!    have; in an Android `res` folder, other files of a resource just written
//!    (the `.webp` launcher icons Android Studio and Expo make would clash with
//!    new `.png` ones). What can't be removed is reported back.
//!
//! Two writes never run at once over the same folders: one waits for the
//! other, in this app (`WRITING`), in another copy of this build (a lock file
//! in the app's data folder), and in any other build, such as a store build
//! next to a downloaded one (folder_lock.rs: every folder on the way, top
//! down; then any folder another save made on the way while this one waited;
//! and each folder a write makes, before anything goes in it). All of it waits
//! at most 30 s in all. A folder that can't be locked stops the write unchanged.
//!
//! The link checks hold against the project as it is on disk. Another program
//! swapping a folder for a link while a write runs isn't guarded against: it
//! would run as the same user, who can write there anyway.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Runtime};

use crate::folder_lock;
use tauri_plugin_fs::FsExt;

/// What an icon export writes: pictures, Xcode's and Android's descriptions, the .icns, a README.
const ALLOWED_EXTENSIONS: &[&str] = &["png", "json", "xml", "icns", "txt"];
/// How deep and how wide the project scan looks before it stops.
const SCAN_DEPTH: usize = 16;
const SCAN_ENTRIES: usize = 100_000;
/// How many of the folders the scan couldn't look in are named back.
const NOT_LOOKED_IN_NAMED: usize = 20;
/// A file goes at most two segments below a place the scan finds (Android's
/// `mipmap-hdpi/ic_launcher.png`), so the deepest place found is writable.
const MAX_SEGMENTS: usize = SCAN_DEPTH + 2;
/// About 37 Android res folders' worth: room for every flavor of a big app.
const MAX_FILES: usize = 1000;
const MAX_FILE_BYTES: usize = 32 * 1024 * 1024;
/// Files that define an Android resource, by extension. Two of them with one
/// name in one folder break the build ("Duplicate resources").
const ANDROID_RESOURCE_EXTENSIONS: &[&str] = &["png", "webp", "jpg", "jpeg", "gif", "xml"];

/// Folders a project scan never goes into: dependencies, build output, version control.
const SCAN_SKIP: &[&str] = &[
    "node_modules",
    "Pods",
    "build",
    "Build",
    "DerivedData",
    "dist",
    "out",
    "target",
    "vendor",
    "Carthage",
    "intermediates",
    "generated",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    /// Inside the picked folder, with forward slashes.
    path: String,
    data_base64: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    /// Every file written, in full.
    written: Vec<String>,
    /// Old files the new ones replace that couldn't be removed, each with why.
    left_over: Vec<String>,
}

/// One segment of a path the page sent, or why it cannot be one.
fn checked_segment(segment: &str) -> Result<&str, String> {
    if segment.is_empty() || segment == "." || segment == ".." {
        return Err("a path in the export was not a plain folder or file name".to_string());
    }
    let reserved = |c: char| matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control();
    if segment.chars().any(reserved) || segment.ends_with('.') || segment.ends_with(' ') {
        return Err(format!("\"{segment}\" can't be a file or folder name"));
    }
    Ok(segment)
}

/// A path inside the picked folder, segment by segment.
fn relative_path(raw: &str) -> Result<PathBuf, String> {
    let segments: Vec<&str> = raw.split('/').collect();
    if segments.len() > MAX_SEGMENTS {
        return Err("a path in the export was nested too deep".to_string());
    }
    let mut path = PathBuf::new();
    for segment in segments {
        path.push(checked_segment(segment)?);
    }
    Ok(path)
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

/// A file path, which must also end in one of `allowed`.
fn relative_file(raw: &str, allowed: &[&str]) -> Result<PathBuf, String> {
    let path = relative_path(raw)?;
    let extension = extension_of(&path);
    if !allowed.contains(&extension.as_str()) {
        return Err(format!("an icon export doesn't write .{extension} files"));
    }
    Ok(path)
}

fn picked_folder(directory: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(directory.trim());
    if root.as_os_str().is_empty() || !root.is_absolute() {
        return Err("no folder was picked".to_string());
    }
    if !root.is_dir() {
        return Err("The folder you picked isn't there any more. Pick the folder again.".to_string());
    }
    root.canonicalize().map_err(|e| format!("The folder you picked can't be opened, because {}.", because(&e)))
}

/// The folder `dir`, or the nearest one above it that exists already, must be
/// a folder inside `root` once links are followed. Folders still to be made
/// below it are plain names, so they land inside too.
fn inside_once_made(root: &Path, dir: &Path) -> Result<(), String> {
    let mut at = Some(dir);
    while let Some(candidate) = at {
        if fs::symlink_metadata(candidate).is_ok() {
            let real = candidate
                .canonicalize()
                .map_err(|e| format!("{} can't be opened, because {}", shown(root, candidate), because(&e)))?;
            if !real.starts_with(root) {
                return Err(format!("{} is a shortcut to a place outside the folder you picked", shown(root, candidate)));
            }
            if !real.is_dir() {
                return Err(format!("{} is a file, but a folder with that name is needed", shown(root, candidate)));
            }
            return Ok(());
        }
        at = candidate.parent();
    }
    Err(format!("{} isn't inside the folder you picked", shown(root, dir)))
}

/// Why a change to the disk failed, in plain words.
fn because(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => "the folder doesn't allow changes".to_string(),
        std::io::ErrorKind::NotFound => "the folder isn't there any more".to_string(),
        std::io::ErrorKind::StorageFull => "the disk is full".to_string(),
        std::io::ErrorKind::ReadOnlyFilesystem => "the disk can't be changed".to_string(),
        std::io::ErrorKind::AlreadyExists => "a file with that name is in the way".to_string(),
        _ => format!("the system said {e}"),
    }
}

/// Why a folder couldn't be looked in, in plain words.
fn reading_because(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => "the app isn't allowed to open the folder".to_string(),
        std::io::ErrorKind::NotFound => "the folder isn't there any more".to_string(),
        _ => format!("the system said {e}"),
    }
}

/// Why a folder couldn't be locked against other saves, in plain words.
fn locking_because(e: &std::io::Error) -> String {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    const NO_LOCKS: i32 = 37;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    const NO_LOCKS: i32 = 77;
    if e.kind() == std::io::ErrorKind::Unsupported || (cfg!(unix) && e.raw_os_error() == Some(NO_LOCKS)) {
        return "the drive it's on doesn't let the app lock the folder, and without that another save could get mixed in".to_string();
    }
    match e.kind() {
        std::io::ErrorKind::PermissionDenied => "the app isn't allowed to open the folder".to_string(),
        std::io::ErrorKind::NotFound => "the folder isn't there any more".to_string(),
        _ => format!("the system said {e}"),
    }
}

/// A path as the user knows it: inside the folder they picked.
fn shown(root: &Path, path: &Path) -> String {
    slash_path(root, path)
}

/// A file's own name, for an old copy kept beside it.
fn named_as(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

/// A resource's name the way Android reads it: the file name up to its first dot.
fn resource_name(file_name: &str) -> String {
    file_name.split('.').next().unwrap_or(file_name).to_ascii_lowercase()
}

/// A name beside `target` that nothing has yet, for a temporary or an old file.
fn spare_name(target: &Path, kind: &str) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let mut attempt = 0u32;
    loop {
        let candidate = target.with_file_name(format!(".{name}.{}-{nanos}-{attempt}.osg-{kind}", std::process::id()));
        if fs::symlink_metadata(&candidate).is_err() || attempt > 64 {
            return candidate;
        }
        attempt += 1;
    }
}

/// Every kind of change a write makes to the disk. NewFile and Write name
/// the changes `new_file` and `write_bytes` make, for the tests' faults.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[cfg_attr(not(test), allow(dead_code))]
enum Change {
    MakeFolder,
    NewFile,
    Write,
    Rename,
    Remove,
    RemoveFolder,
    /// Not a change: the listing of a folder, which a test can make fail too.
    List,
}

/// One change to the disk. Every change a write makes goes through here or
/// through `new_file` and `write_bytes`, from the first folder made to the
/// last old copy removed, so a test can make any one of them fail.
fn change(kind: Change, path: &Path, to: Option<&Path>) -> std::io::Result<()> {
    #[cfg(test)]
    if let Some(kind_of_error) = tests::fails_as(kind, path, to) {
        return Err(std::io::Error::from(kind_of_error));
    }
    #[cfg(test)]
    if tests::should_fail(kind, path, to) {
        return Err(std::io::Error::other("failed on purpose"));
    }
    match (kind, to) {
        (Change::MakeFolder, _) => fs::create_dir(path),
        (Change::Rename, Some(to)) => fs::rename(path, to),
        (Change::Remove, _) => fs::remove_file(path),
        (Change::RemoveFolder, _) => fs::remove_dir(path),
        _ => Err(std::io::Error::other("not a change this function makes")),
    }
}

/// A new, empty file at `path`, and the handle to write it through. Made with
/// `create_new`, which refuses a name that is taken, a link included, so no
/// byte ever goes through a link someone left there. The file is written
/// through this handle, never opened again by name.
fn new_file(path: &Path) -> std::io::Result<fs::File> {
    #[cfg(test)]
    if let Some(kind_of_error) = tests::fails_as(Change::NewFile, path, None) {
        return Err(std::io::Error::from(kind_of_error));
    }
    #[cfg(test)]
    if tests::should_fail(Change::NewFile, path, None) {
        return Err(std::io::Error::other("failed on purpose"));
    }
    fs::OpenOptions::new().write(true).create_new(true).open(path)
}

/// Writes `bytes` through `file`. A test can make it stop halfway, leaving
/// a partial file the way a full disk would.
fn write_bytes(file: &mut fs::File, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(not(test))]
    let _ = path;
    #[cfg(test)]
    if tests::should_fail(Change::Write, path, None) {
        let _ = file.write_all(&bytes[..bytes.len() / 2]);
        return Err(std::io::Error::other("failed on purpose, halfway through"));
    }
    file.write_all(bytes)?;
    file.sync_all()
}

/// Stages every planned file: the folders it needs, each recorded in `made`
/// the moment it exists and locked before anything goes in it, and a
/// temporary file beside its place, recorded in `temporaries` the moment it
/// exists, before a byte is written, so a file left half written is taken
/// back with the rest.
fn stage_all(
    root: &Path,
    planned: &[(PathBuf, Vec<u8>)],
    made: &mut Vec<PathBuf>,
    temporaries: &mut Vec<PathBuf>,
    staged: &mut Vec<(PathBuf, PathBuf)>,
    held: &mut Held,
) -> Result<(), String> {
    let mut covered: HashSet<PathBuf> = HashSet::new();
    for (path, bytes) in planned {
        let parent = path.parent().unwrap_or(root);
        // Every folder that exists on the way is held before anything goes in
        // it, whoever made it and whenever (normally done already, in_turn).
        if covered.insert(parent.to_path_buf()) {
            held.cover(root, std::slice::from_ref(path))?;
        }
        for folder in missing_folders(parent) {
            match change(Change::MakeFolder, &folder, None) {
                Ok(()) => made.push(folder.clone()),
                // Another save made it in the moment since this one looked. It's a
                // folder like any other now: locked below before anything goes in.
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && fs::symlink_metadata(&folder).map(|found| found.is_dir()).unwrap_or(false) => {}
                Err(e) => return Err(format!("Couldn't make the folder {}, because {}", shown(root, &folder), because(&e))),
            }
            // Checked again once made, in case a link was put in since step 1.
            inside_once_made(root, &folder)?;
            #[cfg(test)]
            tests::checkpoint("made", &folder);
            held.add(root, &folder)?;
            #[cfg(test)]
            tests::checkpoint("locked", &folder);
        }
        inside_once_made(root, parent)?;
        let mut taken = None;
        for _ in 0..8 {
            let temporary = spare_name(path, "part");
            match new_file(&temporary) {
                Ok(file) => {
                    temporaries.push(temporary.clone());
                    taken = Some((temporary, file));
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("Couldn't save {}, because {}", shown(root, path), because(&e))),
            }
        }
        let Some((temporary, mut file)) = taken else {
            return Err(format!("Couldn't save {}, because no free name was left for a temporary file", shown(root, path)));
        };
        write_bytes(&mut file, &temporary, bytes).map_err(|e| format!("Couldn't save {}, because {}", shown(root, path), because(&e)))?;
        staged.push((path.clone(), temporary));
    }
    Ok(())
}

fn exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// The folders `create_dir_all(dir)` is about to make, outermost first.
fn missing_folders(dir: &Path) -> Vec<PathBuf> {
    let mut missing = Vec::new();
    let mut at = Some(dir);
    while let Some(candidate) = at {
        if fs::symlink_metadata(candidate).is_ok() {
            break;
        }
        missing.push(candidate.to_path_buf());
        at = candidate.parent();
    }
    missing.reverse();
    missing
}

/// Takes back temporary files and the folders made for them. Returns what
/// is still there, so nobody is told nothing changed when something did.
fn undo_staging<'a>(root: &Path, temporaries: impl Iterator<Item = &'a PathBuf>, made: &[PathBuf]) -> Vec<String> {
    let mut left = Vec::new();
    for temporary in temporaries {
        if exists(temporary) {
            if let Err(e) = change(Change::Remove, temporary, None) {
                left.push(format!("a leftover file, {}, is still there ({})", shown(root, temporary), because(&e)));
            }
        }
    }
    for folder in made.iter().rev() {
        if exists(folder) {
            if let Err(e) = change(Change::RemoveFolder, folder, None) {
                left.push(format!("the new folder {} is still there ({})", shown(root, folder), because(&e)));
            }
        }
    }
    left
}

/// The message for a write that stopped: what went wrong, then either that
/// nothing changed or exactly what didn't go back.
fn stopped(cause: String, left: Vec<String>) -> String {
    let cause = cause.trim_end_matches('.');
    if left.is_empty() {
        format!("{cause}. Nothing was changed.")
    } else {
        format!("{cause}. Some changes couldn't be undone: {}.", left.join("; "))
    }
}

/// What is in `folder`: each entry's path, its name in lowercase, and whether
/// it is a folder. Empty if the folder isn't there yet.
fn listed(folder: &Path) -> std::io::Result<Vec<(PathBuf, String, bool)>> {
    #[cfg(test)]
    if tests::should_fail(Change::List, folder, None) {
        return Err(std::io::Error::other("failed on purpose"));
    }
    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut found = Vec::new();
    for entry in entries {
        let entry = entry?;
        let is_folder = entry.file_type()?.is_dir();
        found.push((entry.path(), entry.file_name().to_string_lossy().to_lowercase(), is_folder));
    }
    Ok(found)
}

/// The old files the new ones make way for, besides the ones they replace
/// by name: in a cleared icon set, the PNG and JSON files the new set
/// doesn't have; in an Android res folder, the other files of each resource
/// written. Listed before anything changes, so a folder that can't be looked
/// in stops the write instead of leaving old files behind it.
fn old_files_to_remove(
    root: &Path,
    planned: &[(PathBuf, Vec<u8>)],
    sets: &[PathBuf],
    resource_folders: &[PathBuf],
) -> Result<Vec<PathBuf>, String> {
    let mut listings: std::collections::HashMap<PathBuf, Vec<(PathBuf, String, bool)>> = std::collections::HashMap::new();
    let mut look = |folder: &Path| -> Result<Vec<(PathBuf, String, bool)>, String> {
        if let Some(found) = listings.get(folder) {
            return Ok(found.clone());
        }
        let found = listed(folder).map_err(|e| format!("Couldn't look inside {}, because {}", shown(root, folder), reading_because(&e)))?;
        listings.insert(folder.to_path_buf(), found.clone());
        Ok(found)
    };
    let targets: HashSet<&Path> = planned.iter().map(|(path, _)| path.as_path()).collect();
    let mut seen = HashSet::new();
    let mut removals = Vec::new();
    let mut take = |path: PathBuf, removals: &mut Vec<PathBuf>| {
        if !targets.contains(path.as_path()) && seen.insert(path.clone()) {
            removals.push(path);
        }
    };
    for set in sets {
        let keep: HashSet<String> = planned
            .iter()
            .filter(|(path, _)| path.parent() == Some(set.as_path()))
            .filter_map(|(path, _)| path.file_name().map(|n| n.to_string_lossy().to_lowercase()))
            .collect();
        for (path, name, is_folder) in look(set)? {
            let extension = extension_of(&path);
            if !is_folder && (extension == "png" || extension == "json") && !keep.contains(&name) {
                take(path, &mut removals);
            }
        }
    }
    for (path, _) in planned {
        let Some(folder) = path.parent() else { continue };
        if !resource_folders.iter().any(|res| folder.starts_with(res) && folder != res.as_path()) {
            continue;
        }
        let Some(own) = path.file_name().map(|n| n.to_string_lossy().to_lowercase()) else { continue };
        let resource = resource_name(&own);
        for (other, name, is_folder) in look(folder)? {
            if !is_folder && name != own && resource_name(&name) == resource && ANDROID_RESOURCE_EXTENSIONS.contains(&extension_of(&other).as_str()) {
                take(other, &mut removals);
            }
        }
    }
    Ok(removals)
}

fn write_files(
    root: &Path,
    files: Vec<ExportFile>,
    clear_icon_sets: &[String],
    replace_resources: &[String],
    allowed: &[&str],
    held: &mut Held,
) -> Result<WriteResult, String> {
    if files.is_empty() {
        return Err("the export had no files".to_string());
    }
    if files.len() > MAX_FILES {
        return Err("the export had more files than an icon makes".to_string());
    }

    // 1. Check everything before anything on disk changes.
    let mut planned: Vec<(PathBuf, Vec<u8>)> = Vec::with_capacity(files.len());
    let mut seen = HashSet::new();
    for file in files {
        let relative = relative_file(&file.path, allowed)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(file.data_base64.as_bytes())
            .map_err(|e| format!("{} was not valid base64: {e}", file.path))?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err(format!("{} is larger than an icon file can be", file.path));
        }
        if !seen.insert(file.path.to_lowercase()) {
            return Err(format!("{} is in the export twice", file.path));
        }
        let path = root.join(relative);
        inside_once_made(root, path.parent().unwrap_or(root))?;
        if path.is_dir() {
            return Err(format!("{} is a folder, but a file with that name is needed", shown(root, &path)));
        }
        planned.push((path, bytes));
    }
    let mut sets = Vec::with_capacity(clear_icon_sets.len());
    for raw in clear_icon_sets {
        let relative = relative_path(raw)?;
        let named_as_set = relative
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_ascii_lowercase().ends_with(".appiconset"))
            .unwrap_or(false);
        if !named_as_set {
            return Err(format!("{raw} isn't an Xcode icon set"));
        }
        let set = root.join(relative);
        inside_once_made(root, &set)?;
        // An icon set is only ever emptied of what a new one replaces.
        let into_set = |name: &dyn Fn(&str) -> bool| {
            planned.iter().any(|(path, _)| {
                path.parent() == Some(set.as_path()) && path.file_name().map(|n| name(&n.to_string_lossy().to_lowercase())).unwrap_or(false)
            })
        };
        if !into_set(&|name| name == "contents.json") || !into_set(&|name| name.ends_with(".png")) {
            return Err(format!("{raw} gets no new icon in this request, so it isn't cleared"));
        }
        sets.push(set);
    }
    let mut resource_folders = Vec::with_capacity(replace_resources.len());
    for raw in replace_resources {
        let folder = root.join(relative_path(raw)?);
        inside_once_made(root, &folder)?;
        if !planned.iter().any(|(path, _)| path.parent().map(|parent| parent.starts_with(&folder) && parent != folder.as_path()).unwrap_or(false)) {
            return Err(format!("{raw} gets no new files in this request, so nothing in it is replaced"));
        }
        resource_folders.push(folder);
    }
    let removals = old_files_to_remove(root, &planned, &sets, &resource_folders).map_err(|cause| stopped(cause, Vec::new()))?;

    // 2. Stage every file. On a failure, every temporary file and folder made
    // so far is taken back, and the message says if any of it couldn't be.
    let mut made: Vec<PathBuf> = Vec::new();
    let mut temporaries: Vec<PathBuf> = Vec::new();
    let mut staged: Vec<(PathBuf, PathBuf)> = Vec::with_capacity(planned.len());
    if let Err(e) = stage_all(root, &planned, &mut made, &mut temporaries, &mut staged, held) {
        let left = undo_staging(root, temporaries.iter(), &made);
        return Err(stopped(e, left));
    }

    // 3. Commit: old aside, new in. A failure puts back every file done so
    // far: a replaced file by renaming its old copy over the new one (one
    // step, so it is never missing in between), an added one by removing it.
    // Every step of that is checked; whatever doesn't go back is named.
    let mut done: Vec<(PathBuf, Option<PathBuf>)> = Vec::with_capacity(staged.len());
    let mut failure: Option<String> = None;
    let mut left: Vec<String> = Vec::new();
    for (target, temporary) in &staged {
        let aside = if exists(target) {
            let old = spare_name(target, "old");
            if let Err(e) = change(Change::Rename, target, Some(&old)) {
                failure = Some(format!("Couldn't replace {}, because {}", shown(root, target), because(&e)));
                break;
            }
            Some(old)
        } else {
            None
        };
        if let Err(e) = change(Change::Rename, temporary, Some(target)) {
            failure = Some(format!("Couldn't save {}, because {}", shown(root, target), because(&e)));
            if let Some(old) = &aside {
                if let Err(e) = change(Change::Rename, old, Some(target)) {
                    left.push(format!("{} is missing. The old file is kept as {} ({})", shown(root, target), named_as(old), because(&e)));
                }
            }
            break;
        }
        done.push((target.clone(), aside));
    }
    if let Some(cause) = failure {
        for (target, aside) in done.iter().rev() {
            match aside {
                Some(old) => {
                    if let Err(e) = change(Change::Rename, old, Some(target)) {
                        left.push(format!("{} has the new file. The old file is kept as {} ({})", shown(root, target), named_as(old), because(&e)));
                    }
                }
                None => {
                    if let Err(e) = change(Change::Remove, target, None) {
                        left.push(format!("{} was added and is still there ({})", shown(root, target), because(&e)));
                    }
                }
            }
        }
        left.extend(undo_staging(root, temporaries.iter(), &made));
        return Err(stopped(cause, left));
    }

    // 4. Remove what the new files replace.
    let written: Vec<String> = done.iter().map(|(target, _)| target.to_string_lossy().into_owned()).collect();
    let mut left_over = Vec::new();
    let mut remove = |path: &Path| {
        if let Err(e) = change(Change::Remove, path, None) {
            left_over.push(format!("{}: {}", shown(root, path), because(&e)));
        }
    };
    for (_, aside) in &done {
        if let Some(old) = aside {
            remove(old);
        }
    }
    for path in &removals {
        match change(Change::Remove, path, None) {
            // Gone already: someone else removed it, which is what was wanted.
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => left_over.push(format!("{}: {}", shown(root, path), because(&e))),
            _ => {}
        }
    }
    Ok(WriteResult { written, left_over })
}

/// The folder must be one the user picked in the native dialog this session,
/// which put it in the fs plugin's scope.
fn picked_in_dialog(is_allowed: impl Fn(&Path) -> bool, directory: &str, root: &Path) -> Result<(), String> {
    if is_allowed(root) || is_allowed(Path::new(directory.trim())) {
        Ok(())
    } else {
        Err("The app only writes into a folder you pick. Pick the folder again.".to_string())
    }
}

/// One icon write at a time in this app, whichever window asks, so two
/// exports into one folder can't interleave.
static WRITING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// How long a write waits for another one to finish before it gives up, in
/// all: in this app, in another copy, for every folder.
const OTHER_WRITE_WAIT: Duration = Duration::from_secs(30);

/// What the user reads when another write didn't finish in that time.
const STILL_SAVING: &str = "Another icon save hasn't finished yet. Try again in a moment.";

/// This app's turn to write, waiting for another window's save until `until`.
fn take_turn(until: Instant) -> Result<std::sync::MutexGuard<'static, ()>, String> {
    loop {
        match WRITING.try_lock() {
            Ok(turn) => return Ok(turn),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => return Ok(poisoned.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) if Instant::now() < until => std::thread::sleep(Duration::from_millis(50)),
            Err(std::sync::TryLockError::WouldBlock) => return Err(STILL_SAVING.to_string()),
        }
    }
}

/// Holds `lock_file` for as long as the returned handle lives: another copy
/// of this build writing icons holds the same file, so the two take turns.
fn hold_lock_file(lock_file: &Path, until: Instant) -> Result<fs::File, String> {
    if let Some(folder) = lock_file.parent() {
        fs::create_dir_all(folder).map_err(|e| format!("The icons couldn't be saved, because {}.", because(&e)))?;
    }
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(lock_file)
        .map_err(|e| format!("The icons couldn't be saved, because {}.", because(&e)))?;
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(file),
            Err(fs::TryLockError::WouldBlock) if Instant::now() < until => std::thread::sleep(Duration::from_millis(100)),
            Err(fs::TryLockError::WouldBlock) => return Err(STILL_SAVING.to_string()),
            Err(fs::TryLockError::Error(e)) => return Err(format!("The icons couldn't be saved, because {}.", because(&e))),
        }
    }
}

/// The folder locks a write holds, and until when it may wait for one more.
struct Held {
    folders: folder_lock::FolderLocks,
    until: Instant,
}

impl Held {
    /// Locks a folder this write just made, before anything goes in it.
    fn add(&mut self, root: &Path, folder: &Path) -> Result<(), String> {
        self.folders.add(folder, self.until).map_err(|e| lock_refused(root, e))
    }

    /// Locks, top down, every folder that exists on the way to `targets` and
    /// isn't held yet: ones another save made while this one waited.
    fn cover(&mut self, root: &Path, targets: &[PathBuf]) -> Result<(), String> {
        for folder in folder_lock::top_down(&folder_lock::folders_on_the_way(root, targets)) {
            self.add(root, &folder)?;
        }
        Ok(())
    }
}

/// Why a write can't go on without a folder's lock.
fn lock_refused(root: &Path, error: folder_lock::LockError) -> String {
    match error {
        folder_lock::LockError::Busy => STILL_SAVING.to_string(),
        folder_lock::LockError::Unavailable { folder, error } => format!("Couldn't save into {}, because {}", shown(root, &folder), locking_because(&error)),
    }
}

/// Waits for this write's turn, `wait` at most in all: in this app
/// (`WRITING`), in another copy of this build (`lock_file`), and in any other
/// build (the folders on the way to `targets`, taken last and in one shared
/// order), then runs `write` with the folder locks, which it adds to.
fn in_turn(
    lock_file: Option<&Path>,
    root: &Path,
    targets: &[PathBuf],
    wait: Duration,
    write: impl FnOnce(&mut Held) -> Result<WriteResult, String>,
) -> Result<WriteResult, String> {
    let until = Instant::now() + wait;
    let _turn = take_turn(until)?;
    let _same_build = lock_file.map(|file| hold_lock_file(file, until)).transpose()?;
    let folders = folder_lock::hold_all(&folder_lock::folders_on_the_way(root, targets), until).map_err(|e| match e {
        folder_lock::LockError::Busy => STILL_SAVING.to_string(),
        unavailable => stopped(lock_refused(root, unavailable), Vec::new()),
    })?;
    let mut held = Held { folders, until };
    #[cfg(test)]
    tests::checkpoint("listed", root);
    // The save this one waited for may have made folders on the way: those are
    // locked too before anything goes in them.
    held.cover(root, targets).map_err(|cause| if cause == STILL_SAVING { cause } else { stopped(cause, Vec::new()) })?;
    #[cfg(test)]
    tests::checkpoint("start", root);
    let result = write(&mut held);
    #[cfg(test)]
    tests::checkpoint("done", root);
    result
}

/// A write as the command runs it, with the dialog's answer passed in.
fn write_request(
    is_allowed: impl Fn(&Path) -> bool,
    lock_file: Option<&Path>,
    directory: &str,
    files: Vec<ExportFile>,
    clear_icon_sets: &[String],
    replace_resources: &[String],
    wait: Duration,
) -> Result<WriteResult, String> {
    let root = picked_folder(directory)?;
    picked_in_dialog(is_allowed, directory, &root)?;
    let targets = files.iter().map(|file| relative_file(&file.path, ALLOWED_EXTENSIONS).map(|path| root.join(path))).collect::<Result<Vec<_>, _>>()?;
    in_turn(lock_file, &root, &targets, wait, |held| write_files(&root, files, clear_icon_sets, replace_resources, ALLOWED_EXTENSIONS, held))
}

/// The zip of a desktop "Save as a zip", where the save dialog said.
fn zip_request(is_allowed: impl Fn(&Path) -> bool, path: &str, data_base64: String) -> Result<WriteResult, String> {
    let file = PathBuf::from(path.trim());
    let (Some(folder), Some(name)) = (file.parent().filter(|_| file.is_absolute()), file.file_name().and_then(|name| name.to_str())) else {
        return Err("no place to save the zip was picked".to_string());
    };
    let name = checked_segment(name)?.to_string();
    if extension_of(&file) != "zip" {
        return Err(format!("{name} isn't a zip file"));
    }
    // The save dialog lets the app write this one file, or a folder picked before covers it.
    if !is_allowed(&file) {
        return Err("The app only saves where you pick. Pick the place again.".to_string());
    }
    if !folder.is_dir() {
        return Err("The folder you picked isn't there any more. Pick the place again.".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64.as_bytes()).map_err(|e| format!("{name} was not valid base64: {e}"))?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(format!("{name} is larger than a zip of icons can be"));
    }
    save_zip(&file, &bytes)
}

/// Saves the zip at `target` whole or not at all: written in full under
/// another name on the zip's own drive, then renamed over `target` in one
/// step. So `target` is always the old zip or a whole new one, for anyone
/// reading it and however many saves run at once, and no lock is needed.
/// The new file goes beside `target` where the app may make one (every build
/// but the Mac App Store's); else, on a Mac, in the folder macOS keeps on
/// `target`'s drive for replacing it (NSItemReplacementDirectory), which the
/// App Store sandbox lets the app use after its save dialog (measured
/// 2026-11-19 on the Mac's drive and on a disk image). Where neither can be
/// had, nothing is written: the save is refused rather than written in
/// place, where a reader could see half a zip.
fn save_zip(target: &Path, bytes: &[u8]) -> Result<WriteResult, String> {
    let saved = || WriteResult { written: vec![target.to_string_lossy().into_owned()], left_over: Vec::new() };
    let no_swap = |why: String| stopped(format!("Couldn't save {} there, because {why}", named_as(target)), Vec::new());
    // 1. Beside it.
    match zip_by_rename(target, || spare_name(target, "part"), bytes) {
        ByRename::Saved => return Ok(saved()),
        ByRename::Stopped(message) => return Err(message),
        // The App Store build's sandbox: nothing new may go in that folder.
        ByRename::NoNewFileThere(_) => {}
        ByRename::OtherDrive(e) => return Err(no_swap(because(&e))),
    }
    // 2. The folder macOS keeps for replacing it, on its own drive.
    let Some(folder) = replacement_folder(target) else {
        return Err(no_swap("the app can't put the new zip beside it to swap it in".to_string()));
    };
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let in_folder = || folder.join(format!(".{}.{}-{}.osg-part", named_as(target), std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    #[cfg(test)]
    tests::checkpoint("replacement folder", &folder);
    let result = zip_by_rename(target, in_folder, bytes);
    // macOS makes a new one for each save; this save's is done with.
    let _ = fs::remove_dir_all(&folder);
    match result {
        ByRename::Saved => Ok(saved()),
        ByRename::Stopped(message) => Err(message),
        ByRename::NoNewFileThere(e) | ByRename::OtherDrive(e) => Err(no_swap(because(&e))),
    }
}

/// The folder macOS keeps on `target`'s own drive for replacing it, made
/// new for this save: in the app's container for the Mac's own drive, and in
/// `.TemporaryItems` at the top of any other drive.
#[cfg(target_os = "macos")]
fn replacement_folder(target: &Path) -> Option<PathBuf> {
    use objc2_foundation::{NSFileManager, NSSearchPathDirectory, NSSearchPathDomainMask, NSString, NSURL};
    #[cfg(test)]
    if let Some(answer) = tests::replacement_folder_instead(target) {
        return answer;
    }
    let url = NSURL::fileURLWithPath(&NSString::from_str(&target.to_string_lossy()));
    let folder = NSFileManager::defaultManager()
        .URLForDirectory_inDomain_appropriateForURL_create_error(NSSearchPathDirectory::ItemReplacementDirectory, NSSearchPathDomainMask::UserDomainMask, Some(&url), true)
        .ok()?;
    Some(PathBuf::from(folder.path()?.to_string()))
}

/// Other systems keep no such folder: a zip goes beside the old one, or not at all.
#[cfg(not(target_os = "macos"))]
fn replacement_folder(_target: &Path) -> Option<PathBuf> {
    #[cfg(test)]
    if let Some(answer) = tests::replacement_folder_instead(_target) {
        return answer;
    }
    None
}

/// How one try at saving a zip by rename went.
enum ByRename {
    Saved,
    /// No new file may be made there: nothing was made or changed.
    NoNewFileThere(std::io::Error),
    /// The new file is on another drive than the zip, which no rename crosses: it was taken back.
    OtherDrive(std::io::Error),
    /// The save stopped; the message says why and whether anything was left.
    Stopped(String),
}

/// Writes `bytes` in full to a new file named by `temporary_name`, then
/// renames it over `target` in one step. A name another save took a moment
/// ago is passed over for a fresh one. Whatever stops it, the temporary file
/// is taken back.
fn zip_by_rename(target: &Path, temporary_name: impl Fn() -> PathBuf, bytes: &[u8]) -> ByRename {
    let name = named_as(target);
    let mut made = None;
    for _ in 0..8 {
        let temporary = temporary_name();
        match new_file(&temporary) {
            Ok(file) => {
                made = Some((temporary, file));
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return ByRename::NoNewFileThere(e),
            Err(e) => return ByRename::Stopped(stopped(format!("Couldn't save {name}, because {}", because(&e)), Vec::new())),
        }
    }
    let Some((temporary, mut file)) = made else {
        return ByRename::Stopped(stopped(format!("Couldn't save {name}, because no free name was left for a temporary file"), Vec::new()));
    };
    let temporary = temporary.as_path();
    let written = write_bytes(&mut file, temporary, bytes);
    drop(file);
    let Err(e) = written.and_then(|()| change(Change::Rename, temporary, Some(target))) else {
        return ByRename::Saved;
    };
    let left = match change(Change::Remove, temporary, None) {
        Err(gone) if gone.kind() != std::io::ErrorKind::NotFound => vec![format!("a leftover file, {}, is still there ({})", temporary.display(), because(&gone))],
        _ => Vec::new(),
    };
    if e.kind() == std::io::ErrorKind::CrossesDevices && left.is_empty() {
        return ByRename::OtherDrive(e);
    }
    ByRename::Stopped(stopped(format!("Couldn't save {name}, because {}", because(&e)), left))
}

/// A scan as the command runs it, with the dialog's answer passed in.
fn scan_request(is_allowed: impl Fn(&Path) -> bool, directory: &str) -> Result<IconTargets, String> {
    let root = picked_folder(directory)?;
    picked_in_dialog(is_allowed, directory, &root)?;
    Ok(scan(&root))
}

/// Write an icon export into a folder the user picked, folders and all.
/// `clear_icon_sets` names `.appiconset` folders whose old pictures the new
/// ones replace, and `replace_resources` names Android `res` folders whose
/// other files of the same resource go, for an icon put into an app's own
/// project. Runs off the main thread, so the window stays responsive.
#[tauri::command]
pub async fn abs_write_export_files<R: Runtime>(
    app: AppHandle<R>,
    directory: String,
    files: Vec<ExportFile>,
    clear_icon_sets: Option<Vec<String>>,
    replace_resources: Option<Vec<String>>,
) -> Result<WriteResult, String> {
    let scope = app.fs_scope();
    let lock_file = app.path().app_data_dir().ok().map(|folder| folder.join("icon-export.lock"));
    tauri::async_runtime::spawn_blocking(move || {
        write_request(
            |path| scope.is_allowed(path),
            lock_file.as_deref(),
            &directory,
            files,
            &clear_icon_sets.unwrap_or_default(),
            &replace_resources.unwrap_or_default(),
            OTHER_WRITE_WAIT,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write the zip of a desktop "Save as a zip" to the file the save dialog
/// gave, whole or not at all, in turn with every other icon write.
#[tauri::command]
pub async fn abs_write_export_zip<R: Runtime>(app: AppHandle<R>, path: String, data_base64: String) -> Result<WriteResult, String> {
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || zip_request(|file| scope.is_allowed(file), &path, data_base64))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IconSetPlace {
    /// Inside the picked folder, with forward slashes.
    path: String,
    /// What its Contents.json is for: "ios", "mac", "both", "watch", "tv",
    /// "mixed" (Apple Watch or TV icons beside iPhone or Mac ones) or "unknown".
    platform: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AndroidResPlace {
    path: String,
    /// The `mipmap-anydpi*` folders already holding a launcher icon's XML,
    /// such as `mipmap-anydpi-v26` and `mipmap-anydpi-v33`. The layered
    /// icon's XML goes into each, so no Android version keeps the old one.
    anydpi: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IconTargets {
    icon_sets: Vec<IconSetPlace>,
    android_res: Vec<AndroidResPlace>,
    /// The scan stopped at its limit before it had looked everywhere.
    truncated: bool,
    /// Folders the scan couldn't look in, the first few by name.
    not_looked_in: Vec<NotLookedIn>,
    /// How many there were in all.
    not_looked_in_count: usize,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotLookedIn {
    /// Inside the picked folder, with forward slashes.
    path: String,
    /// "deep" (past the scan's depth), "unreadable" (the system said no) or
    /// "link" (a link to a folder, which the scan doesn't follow).
    reason: String,
}

fn slash_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn icon_set_platform(set: &Path) -> String {
    let text = fs::metadata(set.join("Contents.json"))
        .ok()
        .filter(|meta| meta.len() < 512 * 1024)
        .and_then(|_| fs::read_to_string(set.join("Contents.json")).ok())
        .unwrap_or_default();
    let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    let has = |needles: &[&str]| needles.iter().any(|needle| compact.contains(needle));
    let mac = has(&["\"idiom\":\"mac\"", "\"platform\":\"macos\""]);
    let ios = has(&["\"platform\":\"ios\"", "\"idiom\":\"iphone\"", "\"idiom\":\"ipad\"", "\"idiom\":\"ios-marketing\""]);
    let watch = has(&["\"idiom\":\"watch\"", "\"idiom\":\"watch-marketing\"", "\"platform\":\"watchos\""]);
    let tv = has(&["\"idiom\":\"tv\"", "\"idiom\":\"tv-marketing\"", "\"platform\":\"tvos\""]);
    match (ios, mac, watch || tv) {
        (false, false, true) if watch && !tv => "watch",
        (false, false, true) if tv && !watch => "tv",
        (_, _, true) => "mixed",
        (true, true, false) => "both",
        (true, false, false) => "ios",
        (false, true, false) => "mac",
        _ => "unknown",
    }
    .to_string()
}

/// The `mipmap-anydpi*` folders in `res` that hold a launcher icon's XML, sorted.
fn anydpi_folders(res: &Path) -> Vec<String> {
    let mut found: Vec<String> = fs::read_dir(res)
        .map(|children| {
            children
                .flatten()
                .filter(|child| child.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|child| child.file_name().to_string_lossy().into_owned())
                .filter(|name| name.starts_with("mipmap-anydpi"))
                .filter(|name| res.join(name).join("ic_launcher.xml").is_file() || res.join(name).join("ic_launcher_round.xml").is_file())
                .collect()
        })
        .unwrap_or_default();
    found.sort();
    found
}

/// Every place under `root` an app's icons live, and every folder the scan
/// couldn't look in, so nothing is guessed from a part of the project.
/// Dependencies, build output and hidden folders are passed over on purpose
/// and not counted: an app's own icon is never in them.
fn scan(root: &Path) -> IconTargets {
    let mut targets = IconTargets {
        icon_sets: Vec::new(),
        android_res: Vec::new(),
        truncated: false,
        not_looked_in: Vec::new(),
        not_looked_in_count: 0,
    };
    let note = |targets: &mut IconTargets, path: &Path, reason: &str| {
        targets.not_looked_in_count += 1;
        if targets.not_looked_in.len() < NOT_LOOKED_IN_NAMED {
            targets.not_looked_in.push(NotLookedIn { path: slash_path(root, path), reason: reason.to_string() });
        }
    };
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    let mut seen = 0usize;
    while let Some((dir, depth)) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => {
                note(&mut targets, &dir, "unreadable");
                continue;
            }
        };
        for entry in entries {
            seen += 1;
            if seen > SCAN_ENTRIES {
                targets.truncated = true;
                return targets;
            }
            let Ok(entry) = entry else {
                note(&mut targets, &dir, "unreadable");
                continue;
            };
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(kind) = entry.file_type() else {
                note(&mut targets, &path, "unreadable");
                continue;
            };
            let passed_over = name.starts_with('.') || SCAN_SKIP.contains(&name.as_str());
            // Links are not followed: one to a folder is named as not looked in.
            if kind.is_symlink() {
                if !passed_over && fs::metadata(&path).map(|meta| meta.is_dir()).unwrap_or(false) {
                    note(&mut targets, &path, "link");
                }
                continue;
            }
            if !kind.is_dir() {
                continue;
            }
            if name.to_ascii_lowercase().ends_with(".appiconset") {
                targets.icon_sets.push(IconSetPlace { path: slash_path(root, &path), platform: icon_set_platform(&path) });
                continue;
            }
            if name == "res" {
                let has_mipmaps = fs::read_dir(&path)
                    .map(|children| {
                        children
                            .flatten()
                            .any(|child| child.file_name().to_string_lossy().starts_with("mipmap-"))
                    })
                    .unwrap_or(false);
                if has_mipmaps {
                    targets.android_res.push(AndroidResPlace { path: slash_path(root, &path), anydpi: anydpi_folders(&path) });
                    continue;
                }
            }
            if passed_over {
                continue;
            }
            if depth + 1 >= SCAN_DEPTH {
                note(&mut targets, &path, "deep");
                continue;
            }
            stack.push((path, depth + 1));
        }
    }
    targets.icon_sets.sort_by(|a, b| a.path.cmp(&b.path));
    targets.android_res.sort_by(|a, b| a.path.cmp(&b.path));
    targets.not_looked_in.sort_by(|a, b| a.path.cmp(&b.path));
    targets
}

/// Where an app's icons live under a folder the user picked, so an icon can
/// go straight into the project.
#[tauri::command]
pub async fn abs_scan_icon_targets<R: Runtime>(app: AppHandle<R>, directory: String) -> Result<IconTargets, String> {
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || scan_request(|path| scope.is_allowed(path), &directory))
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    type Rule = Box<dyn Fn(Change, &Path, Option<&Path>) -> bool>;

    thread_local! {
        static RULES: std::cell::RefCell<Vec<Rule>> = std::cell::RefCell::new(Vec::new());
    }

    /// Whether a test asked for this change to fail.
    pub(super) fn should_fail(kind: Change, path: &Path, to: Option<&Path>) -> bool {
        RULES.with(|rules| rules.borrow().iter().any(|rule| rule(kind, path, to)))
    }

    type Checkpoint = Box<dyn Fn(&str, &Path)>;

    thread_local! {
        static CHECKPOINTS: std::cell::RefCell<Vec<Checkpoint>> = std::cell::RefCell::new(Vec::new());
    }

    /// Runs what a test asked for at this point of a write ("made" a folder, "locked" it).
    pub(super) fn checkpoint(name: &str, path: &Path) {
        CHECKPOINTS.with(|all| {
            for hook in all.borrow().iter() {
                hook(name, path);
            }
        });
    }

    /// Runs `hook` at every checkpoint until it is dropped.
    struct AtCheckpoint;
    impl AtCheckpoint {
        fn run(hook: Checkpoint) -> AtCheckpoint {
            CHECKPOINTS.with(|all| all.borrow_mut().push(hook));
            AtCheckpoint
        }
    }
    impl Drop for AtCheckpoint {
        fn drop(&mut self) {
            CHECKPOINTS.with(|all| all.borrow_mut().clear());
        }
    }

    type Typed = Box<dyn Fn(Change, &Path, Option<&Path>) -> Option<std::io::ErrorKind>>;

    thread_local! {
        static TYPED: std::cell::RefCell<Vec<Typed>> = std::cell::RefCell::new(Vec::new());
    }

    /// The kind of error a test asked this change to fail with, as the system
    /// would give it: a sandbox's refusal, a rename across drives.
    pub(super) fn fails_as(kind: Change, path: &Path, to: Option<&Path>) -> Option<std::io::ErrorKind> {
        TYPED.with(|rules| rules.borrow().iter().find_map(|rule| rule(kind, path, to)))
    }

    type Replacement = Box<dyn Fn(&Path) -> Option<Option<PathBuf>>>;

    thread_local! {
        static REPLACEMENT: std::cell::RefCell<Option<Replacement>> = std::cell::RefCell::new(None);
    }

    /// What a test says the replacement folder for `target` is instead of
    /// asking macOS: Some(None) for none to be had, None to ask as usual.
    pub(super) fn replacement_folder_instead(target: &Path) -> Option<Option<PathBuf>> {
        REPLACEMENT.with(|hook| hook.borrow().as_ref().and_then(|answer| answer(target)))
    }

    /// Answers for the replacement folder until it is dropped.
    struct ReplacementFolder;
    impl ReplacementFolder {
        fn is(answer: Replacement) -> ReplacementFolder {
            REPLACEMENT.with(|hook| *hook.borrow_mut() = Some(answer));
            ReplacementFolder
        }
    }
    impl Drop for ReplacementFolder {
        fn drop(&mut self) {
            REPLACEMENT.with(|hook| *hook.borrow_mut() = None);
        }
    }

    /// Makes the matching changes fail with a given kind of error until it is dropped.
    struct FailingAs;
    impl FailingAs {
        fn when(rules: Vec<Typed>) -> FailingAs {
            TYPED.with(|all| *all.borrow_mut() = rules);
            FailingAs
        }
    }
    impl Drop for FailingAs {
        fn drop(&mut self) {
            TYPED.with(|all| all.borrow_mut().clear());
        }
    }

    /// Makes the matching changes fail until it is dropped.
    struct Failing;
    impl Failing {
        fn when(rules: Vec<Rule>) -> Failing {
            RULES.with(|all| *all.borrow_mut() = rules);
            Failing
        }
    }
    impl Drop for Failing {
        fn drop(&mut self) {
            RULES.with(|all| all.borrow_mut().clear());
        }
    }

    fn named(path: &Path, name: &str) -> bool {
        path.file_name().map(|n| n == name).unwrap_or(false)
    }
    fn temporary(path: &Path) -> bool {
        path.to_string_lossy().ends_with(".osg-part")
    }
    fn old_copy(path: &Path) -> bool {
        path.to_string_lossy().ends_with(".osg-old")
    }
    /// A rename from a temporary file into `name`.
    fn into_place(name: &'static str) -> Rule {
        Box::new(move |kind, from, to| kind == Change::Rename && temporary(from) && to.map(|to| named(to, name)).unwrap_or(false))
    }
    /// A rename of `name`'s old copy back over it.
    fn back_over(name: &'static str) -> Rule {
        Box::new(move |kind, from, to| kind == Change::Rename && old_copy(from) && to.map(|to| named(to, name)).unwrap_or(false))
    }

    /// An icon set holding an old picture and description.
    fn old_set(root: &Path) -> PathBuf {
        let set = root.join("App/AppIcon.appiconset");
        fs::create_dir_all(&set).unwrap();
        fs::write(set.join("AppIcon.png"), "old picture").unwrap();
        fs::write(set.join("Contents.json"), "old json").unwrap();
        set
    }

    fn new_set_files() -> Vec<ExportFile> {
        vec![
            file("App/AppIcon.appiconset/AppIcon.png", "new picture"),
            file("App/AppIcon.appiconset/Contents.json", "new json"),
            file("App/AppIcon.appiconset/AppIcon-Dark.png", "new dark"),
        ]
    }

    fn hidden_leftovers(dir: &Path) -> Vec<String> {
        let mut found = Vec::new();
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.ends_with(".osg-part") || name.ends_with(".osg-old") {
                    found.push(name);
                }
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    found.extend(hidden_leftovers(&entry.path()));
                }
            }
        }
        found
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("osg-icon-export-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root.canonicalize().unwrap()
    }

    fn file(path: &str, text: &str) -> ExportFile {
        ExportFile { path: path.to_string(), data_base64: base64::engine::general_purpose::STANDARD.encode(text) }
    }

    /// No locks held yet, and all the time in the world to take more.
    fn alone() -> Held {
        let until = Instant::now() + Duration::from_secs(30);
        Held { folders: folder_lock::hold_all(&[], until).unwrap(), until }
    }

    fn write(root: &Path, files: Vec<ExportFile>, sets: &[&str], res: &[&str]) -> Result<WriteResult, String> {
        let sets: Vec<String> = sets.iter().map(|s| s.to_string()).collect();
        let res: Vec<String> = res.iter().map(|s| s.to_string()).collect();
        write_files(root, files, &sets, &res, ALLOWED_EXTENSIONS, &mut alone())
    }

    #[test]
    fn paths_stay_plain_and_typed() {
        assert!(relative_file("ios/AppIcon.appiconset/Contents.json", ALLOWED_EXTENSIONS).is_ok());
        assert!(relative_file("android/res/mipmap-hdpi/ic_launcher.png", ALLOWED_EXTENSIONS).is_ok());
        let too_deep = format!("{}x.png", "d/".repeat(MAX_SEGMENTS));
        for bad in ["../x.png", "/etc/x.png", "a//b.png", "a/./b.png", "C:/x.png", "a\\b.png", "x.sh", "x", "a/b.", "a /b.png", too_deep.as_str()] {
            assert!(relative_file(bad, ALLOWED_EXTENSIONS).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn writes_folders_and_files_and_refuses_before_writing_anything() {
        let root = temp_root("write");
        let result = write(
            &root,
            vec![file("Pebble icon/ios/AppIcon.appiconset/Contents.json", "{}"), file("Pebble icon/README.txt", "hi")],
            &[],
            &[],
        )
        .unwrap();
        assert_eq!(result.written.len(), 2);
        assert!(result.left_over.is_empty());
        assert_eq!(fs::read_to_string(root.join("Pebble icon/README.txt")).unwrap(), "hi");
        // One bad path and nothing at all is written.
        assert!(write(&root, vec![file("ok/first.png", "a"), file("../escape.png", "b")], &[], &[]).is_err());
        assert!(!root.join("ok").exists());
        // Writing over files leaves no temporary or old copies behind.
        write(&root, vec![file("Pebble icon/README.txt", "again")], &[], &[]).unwrap();
        assert_eq!(fs::read_to_string(root.join("Pebble icon/README.txt")).unwrap(), "again");
        assert!(hidden_leftovers(&root).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_deepest_place_the_scan_finds_can_be_written() {
        let root = temp_root("deep");
        // A res folder as many segments down as the scan looks, the deepest it reports.
        let res = format!("{}res", "d/".repeat(SCAN_DEPTH - 1));
        assert_eq!(res.split('/').count(), SCAN_DEPTH);
        let result = write(&root, vec![file(&format!("{res}/mipmap-xxxhdpi/ic_launcher.png"), "new")], &[], &[res.as_str()]).unwrap();
        assert_eq!(result.written.len(), 1);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn clearing_a_set_removes_only_old_pictures_and_json_after_the_new_ones_are_in() {
        let root = temp_root("clear");
        let set = root.join("App/Assets.xcassets/AppIcon.appiconset");
        fs::create_dir_all(set.join("keep-folder")).unwrap();
        fs::write(set.join("Icon-60@3x.png"), "old").unwrap();
        fs::write(set.join("Contents.json"), "{}").unwrap();
        fs::write(set.join("notes.md"), "mine").unwrap();
        let result = write(
            &root,
            vec![
                file("App/Assets.xcassets/AppIcon.appiconset/AppIcon.png", "new"),
                file("App/Assets.xcassets/AppIcon.appiconset/Contents.json", "{\"new\":1}"),
            ],
            &["App/Assets.xcassets/AppIcon.appiconset"],
            &[],
        )
        .unwrap();
        assert!(result.left_over.is_empty());
        assert!(!set.join("Icon-60@3x.png").exists());
        assert!(set.join("notes.md").exists());
        assert!(set.join("keep-folder").is_dir());
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "new");
        assert_eq!(fs::read_to_string(set.join("Contents.json")).unwrap(), "{\"new\":1}");
        // Only a folder named as an icon set can be cleared.
        assert!(write(&root, vec![file("x.png", "a")], &["App"], &[]).is_err());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_bad_request_is_refused_before_anything_is_staged() {
        let root = temp_root("refuse");
        let set = root.join("App/AppIcon.appiconset");
        fs::create_dir_all(&set).unwrap();
        fs::write(set.join("Old.png"), "old").unwrap();
        fs::write(set.join("Contents.json"), "old").unwrap();
        // A folder where the second file has to go.
        fs::create_dir_all(set.join("AppIcon-Dark.png")).unwrap();
        let result = write(
            &root,
            vec![
                file("App/AppIcon.appiconset/AppIcon.png", "new"),
                file("App/AppIcon.appiconset/AppIcon-Dark.png", "new"),
                file("App/AppIcon.appiconset/Contents.json", "new"),
            ],
            &["App/AppIcon.appiconset"],
            &[],
        );
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(set.join("Old.png")).unwrap(), "old");
        assert_eq!(fs::read_to_string(set.join("Contents.json")).unwrap(), "old");
        assert!(!set.join("AppIcon.png").exists());
        assert!(hidden_leftovers(&root).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_file_that_cannot_be_staged_leaves_everything_as_it_was() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("stage");
        fs::create_dir_all(root.join("ios/AppIcon.appiconset")).unwrap();
        fs::write(root.join("ios/AppIcon.appiconset/AppIcon.png"), "old").unwrap();
        let locked = root.join("android/res/mipmap-hdpi");
        fs::create_dir_all(&locked).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        let result = write(
            &root,
            vec![
                file("ios/AppIcon.appiconset/AppIcon.png", "new"),
                file("new/folder/README.txt", "new"),
                file("android/res/mipmap-hdpi/ic_launcher.png", "new"),
            ],
            &[],
            &[],
        );
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err(), "the locked folder takes no temporary file");
        assert_eq!(fs::read_to_string(root.join("ios/AppIcon.appiconset/AppIcon.png")).unwrap(), "old");
        assert!(!root.join("new").exists(), "folders made for the request are taken back");
        assert!(hidden_leftovers(&root).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_failed_commit_puts_every_file_back() {
        let root = temp_root("commit");
        let set = old_set(&root);
        fs::write(set.join("Extra.png"), "old extra").unwrap();
        // The picture is in; moving the description's original aside fails.
        let _failing = Failing::when(vec![Box::new(|kind, from, to| kind == Change::Rename && named(from, "Contents.json") && to.map(old_copy).unwrap_or(false))]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(error.ends_with("Nothing was changed."), "{error}");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture");
        assert_eq!(fs::read_to_string(set.join("Contents.json")).unwrap(), "old json");
        assert_eq!(fs::read_to_string(set.join("Extra.png")).unwrap(), "old extra", "nothing is cleared after a failure");
        assert!(!set.join("AppIcon-Dark.png").exists());
        assert!(hidden_leftovers(&root).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_failure_after_the_original_moved_aside_puts_the_original_back() {
        let root = temp_root("aside");
        let set = old_set(&root);
        // The picture's original is aside, then its new file fails to go in.
        let _failing = Failing::when(vec![into_place("AppIcon.png")]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(error.ends_with("Nothing was changed."), "{error}");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture");
        assert_eq!(fs::read_to_string(set.join("Contents.json")).unwrap(), "old json");
        assert!(hidden_leftovers(&root).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_file_that_cannot_be_put_back_is_named_never_hidden() {
        let root = temp_root("restore-fails");
        let set = old_set(&root);
        // The picture goes in; the description fails; putting the picture's original back fails too.
        let _failing = Failing::when(vec![into_place("Contents.json"), back_over("AppIcon.png")]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(!error.contains("Nothing was changed"), "{error}");
        assert!(error.contains("Some changes couldn't be undone"), "{error}");
        assert!(error.contains("AppIcon.png has the new file. The old file is kept as"), "{error}");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "new picture");
        // The old copy it names is really there, so it can be put back by hand.
        let kept: Vec<String> = hidden_leftovers(&root);
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert_eq!(fs::read_to_string(set.join(&kept[0])).unwrap(), "old picture");
        assert!(error.contains(&kept[0]), "{error}");
        assert_eq!(fs::read_to_string(set.join("Contents.json")).unwrap(), "old json");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_missing_file_after_a_failed_restore_is_named() {
        let root = temp_root("missing");
        let set = old_set(&root);
        // The picture's new file fails to go in, and its original fails to come back.
        let _failing = Failing::when(vec![into_place("AppIcon.png"), back_over("AppIcon.png")]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(!error.contains("Nothing was changed"), "{error}");
        assert!(error.contains("AppIcon.png is missing. The old file is kept as"), "{error}");
        assert!(!set.join("AppIcon.png").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn an_added_file_that_cannot_be_removed_is_named() {
        let root = temp_root("added");
        let set = old_set(&root);
        // The new dark picture goes in first (it had no original), then the picture fails, then removing the dark one fails.
        let files = vec![
            file("App/AppIcon.appiconset/AppIcon-Dark.png", "new dark"),
            file("App/AppIcon.appiconset/AppIcon.png", "new picture"),
            file("App/AppIcon.appiconset/Contents.json", "new json"),
        ];
        let _failing = Failing::when(vec![
            into_place("AppIcon.png"),
            Box::new(|kind, path, _| kind == Change::Remove && named(path, "AppIcon-Dark.png")),
        ]);
        let error = write(&root, files, &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(!error.contains("Nothing was changed"), "{error}");
        assert!(error.contains("AppIcon-Dark.png was added and is still there"), "{error}");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_temporary_file_that_cannot_be_removed_is_named() {
        let root = temp_root("temporary-left");
        old_set(&root);
        let _failing = Failing::when(vec![
            into_place("AppIcon.png"),
            Box::new(|kind, path, _| kind == Change::Remove && temporary(path) && path.to_string_lossy().contains("Contents.json")),
        ]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(error.contains("a leftover file"), "{error}");
        assert!(!error.contains("Nothing was changed"), "{error}");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn the_commands_refuse_a_folder_the_dialog_did_not_grant() {
        let root = temp_root("grant");
        let set = old_set(&root);
        let directory = root.to_string_lossy().into_owned();
        let never = |_: &Path| false;
        let refused = write_request(never, None, &directory, new_set_files(), &["App/AppIcon.appiconset".to_string()], &[], OTHER_WRITE_WAIT);
        assert!(refused.unwrap_err().contains("Pick the folder again"));
        assert!(scan_request(never, &directory).unwrap_err().contains("Pick the folder again"));
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture", "nothing written");
        // Granted, the same request goes through.
        let granted = |path: &Path| path.starts_with(&root);
        write_request(granted, None, &directory, new_set_files(), &["App/AppIcon.appiconset".to_string()], &[], OTHER_WRITE_WAIT).unwrap();
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "new picture");
        assert_eq!(scan_request(granted, &directory).unwrap().icon_sets.len(), 1);
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_set_or_res_folder_is_cleaned_up_only_with_new_files_for_it() {
        let root = temp_root("only-with-files");
        let set = root.join("App/AppIcon.appiconset");
        fs::create_dir_all(&set).unwrap();
        fs::write(set.join("AppIcon.png"), "theirs").unwrap();
        fs::write(set.join("Contents.json"), "theirs").unwrap();
        // Files for somewhere else, and the set named to clear: refused, the set untouched.
        let refused = write(&root, vec![file("Other/README.txt", "x")], &["App/AppIcon.appiconset"], &[]);
        assert!(refused.unwrap_err().contains("gets no new icon"));
        // Pictures but no Contents.json: refused too, or Xcode would lose the set's description.
        assert!(write(&root, vec![file("App/AppIcon.appiconset/New.png", "x")], &["App/AppIcon.appiconset"], &[]).is_err());
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "theirs");
        assert!(!set.join("New.png").exists());
        fs::create_dir_all(root.join("res/mipmap-hdpi")).unwrap();
        fs::write(root.join("res/mipmap-hdpi/ic_launcher.webp"), "theirs").unwrap();
        assert!(write(&root, vec![file("Other/README.txt", "x")], &[], &["res"]).unwrap_err().contains("gets no new files"));
        assert!(root.join("res/mipmap-hdpi/ic_launcher.webp").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn create_new_refuses_a_link_rather_than_writing_through_it() {
        // stage() relies on this: a temporary file's name taken by a link is refused.
        use std::os::unix::fs::symlink;
        let root = temp_root("create-new");
        let outside = temp_root("create-new-outside");
        fs::write(outside.join("target.png"), "theirs").unwrap();
        symlink(outside.join("target.png"), root.join(".x.osg-part")).unwrap();
        let opened = fs::OpenOptions::new().write(true).create_new(true).open(root.join(".x.osg-part"));
        assert_eq!(opened.unwrap_err().kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(outside.join("target.png")).unwrap(), "theirs");
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn android_files_of_the_same_resource_make_way_for_the_new_ones() {
        let root = temp_root("android");
        let res = root.join("app/src/main/res");
        fs::create_dir_all(res.join("mipmap-hdpi")).unwrap();
        fs::create_dir_all(res.join("values")).unwrap();
        fs::write(res.join("mipmap-hdpi/ic_launcher.webp"), "old").unwrap();
        fs::write(res.join("mipmap-hdpi/ic_launcher_round.webp"), "old").unwrap();
        fs::write(res.join("mipmap-hdpi/ic_launcher_foreground.webp"), "old").unwrap();
        fs::write(res.join("mipmap-hdpi/other.webp"), "theirs").unwrap();
        fs::write(res.join("values/ic_launcher_background.xml"), "<resources/>").unwrap();
        let result = write(
            &root,
            vec![
                file("app/src/main/res/mipmap-hdpi/ic_launcher.png", "new"),
                file("app/src/main/res/mipmap-hdpi/ic_launcher_round.png", "new"),
                file("app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png", "new"),
            ],
            &[],
            &["app/src/main/res"],
        )
        .unwrap();
        assert!(result.left_over.is_empty());
        for gone in ["ic_launcher.webp", "ic_launcher_round.webp", "ic_launcher_foreground.webp"] {
            assert!(!res.join("mipmap-hdpi").join(gone).exists(), "{gone} would clash with the new .png");
        }
        assert!(res.join("mipmap-hdpi/other.webp").exists());
        assert!(res.join("values/ic_launcher_background.xml").exists(), "a colour resource in values is another type");
        // A plain export folder keeps whatever else is there.
        fs::write(res.join("mipmap-hdpi/ic_launcher.webp"), "back").unwrap();
        write(&root, vec![file("app/src/main/res/mipmap-hdpi/ic_launcher.png", "again")], &[], &[]).unwrap();
        assert!(res.join("mipmap-hdpi/ic_launcher.webp").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn links_never_carry_a_write_out_of_the_picked_folder() {
        use std::os::unix::fs::symlink;
        let root = temp_root("links");
        let outside = temp_root("links-outside");
        fs::write(outside.join("brand.png"), "theirs").unwrap();
        fs::create_dir_all(root.join("res/mipmap-hdpi")).unwrap();
        // A file that is a link to a file outside: replaced by a real file, the outside one untouched.
        symlink(outside.join("brand.png"), root.join("res/mipmap-hdpi/ic_launcher.png")).unwrap();
        write(&root, vec![file("res/mipmap-hdpi/ic_launcher.png", "new")], &[], &["res"]).unwrap();
        assert_eq!(fs::read_to_string(outside.join("brand.png")).unwrap(), "theirs");
        assert!(!fs::symlink_metadata(root.join("res/mipmap-hdpi/ic_launcher.png")).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(root.join("res/mipmap-hdpi/ic_launcher.png")).unwrap(), "new");
        // A folder that is a link to one outside: refused, with nothing made or written anywhere.
        symlink(&outside, root.join("linked")).unwrap();
        let refused = write(&root, vec![file("first/ok.png", "a"), file("linked/made/x.png", "b")], &[], &[]);
        assert!(refused.unwrap_err().contains("is a shortcut to a place outside the folder you picked"));
        assert!(!outside.join("made").exists());
        assert!(!root.join("first").exists());
        // An icon set through that link can't be cleared.
        fs::create_dir_all(outside.join("Out.appiconset")).unwrap();
        fs::write(outside.join("Out.appiconset/Keep.png"), "theirs").unwrap();
        assert!(write(&root, vec![file("ok.png", "a")], &["linked/Out.appiconset"], &[]).is_err());
        assert!(outside.join("Out.appiconset/Keep.png").exists());
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn the_scan_finds_icon_sets_and_res_folders_and_skips_dependencies() {
        let root = temp_root("scan");
        let ios = root.join("ios/Pebble/Images.xcassets/AppIcon.appiconset");
        fs::create_dir_all(&ios).unwrap();
        fs::write(ios.join("Contents.json"), r#"{ "images" : [ { "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" } ] }"#).unwrap();
        let mac = root.join("macos/Runner/Assets.xcassets/AppIcon.appiconset");
        fs::create_dir_all(&mac).unwrap();
        fs::write(mac.join("Contents.json"), r#"{"images":[{"idiom":"mac","scale":"1x","size":"16x16"}]}"#).unwrap();
        let watch = root.join("ios/Watch/Assets.xcassets/AppIcon.appiconset");
        fs::create_dir_all(&watch).unwrap();
        fs::write(watch.join("Contents.json"), r#"{"images":[{"idiom":"universal","platform":"watchos","size":"1024x1024"}]}"#).unwrap();
        let res = root.join("android/app/src/main/res");
        fs::create_dir_all(res.join("mipmap-anydpi-v26")).unwrap();
        fs::create_dir_all(res.join("mipmap-anydpi-v33")).unwrap();
        fs::create_dir_all(res.join("mipmap-anydpi")).unwrap();
        fs::create_dir_all(res.join("mipmap-hdpi")).unwrap();
        fs::write(res.join("mipmap-anydpi-v26/ic_launcher.xml"), "<adaptive-icon/>").unwrap();
        fs::write(res.join("mipmap-anydpi-v33/ic_launcher_round.xml"), "<adaptive-icon/>").unwrap();
        fs::create_dir_all(root.join("node_modules/lib/ios/Lib.xcassets/AppIcon.appiconset")).unwrap();
        let found = scan(&root);
        assert_eq!(
            found.icon_sets,
            vec![
                IconSetPlace { path: "ios/Pebble/Images.xcassets/AppIcon.appiconset".into(), platform: "ios".into() },
                IconSetPlace { path: "ios/Watch/Assets.xcassets/AppIcon.appiconset".into(), platform: "watch".into() },
                IconSetPlace { path: "macos/Runner/Assets.xcassets/AppIcon.appiconset".into(), platform: "mac".into() },
            ]
        );
        assert_eq!(
            found.android_res,
            vec![AndroidResPlace {
                path: "android/app/src/main/res".into(),
                anydpi: vec!["mipmap-anydpi-v26".into(), "mipmap-anydpi-v33".into()],
            }]
        );
        assert!(!found.truncated);
        assert_eq!(found.not_looked_in_count, 0, "node_modules is passed over on purpose, not counted");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_file_left_half_written_is_taken_back() {
        let root = temp_root("half");
        let set = old_set(&root);
        // The second file stops halfway, as on a full disk.
        let _failing = Failing::when(vec![Box::new(|kind, path, _| kind == Change::Write && path.to_string_lossy().contains("Contents.json"))]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(error.ends_with("Nothing was changed."), "{error}");
        assert!(hidden_leftovers(&root).is_empty(), "the half-written temporary file is gone too");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_half_written_file_that_cannot_be_removed_is_named() {
        let root = temp_root("half-left");
        old_set(&root);
        let _failing = Failing::when(vec![
            Box::new(|kind, path, _| kind == Change::Write && path.to_string_lossy().contains("Contents.json")),
            Box::new(|kind, path, _| kind == Change::Remove && temporary(path) && path.to_string_lossy().contains("Contents.json")),
        ]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(!error.contains("Nothing was changed"), "{error}");
        assert!(error.contains("a leftover file") && error.contains("Contents.json"), "{error}");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn folders_made_before_a_failed_folder_are_taken_back() {
        let root = temp_root("folders");
        // "Pebble icon" and "android" are made; "res" fails.
        let _failing = Failing::when(vec![Box::new(|kind, path, _| kind == Change::MakeFolder && named(path, "res"))]);
        let files = vec![file("Pebble icon/README.txt", "hi"), file("Pebble icon/android/res/mipmap-hdpi/ic_launcher.png", "new")];
        let error = write(&root, files, &[], &[]).unwrap_err();
        assert!(error.ends_with("Nothing was changed."), "{error}");
        assert!(!root.join("Pebble icon").exists(), "every folder made for the request is gone");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_new_folder_that_cannot_be_removed_is_named() {
        let root = temp_root("folders-left");
        let _failing = Failing::when(vec![
            Box::new(|kind, path, _| kind == Change::MakeFolder && named(path, "res")),
            Box::new(|kind, path, _| kind == Change::RemoveFolder && named(path, "android")),
        ]);
        let files = vec![file("Pebble icon/android/res/mipmap-hdpi/ic_launcher.png", "new")];
        let error = write(&root, files, &[], &[]).unwrap_err();
        assert!(!error.contains("Nothing was changed"), "{error}");
        assert!(error.contains("the new folder") && error.contains("android"), "{error}");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_temporary_file_that_cannot_be_made_changes_nothing() {
        let root = temp_root("no-temp");
        let set = old_set(&root);
        let _failing = Failing::when(vec![Box::new(|kind, path, _| kind == Change::NewFile && path.to_string_lossy().contains("AppIcon-Dark.png"))]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(error.ends_with("Nothing was changed."), "{error}");
        assert!(hidden_leftovers(&root).is_empty());
        assert_eq!(fs::read_to_string(set.join("Contents.json")).unwrap(), "old json");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn two_writes_take_turns_in_one_app_and_across_copies() {
        let root = temp_root("turns");
        let directory = root.to_string_lossy().into_owned();
        let granted = {
            let root = root.clone();
            move |path: &Path| path.starts_with(&root)
        };
        // Another window of this app is writing: this one waits for it.
        let turn = WRITING.lock().unwrap();
        let waiting = {
            let (directory, granted) = (directory.clone(), granted.clone());
            std::thread::spawn(move || write_request(granted, None, &directory, vec![file("a.txt", "one")], &[], &[], OTHER_WRITE_WAIT))
        };
        std::thread::sleep(std::time::Duration::from_millis(400));
        assert!(!waiting.is_finished(), "a second write waits while the first holds the turn");
        drop(turn);
        waiting.join().unwrap().unwrap();
        // Another copy of the app holds the lock file: this one waits for it too.
        let lock = root.join("held.lock");
        let held = fs::OpenOptions::new().create(true).truncate(false).write(true).open(&lock).unwrap();
        held.lock().unwrap();
        let waiting = {
            let (directory, granted, lock) = (directory.clone(), granted.clone(), lock.clone());
            std::thread::spawn(move || write_request(granted, Some(&lock), &directory, vec![file("b.txt", "two")], &[], &[], OTHER_WRITE_WAIT))
        };
        std::thread::sleep(std::time::Duration::from_millis(400));
        assert!(!waiting.is_finished(), "a write waits while another copy holds the lock file");
        held.unlock().unwrap();
        waiting.join().unwrap().unwrap();
        assert_eq!(fs::read_to_string(root.join("b.txt")).unwrap(), "two");
        fs::remove_dir_all(&root).unwrap();
    }

    fn granted_in(root: &Path) -> impl Fn(&Path) -> bool + Clone + Send + 'static {
        let root = root.to_path_buf();
        move |path: &Path| path.starts_with(&root)
    }

    #[test]
    fn a_folder_that_cannot_be_listed_stops_the_write_before_anything_changes() {
        let root = temp_root("unlisted");
        let set = old_set(&root);
        fs::write(set.join("Extra.png"), "old extra").unwrap();
        let _failing = Failing::when(vec![Box::new(|kind, path, _| kind == Change::List && path.to_string_lossy().ends_with(".appiconset"))]);
        let error = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]).unwrap_err();
        assert!(error.starts_with("Couldn't look inside App/AppIcon.appiconset, because"), "{error}");
        assert!(error.ends_with("Nothing was changed."), "{error}");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture");
        assert_eq!(fs::read_to_string(set.join("Extra.png")).unwrap(), "old extra");
        assert!(!set.join("AppIcon-Dark.png").exists());
        assert!(hidden_leftovers(&root).is_empty());
        // The same for an Android folder whose old files can't be listed.
        drop(_failing);
        let res = root.join("android/res/mipmap-hdpi");
        fs::create_dir_all(&res).unwrap();
        fs::write(res.join("ic_launcher.webp"), "old").unwrap();
        let _failing = Failing::when(vec![Box::new(|kind, path, _| kind == Change::List && named(path, "mipmap-hdpi"))]);
        let error = write(&root, vec![file("android/res/mipmap-hdpi/ic_launcher.png", "new")], &[], &["android/res"]).unwrap_err();
        assert!(error.contains("Couldn't look inside android/res/mipmap-hdpi") && error.ends_with("Nothing was changed."), "{error}");
        assert!(!res.join("ic_launcher.png").exists());
        assert!(res.join("ic_launcher.webp").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_icon_set_the_app_may_not_read_is_never_half_cleared() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("unreadable-set");
        let set = old_set(&root);
        fs::write(set.join("Extra.png"), "old extra").unwrap();
        // Files can still be made in it, but its list of files can't be read.
        fs::set_permissions(&set, fs::Permissions::from_mode(0o300)).unwrap();
        let result = write(&root, new_set_files(), &["App/AppIcon.appiconset"], &[]);
        fs::set_permissions(&set, fs::Permissions::from_mode(0o755)).unwrap();
        let error = result.unwrap_err();
        assert!(error.contains("because the app isn't allowed to open the folder. Nothing was changed."), "{error}");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture");
        assert_eq!(fs::read_to_string(set.join("Extra.png")).unwrap(), "old extra");
        assert!(hidden_leftovers(&root).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_write_waits_for_another_build_holding_its_folder_and_gives_up_in_time() {
        let root = temp_root("other-build");
        let directory = root.to_string_lossy().into_owned();
        // Another build of the app, with a data folder of its own, is writing here.
        let held = folder_lock::hold_all(std::slice::from_ref(&root), Instant::now() + Duration::from_secs(5)).unwrap();
        let waiting = {
            let (directory, granted) = (directory.clone(), granted_in(&root));
            std::thread::spawn(move || write_request(granted, None, &directory, vec![file("a.txt", "one")], &[], &[], OTHER_WRITE_WAIT))
        };
        std::thread::sleep(Duration::from_millis(400));
        assert!(!waiting.is_finished(), "the write waits for the folder");
        drop(held);
        waiting.join().unwrap().unwrap();
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "one");
        // Held for longer than the write waits: it gives up, and nothing changes.
        let _held = folder_lock::hold_all(std::slice::from_ref(&root), Instant::now() + Duration::from_secs(5)).unwrap();
        let error = write_request(granted_in(&root), None, &directory, vec![file("a.txt", "two")], &[], &[], Duration::from_millis(300)).unwrap_err();
        assert_eq!(error, STILL_SAVING);
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "one");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn writes_into_nested_folders_take_turns_and_writes_elsewhere_do_not_wait() {
        let root = temp_root("nested");
        fs::create_dir_all(root.join("ios/App")).unwrap();
        fs::create_dir_all(root.join("android/res")).unwrap();
        // Another build picked the ios folder and is writing in it.
        let _held = folder_lock::hold_all(&[root.join("ios")], Instant::now() + Duration::from_secs(5)).unwrap();
        let soon = || Instant::now() + Duration::from_millis(200);
        // A write over the whole project that goes into ios waits for it.
        let into_ios = folder_lock::folders_on_the_way(&root, &[root.join("ios/App/AppIcon.png")]);
        assert!(into_ios.contains(&root) && into_ios.contains(&root.join("ios")) && into_ios.contains(&root.join("ios/App")), "{into_ios:?}");
        assert!(folder_lock::hold_all(&into_ios, soon()).is_err());
        // One that only goes into android doesn't.
        let into_android = folder_lock::folders_on_the_way(&root, &[root.join("android/res/mipmap-hdpi/ic_launcher.png")]);
        assert!(!into_android.contains(&root.join("android/res/mipmap-hdpi")), "folders still to be made aren't locked");
        assert!(folder_lock::hold_all(&into_android, soon()).is_ok());
        fs::remove_dir_all(&root).unwrap();
    }

    /// Not a test by itself. Run as a second process by the test below, it
    /// holds a folder's lock the way another build of the app writing there
    /// would, until it is told to let go.
    #[test]
    fn hold_a_folder_as_another_process() {
        let (Ok(folder), Ok(mark), Ok(release)) = (std::env::var("OSG_HOLD_FOLDER"), std::env::var("OSG_HELD_MARK"), std::env::var("OSG_RELEASE_WHEN")) else {
            return;
        };
        let _held = folder_lock::hold_all(&[PathBuf::from(folder)], Instant::now() + Duration::from_secs(5)).expect("the folder was free");
        fs::write(&mark, std::process::id().to_string()).unwrap();
        let until = Instant::now() + Duration::from_secs(30);
        while !Path::new(&release).exists() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn a_write_waits_for_another_process_holding_its_folder() {
        let root = temp_root("other-process");
        let signals = temp_root("other-process-signals");
        let (mark, release) = (signals.join("held"), signals.join("release"));
        let mut other = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "icon_export::tests::hold_a_folder_as_another_process", "--test-threads=1"])
            .env("OSG_HOLD_FOLDER", &root)
            .env("OSG_HELD_MARK", &mark)
            .env("OSG_RELEASE_WHEN", &release)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let until = Instant::now() + Duration::from_secs(20);
        while !mark.exists() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(20));
        }
        let other_pid: u32 = fs::read_to_string(&mark).expect("the other process holds the folder").parse().unwrap();
        assert_ne!(other_pid, std::process::id());
        let directory = root.to_string_lossy().into_owned();
        let granted = granted_in(&root);
        let waiting = std::thread::spawn(move || write_request(granted, None, &directory, vec![file("a.txt", "mine")], &[], &[], OTHER_WRITE_WAIT));
        std::thread::sleep(Duration::from_millis(500));
        assert!(!waiting.is_finished(), "the write waits while the other process holds the folder");
        assert!(!root.join("a.txt").exists());
        fs::write(&release, "").unwrap();
        waiting.join().unwrap().unwrap();
        assert!(other.wait().unwrap().success());
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "mine");
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&signals).unwrap();
    }

    #[test]
    fn a_save_queued_in_this_app_gives_up_in_time_too() {
        let root = temp_root("queued");
        let directory = root.to_string_lossy().into_owned();
        // Another window of this app is saving, for longer than this save waits.
        let (holding, held) = std::sync::mpsc::channel();
        let other_window = std::thread::spawn(move || {
            let _turn = WRITING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            holding.send(()).unwrap();
            std::thread::sleep(Duration::from_secs(2));
        });
        held.recv().unwrap();
        let started = Instant::now();
        let answer = write_request(granted_in(&root), None, &directory, vec![file("a.txt", "one")], &[], &[], Duration::from_millis(300));
        let waited = started.elapsed();
        other_window.join().unwrap();
        assert_eq!(answer.unwrap_err(), STILL_SAVING);
        assert!(waited < Duration::from_millis(1500), "gave up after {waited:?}, not when the other window finished");
        assert!(!root.join("a.txt").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn another_build_cannot_lock_a_folder_this_save_made_while_it_writes_there() {
        let root = temp_root("made-locked");
        let made = root.join("Pebble icon");
        let found_busy = std::rc::Rc::new(std::cell::Cell::new(None));
        let _hook = {
            let (made, found_busy) = (made.clone(), found_busy.clone());
            AtCheckpoint::run(Box::new(move |name, path| {
                if name == "locked" && path == made.as_path() {
                    // Another build picks the new folder now, from a process of its own.
                    let folder = made.clone();
                    let busy = std::thread::spawn(move || matches!(folder_lock::hold_all(&[folder], Instant::now() + Duration::from_millis(200)), Err(folder_lock::LockError::Busy)));
                    found_busy.set(Some(busy.join().unwrap()));
                }
            }))
        };
        write(&root, vec![file("Pebble icon/README.txt", "hi"), file("Pebble icon/ios/Contents.json", "{}")], &[], &[]).unwrap();
        assert_eq!(found_busy.get(), Some(true), "the other build found the new folder held");
        assert_eq!(fs::read_to_string(made.join("README.txt")).unwrap(), "hi");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_save_puts_nothing_in_a_folder_it_made_until_it_holds_it() {
        let root = temp_root("made-taken");
        let made = root.join("Pebble icon");
        type Other = std::thread::JoinHandle<(bool, Instant)>;
        let other: std::rc::Rc<std::cell::RefCell<Option<Other>>> = std::rc::Rc::new(std::cell::RefCell::new(None));
        let _hook = {
            let (made, other) = (made.clone(), other.clone());
            AtCheckpoint::run(Box::new(move |name, path| {
                if name == "made" && path == made.as_path() {
                    // In the moment between making the folder and locking it, another build takes it.
                    let folder = made.clone();
                    let (holding, held) = std::sync::mpsc::channel();
                    *other.borrow_mut() = Some(std::thread::spawn(move || {
                        let _lock = folder_lock::hold_all(std::slice::from_ref(&folder), Instant::now() + Duration::from_secs(5)).unwrap();
                        holding.send(()).unwrap();
                        std::thread::sleep(Duration::from_millis(400));
                        let empty = fs::read_dir(&folder).unwrap().next().is_none();
                        (empty, Instant::now())
                    }));
                    held.recv().unwrap();
                }
            }))
        };
        write(&root, vec![file("Pebble icon/README.txt", "hi")], &[], &[]).unwrap();
        let finished = Instant::now();
        let (empty, let_go) = other.borrow_mut().take().unwrap().join().unwrap();
        assert!(empty, "nothing went into the folder while the other build held it");
        assert!(finished >= let_go, "the save went on only after the other build let go");
        assert_eq!(fs::read_to_string(made.join("README.txt")).unwrap(), "hi");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_folder_that_cannot_be_locked_stops_the_save_unchanged() {
        let root = temp_root("no-locks");
        let set = old_set(&root);
        // As on a network drive with no locks.
        let _no_locks = crate::folder_lock::tests::NoLocksOn::folder(&set);
        let error = write_request(granted_in(&root), None, &root.to_string_lossy(), new_set_files(), &["App/AppIcon.appiconset".to_string()], &[], OTHER_WRITE_WAIT).unwrap_err();
        assert!(error.starts_with("Couldn't save into App/AppIcon.appiconset, because the drive it's on doesn't let the app lock the folder"), "{error}");
        assert!(error.ends_with("Nothing was changed."), "{error}");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture");
        assert!(!set.join("AppIcon-Dark.png").exists());
        assert!(hidden_leftovers(&root).is_empty());
        // A folder the save makes is held to the same rule.
        drop(_no_locks);
        let _no_locks = crate::folder_lock::tests::NoLocksOn::folder(&root.join("Pebble icon"));
        let error = write(&root, vec![file("Pebble icon/README.txt", "hi")], &[], &[]).unwrap_err();
        assert!(error.starts_with("Couldn't save into Pebble icon, because the drive") && error.ends_with("Nothing was changed."), "{error}");
        assert!(!root.join("Pebble icon").exists(), "the folder it made is taken back");
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_on_the_way_the_app_may_not_open_stops_the_save() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("closed-on-the-way");
        let set = old_set(&root);
        // Files can be reached through it, but it can't be opened, so it can't be locked.
        fs::set_permissions(root.join("App"), fs::Permissions::from_mode(0o300)).unwrap();
        let result = write_request(granted_in(&root), None, &root.to_string_lossy(), new_set_files(), &["App/AppIcon.appiconset".to_string()], &[], OTHER_WRITE_WAIT);
        fs::set_permissions(root.join("App"), fs::Permissions::from_mode(0o755)).unwrap();
        let error = result.unwrap_err();
        assert_eq!(error, "Couldn't save into App, because the app isn't allowed to open the folder. Nothing was changed.");
        assert_eq!(fs::read_to_string(set.join("AppIcon.png")).unwrap(), "old picture");
        assert!(hidden_leftovers(&root).is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    fn zip_data(text: &str) -> String {
        base64::engine::general_purpose::STANDARD.encode(text)
    }

    /// Leftovers of saves of the zip `name`, beside it or in the app's
    /// temporary folder (each test saves a zip of its own name, since the
    /// tests run at once and share that folder).
    fn zip_leftovers(folder: &Path, name: &str) -> Vec<String> {
        let mut found = hidden_leftovers(folder);
        if let Ok(entries) = fs::read_dir(std::env::temp_dir()) {
            found.extend(
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .filter(|entry| entry.starts_with(&format!(".{name}.{}-", std::process::id())) && entry.ends_with(".osg-part")),
            );
        }
        found
    }

    #[test]
    fn a_zip_replaces_the_old_one_in_one_step_where_the_dialog_said() {
        let root = temp_root("zip");
        let zip = root.join("Replaced icon.zip");
        let path = zip.to_string_lossy().into_owned();
        let that_file = {
            let zip = zip.clone();
            move |file: &Path| file == zip.as_path()
        };
        zip_request(that_file.clone(), &path, zip_data("first")).unwrap();
        let result = zip_request(that_file.clone(), &path, zip_data("second")).unwrap();
        assert!(result.left_over.is_empty());
        assert_eq!(fs::read_to_string(&zip).unwrap(), "second");
        // A save that stops halfway, as on a full disk, leaves the zip that was there.
        {
            let _failing = Failing::when(vec![Box::new(|kind, path, _| kind == Change::Write && path.to_string_lossy().contains("Replaced icon.zip"))]);
            let error = zip_request(that_file.clone(), &path, zip_data("third")).unwrap_err();
            assert!(error.ends_with("Nothing was changed."), "{error}");
        }
        assert_eq!(fs::read_to_string(&zip).unwrap(), "second");
        assert!(zip_leftovers(&root, "Replaced icon.zip").is_empty(), "{:?}", zip_leftovers(&root, "Replaced icon.zip"));
        // Only the file the dialog gave, and only a zip.
        let elsewhere = root.join("other.zip").to_string_lossy().into_owned();
        assert!(zip_request(that_file.clone(), &elsewhere, zip_data("x")).unwrap_err().contains("Pick the place again"));
        assert!(!root.join("other.zip").exists());
        let not_a_zip = root.join("notes.txt").to_string_lossy().into_owned();
        assert!(zip_request(|_: &Path| true, &not_a_zip, zip_data("x")).unwrap_err().contains("isn't a zip file"));
        fs::remove_dir_all(&root).unwrap();
    }

    /// The App Store sandbox after its save dialog: nothing new may be made
    /// in the zip's own folder (and the folder can't even be opened).
    fn sandboxed_beside(folder: &Path) -> FailingAs {
        let folder = folder.to_path_buf();
        FailingAs::when(vec![Box::new(move |kind, path, _| (kind == Change::NewFile && path.parent() == Some(folder.as_path())).then_some(std::io::ErrorKind::PermissionDenied))])
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn where_nothing_new_may_go_beside_it_the_zip_comes_through_the_replacement_folder() {
        let root = temp_root("zip-sandbox");
        let zip = root.join("Sandboxed icon.zip");
        fs::write(&zip, "old").unwrap();
        let used: std::rc::Rc<std::cell::RefCell<Vec<PathBuf>>> = std::rc::Rc::new(std::cell::RefCell::new(Vec::new()));
        let _seen = {
            let used = used.clone();
            AtCheckpoint::run(Box::new(move |name, path| {
                if name == "replacement folder" {
                    used.borrow_mut().push(path.to_path_buf());
                }
            }))
        };
        let _sandbox = sandboxed_beside(&root);
        let before = std::os::unix::fs::MetadataExt::ino(&fs::metadata(&zip).unwrap());
        let result = zip_request(|_: &Path| true, &zip.to_string_lossy(), zip_data("new")).unwrap();
        assert!(result.left_over.is_empty());
        assert_eq!(fs::read_to_string(&zip).unwrap(), "new");
        assert_ne!(std::os::unix::fs::MetadataExt::ino(&fs::metadata(&zip).unwrap()), before, "renamed into place, not written over");
        let used = used.borrow();
        assert_eq!(used.len(), 1, "macOS gave one replacement folder: {used:?}");
        assert!(!used[0].exists(), "and it's gone after the save: {:?}", used[0]);
        assert!(zip_leftovers(&root, "Sandboxed icon.zip").is_empty());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn where_no_one_step_replacement_can_be_had_the_zip_is_refused_and_the_old_one_kept() {
        let root = temp_root("zip-no-swap");
        let zip = root.join("Kept icon.zip");
        fs::write(&zip, "old zip").unwrap();
        let _sandbox = sandboxed_beside(&root);
        // No replacement folder at all.
        {
            let _none = ReplacementFolder::is(Box::new(|_| Some(None)));
            let error = zip_request(|_: &Path| true, &zip.to_string_lossy(), zip_data("new")).unwrap_err();
            assert_eq!(error, "Couldn't save Kept icon.zip there, because the app can't put the new zip beside it to swap it in. Nothing was changed.");
        }
        assert_eq!(fs::read_to_string(&zip).unwrap(), "old zip");
        // A folder on another drive than the zip, which no rename crosses: refused, the folder taken away.
        let elsewhere = temp_root("zip-no-swap-elsewhere");
        {
            let given = elsewhere.join("given");
            fs::create_dir(&given).unwrap();
            let _given = ReplacementFolder::is(Box::new(move |_| Some(Some(given.clone()))));
            drop(_sandbox);
            let folder = root.clone();
            let _drives = FailingAs::when(vec![Box::new(move |kind, path, to| match kind {
                Change::NewFile if path.parent() == Some(folder.as_path()) => Some(std::io::ErrorKind::PermissionDenied),
                Change::Rename if to.and_then(Path::parent) == Some(folder.as_path()) => Some(std::io::ErrorKind::CrossesDevices),
                _ => None,
            })]);
            let error = zip_request(|_: &Path| true, &zip.to_string_lossy(), zip_data("new")).unwrap_err();
            assert!(error.starts_with("Couldn't save Kept icon.zip there, because") && error.ends_with("Nothing was changed."), "{error}");
        }
        assert_eq!(fs::read_to_string(&zip).unwrap(), "old zip", "never written in place");
        assert!(!elsewhere.join("given").exists(), "the replacement folder is taken away");
        assert!(zip_leftovers(&root, "Kept icon.zip").is_empty());
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&elsewhere).unwrap();
    }

    /// The payload writer `writer` saves in round `round`: the same line, many
    /// times, so a reader can tell a whole zip from a cut or mixed one.
    fn zip_payload(writer: &str, round: u32) -> String {
        format!("{writer} round {round:03};").repeat(6000)
    }

    /// Whether `seen` is one whole payload of some writer and round.
    fn whole_payload(seen: &str) -> bool {
        match seen.split_once(';') {
            Some((line, _)) => seen == format!("{line};").repeat(6000),
            None => false,
        }
    }

    /// Not a test by itself: one zip writer of the test below, in a process of
    /// its own, saving the same zip over and over in its own way.
    #[test]
    fn zip_writer() {
        let (Ok(zip), Ok(kind), Ok(answers)) = (std::env::var("OSG_ZIP_TARGET"), std::env::var("OSG_ZIP_KIND"), std::env::var("OSG_ZIP_ANSWERS")) else {
            return;
        };
        let zip = PathBuf::from(zip);
        let folder = zip.parent().unwrap().to_path_buf();
        let _rules = match kind.as_str() {
            "sandboxed" => Some(sandboxed_beside(&folder)),
            "cut-short" => None,
            "no-swap" => {
                let folder = folder.clone();
                Some(FailingAs::when(vec![Box::new(move |change, path, to| match change {
                    Change::NewFile if path.parent() == Some(folder.as_path()) => Some(std::io::ErrorKind::PermissionDenied),
                    Change::Rename if to.and_then(Path::parent) == Some(folder.as_path()) => Some(std::io::ErrorKind::CrossesDevices),
                    _ => None,
                })]))
            }
            _ => None,
        };
        let _cut = (kind == "cut-short").then(|| Failing::when(vec![Box::new(|change, _, _| change == Change::Write)]));
        let mut lines = Vec::new();
        for round in 0..15 {
            let result = zip_request(|_: &Path| true, &zip.to_string_lossy(), base64::engine::general_purpose::STANDARD.encode(zip_payload(&kind, round)));
            lines.push(match result {
                Ok(_) => "saved".to_string(),
                Err(e) => format!("refused {e}"),
            });
        }
        fs::write(answers, lines.join("\n")).unwrap();
    }

    #[test]
    fn zip_saves_from_many_processes_are_never_seen_broken_and_a_failed_one_never_takes_a_whole_one_away() {
        // Five other processes save one zip over and over at once: two the usual way, one as
        // the App Store sandbox does (through the replacement folder on a Mac), one whose every
        // save stops halfway, as on a full disk, and one where no one-step replacement can be
        // had. A reader here keeps opening the zip all the while.
        let root = temp_root("zip-processes");
        let zip = root.join("Shared icon.zip");
        fs::write(&zip, zip_payload("first", 0)).unwrap();
        let mut kinds = vec!["usual-a", "usual-b", "cut-short", "no-swap"];
        if cfg!(target_os = "macos") {
            kinds.push("sandboxed");
        }
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reader = {
            let (zip, stop) = (zip.clone(), stop.clone());
            std::thread::spawn(move || {
                let (mut reads, mut broken) = (0, Vec::new());
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    match fs::read_to_string(&zip) {
                        Ok(seen) if whole_payload(&seen) => {}
                        Ok(seen) => broken.push(format!("{} bytes starting {:?}", seen.len(), &seen[..seen.len().min(30)])),
                        Err(e) => broken.push(format!("couldn't open it: {e}")),
                    }
                    reads += 1;
                }
                (reads, broken)
            })
        };
        let writers: Vec<(&str, PathBuf, std::process::Child)> = kinds
            .iter()
            .map(|kind| {
                let answers = root.with_extension(format!("{kind}.answers"));
                let child = std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "icon_export::tests::zip_writer", "--test-threads=1"])
                    .env("OSG_ZIP_TARGET", &zip)
                    .env("OSG_ZIP_KIND", kind)
                    .env("OSG_ZIP_ANSWERS", &answers)
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .unwrap();
                (*kind, answers, child)
            })
            .collect();
        let mut answers = std::collections::HashMap::new();
        for (kind, file, mut child) in writers {
            assert!(child.wait().unwrap().success(), "writer {kind} failed");
            answers.insert(kind, fs::read_to_string(&file).unwrap());
            fs::remove_file(&file).unwrap();
        }
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let (reads, broken) = reader.join().unwrap();
        assert!(broken.is_empty(), "the reader saw a broken zip {} times in {reads} reads: {:?}", broken.len(), &broken[..broken.len().min(3)]);
        assert!(reads > 50, "the reader kept up ({reads} reads)");
        for kind in ["usual-a", "usual-b", "sandboxed"] {
            if let Some(lines) = answers.get(kind) {
                assert!(lines.lines().all(|line| line == "saved"), "{kind}: {lines}");
            }
        }
        assert!(answers["cut-short"].lines().all(|line| line.starts_with("refused") && line.ends_with("Nothing was changed.")), "{}", answers["cut-short"]);
        assert!(answers["no-swap"].lines().all(|line| line.starts_with("refused Couldn't save Shared icon.zip there, because")), "{}", answers["no-swap"]);
        // A whole zip is there at the end, from a save that went through.
        let last = fs::read_to_string(&zip).unwrap();
        assert!(whole_payload(&last) && (last.starts_with("usual") || last.starts_with("sandboxed")), "{}", &last[..40]);
        assert!(hidden_leftovers(&root).is_empty(), "{:?}", hidden_leftovers(&root));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn zips_saved_at_once_over_each_other_are_never_seen_broken() {
        // Four saves at a time, over and over, while a reader keeps opening the zip:
        // it's always one whole zip, never a mix or a cut.
        let root = temp_root("zip-race");
        let zip = root.join("Raced icon.zip");
        let payload = |writer: usize| format!("writer {writer}: ").repeat(4000);
        fs::write(&zip, payload(9)).unwrap();
        let wholes: HashSet<String> = (0..10).map(payload).collect();
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reader = {
            let (zip, stop, wholes) = (zip.clone(), stop.clone(), wholes.clone());
            std::thread::spawn(move || {
                let mut reads = 0;
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    let seen = fs::read_to_string(&zip).unwrap();
                    assert!(wholes.contains(&seen), "a broken zip was seen ({} bytes)", seen.len());
                    reads += 1;
                }
                reads
            })
        };
        let writers: Vec<_> = (0..4)
            .map(|writer| {
                let path = zip.to_string_lossy().into_owned();
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        zip_request(|_: &Path| true, &path, base64::engine::general_purpose::STANDARD.encode(format!("writer {writer}: ").repeat(4000))).unwrap();
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let reads = reader.join().unwrap();
        assert!(reads > 10, "the reader kept up ({reads} reads)");
        assert!(wholes.contains(&fs::read_to_string(&zip).unwrap()));
        assert!(zip_leftovers(&root, "Raced icon.zip").is_empty(), "{:?}", zip_leftovers(&root, "Raced icon.zip"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_folder_another_save_made_while_this_one_waited_is_locked_before_use() {
        // The audit's case: save B lists its folders while save A holds the project and makes
        // `made` in it; the moment A lets go, a third save picks `made` and holds it. B has to
        // wait for that one before it puts anything in `made`.
        let root = temp_root("appeared");
        let made = root.join("made");
        let directory = root.to_string_lossy().into_owned();
        let save_a = folder_lock::hold_all(std::slice::from_ref(&root), Instant::now() + Duration::from_secs(5)).unwrap();
        let save_b = {
            let (directory, granted) = (directory.clone(), granted_in(&root));
            std::thread::spawn(move || {
                let answer = write_request(granted, None, &directory, vec![file("made/README.txt", "from B")], &[], &[], OTHER_WRITE_WAIT);
                (answer, Instant::now())
            })
        };
        // B has listed its folders (made/ wasn't there) and waits for the project.
        std::thread::sleep(Duration::from_millis(300));
        fs::create_dir(&made).unwrap();
        let (holding, held) = std::sync::mpsc::channel();
        let third = {
            let made = made.clone();
            std::thread::spawn(move || {
                let _lock = folder_lock::hold_all(std::slice::from_ref(&made), Instant::now() + Duration::from_secs(5)).unwrap();
                holding.send(()).unwrap();
                std::thread::sleep(Duration::from_millis(500));
                (fs::read_dir(&made).unwrap().next().is_none(), Instant::now())
            })
        };
        held.recv().unwrap();
        drop(save_a);
        let (untouched, let_go) = third.join().unwrap();
        let (answer, finished) = save_b.join().unwrap();
        answer.unwrap();
        assert!(untouched, "save B put nothing in made/ while the third save held it");
        assert!(finished >= let_go, "save B went on only after the third save let go");
        assert_eq!(fs::read_to_string(made.join("README.txt")).unwrap(), "from B");
        fs::remove_dir_all(&root).unwrap();
    }

    /// Not a test by itself: save Y of the test below, as another build of the
    /// app would run it, in a process of its own.
    #[test]
    fn circle_writer() {
        let (Ok(directory), Ok(answer)) = (std::env::var("OSG_CIRCLE_DIR"), std::env::var("OSG_CIRCLE_ANSWER")) else {
            return;
        };
        let result = write_request(|_: &Path| true, None, &directory, vec![file("inner/y.txt", "from Y")], &[], &[], Duration::from_secs(5));
        fs::write(answer, format!("{result:?}")).unwrap();
    }

    #[test]
    fn two_saves_never_wait_on_each_other_in_a_circle_even_where_a_folder_is_older_than_its_parent() {
        // `inner` is older than the `outer` it's moved into, so its identity sorts first.
        // Save B holds `outer` and, at "listed", finds `inner` new on its way. Save Y, another
        // build, starts then, wanting `outer` and `inner`. Taken by identity, Y would hold
        // `inner` and wait for `outer` while B waits for `inner`: both stuck until their time
        // runs out. Taken top down, Y waits for `outer` holding nothing.
        let root = temp_root("circle");
        let older = root.join("older-inner");
        fs::create_dir(&older).unwrap();
        let outer = root.join("outer");
        fs::create_dir(&outer).unwrap();
        let inner = outer.join("inner");
        let directory = outer.to_string_lossy().into_owned();
        let answer = root.join("y-answer.txt");
        let other: std::rc::Rc<std::cell::RefCell<Option<std::process::Child>>> = std::rc::Rc::new(std::cell::RefCell::new(None));
        let _hook = {
            let (older, inner, other, directory, answer) = (older.clone(), inner.clone(), other.clone(), directory.clone(), answer.clone());
            AtCheckpoint::run(Box::new(move |name, _| {
                if name != "listed" || other.borrow().is_some() {
                    return;
                }
                // The save B waited for left `inner` on its way: an older folder, moved in.
                fs::rename(&older, &inner).unwrap();
                *other.borrow_mut() = Some(
                    std::process::Command::new(std::env::current_exe().unwrap())
                        .args(["--exact", "icon_export::tests::circle_writer", "--test-threads=1"])
                        .env("OSG_CIRCLE_DIR", &directory)
                        .env("OSG_CIRCLE_ANSWER", &answer)
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .spawn()
                        .unwrap(),
                );
                // Give Y the time to start and take whatever it takes first.
                let until = Instant::now() + Duration::from_millis(1500);
                while Instant::now() < until {
                    if matches!(folder_lock::hold_all(std::slice::from_ref(&inner), Instant::now()), Err(folder_lock::LockError::Busy)) {
                        std::thread::sleep(Duration::from_millis(100));
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
            }))
        };
        // B may wait for other tests' saves in this process first; Y's short wait is what shows a circle.
        let save_b = write_request(granted_in(&root), None, &directory, vec![file("inner/b.txt", "from B")], &[], &[], Duration::from_secs(20));
        assert!(other.borrow_mut().as_mut().unwrap().wait().unwrap().success());
        let save_y = fs::read_to_string(&answer).unwrap();
        assert!(save_b.is_ok(), "save B: {save_b:?}");
        assert!(save_y.starts_with("Ok("), "save Y: {save_y}");
        assert_eq!(fs::read_to_string(inner.join("b.txt")).unwrap(), "from B");
        assert_eq!(fs::read_to_string(inner.join("y.txt")).unwrap(), "from Y");
        fs::remove_dir_all(&root).unwrap();
    }

    fn append_line(log: &str, line: &str) {
        let mut out = fs::OpenOptions::new().append(true).create(true).open(log).unwrap();
        out.write_all(format!("{line}\n").as_bytes()).unwrap();
    }

    fn nanos_now() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    /// Not a test by itself: one writer of the test below, as a process of its
    /// own. It saves at random into a shared tree, rooted where a person might
    /// pick (any folder there now, some made by the others a moment ago), and
    /// logs when it holds its folders and which folders it writes in.
    #[test]
    fn stress_writer() {
        let (Ok(root), Ok(log), Ok(seed), Ok(rounds)) = (
            std::env::var("OSG_STRESS_ROOT"),
            std::env::var("OSG_STRESS_LOG"),
            std::env::var("OSG_STRESS_SEED"),
            std::env::var("OSG_STRESS_ROUNDS"),
        ) else {
            return;
        };
        let root = PathBuf::from(root);
        let mut state: u64 = seed.parse().unwrap();
        let mut next = move |below: u64| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state % below
        };
        let pid = std::process::id();
        for round in 0..rounds.parse::<u32>().unwrap() {
            let mut folders = vec![root.clone()];
            for first in ["a", "b"] {
                let one = root.join(first);
                if one.is_dir() {
                    folders.push(one.clone());
                    for second in ["c", "d"] {
                        if one.join(second).is_dir() {
                            folders.push(one.join(second));
                        }
                    }
                }
            }
            let picked = folders[next(folders.len() as u64) as usize].clone();
            let mut paths = std::collections::BTreeSet::new();
            for _ in 0..1 + next(4) {
                let mut path = String::new();
                for _ in 0..next(3) {
                    path.push_str(["a", "b", "c", "d"][next(4) as usize]);
                    path.push('/');
                }
                path.push_str(&format!("f{}.txt", next(3)));
                paths.insert(path);
            }
            let content = format!("{pid}-{round}");
            let files: Vec<ExportFile> = paths.iter().map(|path| file(path, &content)).collect();
            let parents: std::collections::BTreeSet<String> = paths.iter().map(|path| picked.join(path).parent().unwrap().to_string_lossy().into_owned()).collect();
            let asked = nanos_now();
            let _hook = {
                let (log, parents) = (log.clone(), parents.into_iter().collect::<Vec<_>>().join("|"));
                AtCheckpoint::run(Box::new(move |name, _| match name {
                    "start" => append_line(&log, &format!("enter {pid} {round} {} {parents}", nanos_now())),
                    "done" => append_line(&log, &format!("exit {pid} {round} {}", nanos_now())),
                    _ => {}
                }))
            };
            match write_request(|_: &Path| true, None, &picked.to_string_lossy(), files, &[], &[], Duration::from_secs(20)) {
                Ok(_) => append_line(&log, &format!("ok {pid} {round} {asked}")),
                Err(e) => append_line(&log, &format!("error {pid} {round} {e}")),
            }
        }
    }

    #[test]
    fn many_processes_saving_at_random_never_write_in_one_folder_at_once() {
        const WRITERS: u64 = 6;
        const ROUNDS: u64 = 30;
        let root = temp_root("stress");
        fs::create_dir_all(root.join("a")).unwrap();
        let log = root.with_extension("log");
        let _ = fs::remove_file(&log);
        let mut writers: Vec<std::process::Child> = (0..WRITERS)
            .map(|n| {
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "icon_export::tests::stress_writer", "--test-threads=1"])
                    .env("OSG_STRESS_ROOT", &root)
                    .env("OSG_STRESS_LOG", &log)
                    .env("OSG_STRESS_SEED", (n * 7919 + 13).to_string())
                    .env("OSG_STRESS_ROUNDS", ROUNDS.to_string())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .unwrap()
            })
            .collect();
        let until = Instant::now() + Duration::from_secs(150);
        for writer in writers.iter_mut() {
            loop {
                if let Some(status) = writer.try_wait().unwrap() {
                    assert!(status.success(), "a writer failed");
                    break;
                }
                if Instant::now() > until {
                    let _ = writer.kill();
                    panic!("a writer never finished: the saves waited on each other in a circle");
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        struct Save {
            asked: u128,
            enter: u128,
            exit: u128,
            folders: HashSet<String>,
        }
        let mut saves: std::collections::HashMap<(String, String), Save> = std::collections::HashMap::new();
        let mut errors = Vec::new();
        for line in fs::read_to_string(&log).unwrap().lines() {
            let parts: Vec<&str> = line.splitn(5, ' ').collect();
            let key = (parts[1].to_string(), parts[2].to_string());
            let entry = saves.entry(key).or_insert(Save { asked: 0, enter: 0, exit: 0, folders: HashSet::new() });
            match parts[0] {
                "enter" => {
                    entry.enter = parts[3].parse().unwrap();
                    entry.folders = parts[4].split('|').map(String::from).collect();
                }
                "exit" => entry.exit = parts[3].parse().unwrap(),
                "ok" => entry.asked = parts[3].parse().unwrap(),
                _ => errors.push(line.to_string()),
            }
        }
        assert!(errors.is_empty(), "saves that didn't go through: {errors:?}");
        assert_eq!(saves.len() as u64, WRITERS * ROUNDS);
        let saves: Vec<&Save> = saves.values().collect();
        let (mut together, mut clashes) = (0, Vec::new());
        for (at, one) in saves.iter().enumerate() {
            for other in &saves[at + 1..] {
                if one.enter < other.exit && other.enter < one.exit {
                    let shared: Vec<&String> = one.folders.intersection(&other.folders).collect();
                    if shared.is_empty() {
                        together += 1;
                    } else {
                        clashes.push(format!("{shared:?}"));
                    }
                }
            }
        }
        let waited = saves.iter().filter(|save| save.enter.saturating_sub(save.asked) > 20_000_000).count();
        let report = format!("{} saves by {WRITERS} processes: {together} pairs wrote at the same moment in different folders, {waited} saves waited over 20 ms for another", saves.len());
        eprintln!("{report}");
        assert!(clashes.is_empty(), "two saves wrote in one folder at once: {clashes:?}");
        assert!(together > 0 && waited > 0, "the saves both overlapped and waited: {report}");
        fs::remove_dir_all(&root).unwrap();
        fs::remove_file(&log).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_scan_names_every_folder_it_could_not_look_in() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = temp_root("scan-gaps");
        let outside = temp_root("scan-gaps-outside");
        fs::create_dir_all(root.join("ios/Pebble/Assets.xcassets/AppIcon.appiconset")).unwrap();
        // Past the scan's depth.
        let deep: PathBuf = (0..SCAN_DEPTH + 1).fold(root.join("deep"), |path, level| path.join(format!("l{level}")));
        fs::create_dir_all(&deep).unwrap();
        // One the system won't open.
        fs::create_dir_all(root.join("locked/inner")).unwrap();
        fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o000)).unwrap();
        // A link to a folder, which the scan doesn't follow.
        symlink(&outside, root.join("shared")).unwrap();
        // Passed over on purpose, not counted.
        fs::create_dir_all(root.join("node_modules/x/y")).unwrap();
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        let found = scan(&root);
        fs::set_permissions(root.join("locked"), fs::Permissions::from_mode(0o755)).unwrap();
        let reasons: Vec<(String, String)> = found.not_looked_in.iter().map(|place| (place.path.clone(), place.reason.clone())).collect();
        assert!(reasons.iter().any(|(path, reason)| reason == "deep" && path.starts_with("deep/")), "{reasons:?}");
        assert!(reasons.contains(&("locked".to_string(), "unreadable".to_string())), "{reasons:?}");
        assert!(reasons.contains(&("shared".to_string(), "link".to_string())), "{reasons:?}");
        assert_eq!(found.not_looked_in_count, 3, "{reasons:?}");
        assert_eq!(found.icon_sets.len(), 1);
        fs::remove_dir_all(&root).unwrap();
        fs::remove_dir_all(&outside).unwrap();
    }
}
