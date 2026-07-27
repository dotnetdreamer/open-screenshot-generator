//! One-time move of the per-user data directories from the pre-rename bundle
//! identifier to the current one.
//!
//! Every per-user path Tauri hands out is derived from the bundle identifier,
//! and on Windows that includes the WebView2 profile — so those directories
//! hold the projects, media blobs and API keys the app keeps in IndexedDB and
//! localStorage, not just settings.json. Changing the identifier without moving
//! them would look exactly like a factory reset to anyone who already had the
//! app installed.
//!
//! This has to run before Tauri initializes. By the time the `setup` hook fires
//! the main window already exists and WebView2 has created (and locked) a fresh
//! empty profile at the new path, which would make the move impossible.

use std::env;
use std::fs;
use std::path::PathBuf;

const OLD_IDENTIFIER: &str = "com.ccrstech.artboardstudio";
const NEW_IDENTIFIER: &str = "com.dotnetdreamer.openscreenshotgenerator";

/// The per-user roots the identifier gets appended to, per platform. These
/// mirror what Tauri's path resolver returns for app_config_dir /
/// app_local_data_dir / app_cache_dir. A root that does not resolve is skipped.
fn roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();

    // app_config_dir and app_data_dir sit under APPDATA; the WebView2 profile
    // and app_cache_dir sit under LOCALAPPDATA.
    #[cfg(target_os = "windows")]
    for var in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(dir) = env::var_os(var) {
            roots.push(PathBuf::from(dir));
        }
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        roots.push(home.join("Library/Application Support"));
        roots.push(home.join("Library/Caches"));
        // WKWebView keys its own data store off the bundle identifier as well.
        roots.push(home.join("Library/WebKit"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(home) = env::var_os("HOME") {
        let home = PathBuf::from(home);
        let resolve = |var: &str, fallback: &str| {
            env::var_os(var)
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(fallback))
        };
        roots.push(resolve("XDG_CONFIG_HOME", ".config"));
        roots.push(resolve("XDG_DATA_HOME", ".local/share"));
        roots.push(resolve("XDG_CACHE_HOME", ".cache"));
    }

    roots
}

/// Move each `<root>/com.ccrstech.artboardstudio` to the matching directory
/// under the current identifier. Safe to call on every launch: once the move
/// has happened the old directory is gone, so subsequent calls do nothing.
pub fn run() {
    for root in roots() {
        let old = root.join(OLD_IDENTIFIER);
        let new = root.join(NEW_IDENTIFIER);

        // Only ever move into an absent destination. If the new directory is
        // already there the migration has run, or the user has since started
        // fresh, and merging the two could mix a stale WebView2 profile into a
        // live one.
        if !old.is_dir() || new.exists() {
            continue;
        }

        match fs::rename(&old, &new) {
            Ok(()) => eprintln!("migrated {} to {}", old.display(), new.display()),
            // Leave the old directory untouched when this fails (a locked
            // profile from a second running instance, a cross-volume junction).
            // Starting with empty state is recoverable by moving the folder by
            // hand; a half-moved profile would not be.
            Err(error) => eprintln!("could not migrate {}: {error}", old.display()),
        }
    }
}
