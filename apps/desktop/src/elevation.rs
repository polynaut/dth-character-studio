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
