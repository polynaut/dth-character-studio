/// Open a local file with its associated application EXACTLY like an Explorer
/// double-click: the request is handed to the running shell (Explorer)
/// process, so the launched app inherits the pristine user-session
/// environment — NOT this app's.
///
/// Why that matters: the shell plugin's `open()` performs the ShellExecute
/// from OUR process, so the child inherits the studio's environment. When the
/// studio itself was started from a non-Explorer parent (a dev shell, a
/// terminal profile that sets HOME/HOUDINI_*), Houdini resolved its
/// preferences dir from that leaked environment and the DazToHue
/// shelf/otls — merged into the REAL Houdini documents folder — silently
/// vanished (measured 2026-07-30: studio-opened .hiplc had no DazToHue shelf,
/// Explorer-opened did). Delegating to Explorer makes "open from the studio"
/// and "double-click in Explorer" identical by construction.
///
/// Explorer has no exit-code contract for this, so only a failed SPAWN is
/// surfaced; the frontend falls back to the shell plugin's open.
#[tauri::command]
pub fn shell_open_file(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(all(not(windows), target_os = "macos"))]
    {
        // `open` is macOS's Explorer-equivalent delegation (launchd env).
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let _ = path;
        Err("shell_open_file: no shell delegation on this platform".into())
    }
}
