fn main() {
    // tauri.macos.conf.json ships out-desktop/local as the app's `web`
    // resources, and tauri_build stops at a resource folder that is not there.
    // A checkout that has not run a desktop build yet has none, so an empty one
    // stands in until scripts/desktop-assets.mjs fills it.
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let _ = std::fs::create_dir_all(std::path::Path::new(&manifest_dir).join("../out-desktop/local"));
    }
    tauri_build::build()
}
