// --- Daz Studio process probe + script bridge --------------------------------

/// Whether a Daz Studio instance is currently running (Windows: `tasklist`,
/// spawned without a console window). Drives the web side's scene-open bridge:
/// a running Daz (DS6) silently ignores forwarded `.duf` opens, but forwarded
/// SCRIPT files still execute — so the studio opens scenes through a one-shot
/// `.dsa` when an instance is up (see `run_daz_script`).
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

/// Run a Daz Studio script (`.dsa`) by launching Daz's executable directly with
/// the script as its argument — `DAZStudio.exe "<script>"`. When an instance is
/// already up, Daz forwards the script to it and runs it there; otherwise it
/// starts fresh and runs it. This deliberately does NOT shell-open the `.dsa`
/// (the old approach): a shell-open uses the OS file association, and on a dev
/// machine `.dsa` is often bound to a text editor (VS Code), so the script would
/// open as text and never execute. Launching the exe is association-independent.
///
/// We use the RUNNING instance's own executable path so the script forwards to
/// the instance the user is looking at — DS4 and DS6 are separate single-instance
/// apps, so a DS6 exe can't forward into a running DS4 (it would spawn a second
/// DS6). Falls back to a standard install-dir probe only if the running instance
/// can't be located.
#[tauri::command]
pub fn run_daz_script(script_path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let exe = running_daz_exe()
            .or_else(installed_daz_exe)
            .ok_or_else(|| "Could not locate the Daz Studio executable.".to_string())?;
        std::process::Command::new(&exe)
            .arg(&script_path)
            .spawn()
            .map_err(|e| format!("Failed to launch Daz Studio ({exe}): {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = script_path;
        Err("Running a Daz script is only supported on Windows.".to_string())
    }
}

/// Full path to the executable of the currently-running `DAZStudio.exe`, via a
/// CIM query (WMIC is gone on current Windows 11). `None` if Daz isn't running or
/// the path can't be read.
#[cfg(windows)]
fn running_daz_exe() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='DAZStudio.exe'\" \
             | Select-Object -First 1 -ExpandProperty ExecutablePath",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Best-effort probe of the standard Daz install locations (newest first). Only a
/// fallback for when the running instance can't be queried — matching the running
/// instance is preferred (see `run_daz_script`).
#[cfg(windows)]
fn installed_daz_exe() -> Option<String> {
    for var in ["PROGRAMFILES", "ProgramFiles(x86)"] {
        let Ok(base) = std::env::var(var) else { continue };
        for ver in ["DAZStudio6", "DAZStudio4"] {
            let exe = std::path::Path::new(&base)
                .join("DAZ 3D")
                .join(ver)
                .join("DAZStudio.exe");
            if exe.is_file() {
                return exe.to_str().map(str::to_string);
            }
        }
    }
    None
}
