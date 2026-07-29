fn main() {
    // The bundled Runner plugin DLLs (bundle.resources glob
    // `resources/dth-runner/**/*`) are STAGED by scripts/fetch-runner.mjs —
    // beforeBuildCommand runs it for every real bundle, but plain
    // `cargo check`/`clippy`/`test` (CI, fresh clones) never fetch, and
    // tauri-build HARD-FAILS on a glob that matches nothing. Seed a
    // placeholder so the glob always matches; the app detects the missing
    // DLLs at runtime and reports "no bundled Runner" gracefully.
    let runner_dir = std::path::Path::new("resources/dth-runner");
    let staged = std::fs::read_dir(runner_dir).map(|d| d.count() > 0).unwrap_or(false);
    if !staged {
        std::fs::create_dir_all(runner_dir).expect("failed to create resources/dth-runner");
        std::fs::write(
            runner_dir.join("PLACEHOLDER.txt"),
            "No Runner DLLs staged - run `pnpm fetch:runner` (release builds do via beforeBuildCommand).\n",
        )
        .expect("failed to write the dth-runner placeholder");
    }

    // Ship a custom Windows app manifest: tauri-build's default (the
    // Common-Controls dependency) plus <longPathAware> — see the comment in
    // windows-app-manifest.xml. Everything else is stock tauri_build::build().
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("windows-app-manifest.xml"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
