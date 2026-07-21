fn main() {
    // Ship a custom Windows app manifest: tauri-build's default (the
    // Common-Controls dependency) plus <longPathAware> — see the comment in
    // windows-app-manifest.xml. Everything else is stock tauri_build::build().
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
