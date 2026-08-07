use std::sync::OnceLock;

// Whether this process is running elevated, and the window title that says so.
//
// It matters more here than in most apps: the studio writes into Program Files
// (Daz/Houdini plugin installs), which is why it offers to relaunch elevated at
// all — and an elevated session behaves differently in ways that are invisible
// otherwise. Mapped network drives are per-session, so an elevated relaunch
// cannot see the user's drive letters (see drives.rs); files it creates get an
// elevated owner. Knowing which kind of session you are looking at should not
// require remembering how you launched it.

/// Elevation can't change during a process's life, so this is asked once.
static ELEVATED: OnceLock<bool> = OnceLock::new();

/// Whether the current process holds an elevated token.
pub(crate) fn is_elevated() -> bool {
    *ELEVATED.get_or_init(detect_elevated)
}

/// The window title to actually use: Windows' own convention for an elevated
/// window is the `Administrator:` prefix (cmd and PowerShell both do it), which
/// reads instantly and stays recognizable where the title is truncated — the
/// taskbar, Alt-Tab — unlike a suffix on an already-long project title.
pub(crate) fn window_title(base: &str) -> String {
    if !is_elevated() || base.starts_with(ADMIN_PREFIX) {
        // Idempotent: the startup pass re-titles from a window's CURRENT title,
        // and a project rename re-titles an already-marked window.
        return base.to_string();
    }
    format!("{ADMIN_PREFIX}{base}")
}

const ADMIN_PREFIX: &str = "Administrator: ";

/// Whether this window's process runs elevated — asked by the webview, which
/// otherwise can't tell. It matters because Windows UIPI silently drops
/// drag-and-drop from a normal-elevation Explorer into an elevated window: no
/// event, no error, the drop just does nothing (issue #342). The frontend uses
/// this to offer a normal restart after an elevated plugin install.
#[tauri::command]
pub fn elevated_session() -> bool {
    is_elevated()
}

/// Relaunch the studio WITHOUT elevation, then quit this instance.
///
/// A plain relaunch inherits the elevated token, so the launch is delegated to
/// `explorer.exe` — the user's medium-integrity shell starts the target like a
/// double-click, exactly the delegation `shellopen.rs` uses (and why: the
/// child gets the shell's integrity level and pristine environment). With a
/// project open the target is its `.dcsp` (the file association reopens the
/// project); a Home window relaunches the bare exe.
///
/// Best-effort by design: this instance exits right after handing off, and
/// Explorer's launch takes long enough that the single-instance mutex is free
/// by the time the new process checks it. If the new instance ever loses that
/// race it simply exits — worst case the user starts the app by hand, which is
/// exactly where they'd be without this command.
#[tauri::command]
pub fn relaunch_deelevated(app: tauri::AppHandle, project_file: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let target = if project_file.is_empty() {
            std::env::current_exe()
                .map_err(|e| format!("couldn't resolve the app executable: {e}"))?
                .to_string_lossy()
                .into_owned()
        } else {
            project_file
        };
        // explorer.exe accepts BACKSLASH paths only (see shellopen.rs).
        let windows_path = target.replace('/', "\\");
        std::process::Command::new("explorer.exe")
            .arg(&windows_path)
            .spawn()
            .map_err(|e| format!("couldn't hand the relaunch to Explorer: {e}"))?;
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, project_file);
        Err("relaunch_deelevated is Windows-only".into())
    }
}

#[cfg(windows)]
fn detect_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            // Can't ask → assume not elevated. A missing marker is a far smaller
            // problem than claiming administrator when we don't know.
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned: u32 = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            std::ptr::addr_of_mut!(elevation).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
fn detect_elevated() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_marker_is_a_prefix_and_only_when_elevated() {
        // Can't choose the test process's elevation, so assert the invariant
        // that holds either way: the base title is always intact, and the
        // marker is Windows' own prefix rather than a suffix that truncates away.
        let title = window_title("Kira — DTH Character Studio");
        assert!(title.ends_with("Kira — DTH Character Studio"));
        if is_elevated() {
            assert_eq!(title, "Administrator: Kira — DTH Character Studio");
        } else {
            assert_eq!(title, "Kira — DTH Character Studio");
        }
    }

    #[test]
    fn marking_an_already_marked_title_changes_nothing() {
        // The startup pass reads a window's CURRENT title and re-titles it, and
        // a project rename re-titles a window that is already marked — neither
        // may stack prefixes.
        let once = window_title("DTH Character Studio");
        assert_eq!(window_title(&once), once);
        assert_eq!(window_title(&window_title(&once)), once);
    }

    #[test]
    fn elevation_is_answered_consistently() {
        // Cached in a OnceLock — a title set at startup and one set on a rename
        // must never disagree.
        assert_eq!(is_elevated(), is_elevated());
    }
}
