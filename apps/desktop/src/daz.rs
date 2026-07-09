// --- Daz Studio process probe -------------------------------------------------

/// Whether a Daz Studio instance is currently running (Windows: `tasklist`,
/// spawned without a console window). Drives the web side's scene-open bridge:
/// a running Daz (DS6) silently ignores forwarded `.duf` opens, but forwarded
/// SCRIPT files still execute — so the studio opens scenes through a one-shot
/// `.dsa` when an instance is up.
#[tauri::command]
pub fn daz_studio_running() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq DAZStudio.exe", "/NH", "/FO", "CSV"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .to_ascii_lowercase()
                    .contains("dazstudio.exe")
            })
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}
