//! The Microsoft Store build: the same exe as the installers, packed as an
//! MSIX (scripts/msix-pack.mjs).
//!
//! Windows treats AppData differently for a packaged app. Files the app creates
//! there go to a private copy under
//! `%LOCALAPPDATA%\Packages\<package family>\LocalCache`, which Windows deletes
//! on uninstall, while files that already exist in the real AppData are edited
//! in place. Every per-user path Tauri hands out hangs off the bundle
//! identifier, including the WebView2 profile that holds the projects. If the
//! Store build used the installer build's identifier, a machine with both would
//! end up with one profile split across the two places: LevelDB files edited in
//! the real folder, new ones only in the private copy.
//!
//! So inside a package the app runs under its own identifier. Nothing outside
//! the package ever writes that folder, so all of it lands in the private copy
//! and stays whole. The cost is that the two builds do not share projects, and
//! uninstalling the Store build removes its data, as with any Store app.
//! Writing the installer build's folders directly would need the restricted
//! `unvirtualizedResources` capability, which the Store refused for this app.

/// The identifier the packaged app runs under. It only names folders: the
/// package identity in src-tauri/msix/AppxManifest.xml is separate.
pub const STORE_IDENTIFIER: &str = "com.dotnetdreamer.openscreenshotgenerator.store";

/// Whether this process has package identity, which in practice means it was
/// started from the Microsoft Store install (or a test install of the MSIX).
#[cfg(windows)]
pub fn is_packaged() -> bool {
    use windows::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;

    // Asked with an empty buffer, this reports the length it needs when the
    // process belongs to a package and APPMODEL_ERROR_NO_PACKAGE when it does
    // not. Any other answer is treated as unpackaged, the installer build's
    // behaviour.
    let mut length = 0u32;
    let status = unsafe { GetCurrentPackageFullName(&mut length, None) };
    status == ERROR_INSUFFICIENT_BUFFER
}

#[cfg(not(windows))]
pub fn is_packaged() -> bool {
    false
}
