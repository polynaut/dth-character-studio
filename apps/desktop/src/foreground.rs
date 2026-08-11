// --- Bring another app's window to the foreground -----------------------------
// After "Open in Daz / Houdini / Unreal" the target app often loads the scene
// *behind* the studio window. This focuses it. It works because the studio is the
// foreground process at click time, so Windows lets it hand focus to another
// window (with the AttachThreadInput dance to survive a just-spawned launcher
// briefly stealing the foreground).

/// Bring the first top-level window belonging to any of `exe_names` (image file
/// names, case-insensitive, e.g. `"DAZStudio.exe"`) to the foreground. Returns
/// `false` when no matching window exists (the app isn't running yet) or off
/// Windows — the caller treats it as best-effort.
#[tauri::command]
pub fn focus_app_window(exe_names: Vec<String>) -> bool {
    #[cfg(windows)]
    {
        windows_impl::focus(&exe_names)
    }
    #[cfg(not(windows))]
    {
        let _ = exe_names;
        false
    }
}

/// Minimize the main window of the first process among `exe_names`, waiting up
/// to `timeout_ms` for that window to exist — a just-launched Daz Studio has no
/// main window for many seconds. Returns whether one was minimized (`false` on
/// timeout, or off Windows).
///
/// Used for the UNATTENDED Daz launches (export batches, project/scene scans,
/// the pending-handoff restart), which have no reason to take over the screen.
/// The interactive paths — opening a scene from its card, "Open and Generate ROM
/// Animation" — deliberately do NOT call this.
///
/// `(async)`: it polls and sleeps, so it must not sit on the main thread.
#[tauri::command(async)]
pub fn minimize_app_window(exe_names: Vec<String>, timeout_ms: u64) -> bool {
    #[cfg(windows)]
    {
        windows_impl::minimize(&exe_names, timeout_ms)
    }
    #[cfg(not(windows))]
    {
        let _ = (exe_names, timeout_ms);
        false
    }
}

#[cfg(windows)]
mod windows_impl {
    use std::time::{Duration, Instant};

    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongPtrW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
        GWL_STYLE, GW_OWNER, SW_MINIMIZE, SW_RESTORE, WS_CAPTION,
    };

    /// How often the minimize watch re-looks for the window.
    const POLL_MS: u64 = 250;
    /// How long it keeps re-minimizing AFTER the first success. Daz paints its
    /// main window and only then restores its saved geometry, which pops the
    /// window straight back up; one `SW_MINIMIZE` at the wrong moment is simply
    /// undone. Short on purpose — past this the user is allowed to un-minimize
    /// it and have it stay up.
    const SETTLE_MS: u64 = 4_000;

    struct Ctx {
        names: Vec<String>,
        /// Only match a window with a title bar. The MINIMIZE path sets this:
        /// Daz shows a frameless splash before its main window, and that splash
        /// is a visible, unowned top-level window that would otherwise match
        /// first — we would minimize the splash and let the real window come up
        /// normally. `focus` leaves it off, keeping its long-standing behaviour.
        require_caption: bool,
        hwnd: HWND,
    }

    /// The image file name (lowercased) of a process, e.g. `"dazstudio.exe"` —
    /// the tail of the same executable path the Daz probes match against a
    /// whole install folder (`procs::exe_path_of_pid`).
    fn exe_name_of(pid: u32) -> Option<String> {
        let full = crate::procs::exe_path_of_pid(pid)?;
        Some(full.rsplit(['\\', '/']).next().unwrap_or(&full).to_lowercase())
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> i32 {
        let ctx = &mut *(lparam as *mut Ctx);
        // A real main window: visible and not owned by another window (skips
        // dialogs, tool windows, splash owners).
        if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
        }
        // WS_CAPTION is two bits (WS_BORDER | WS_DLGFRAME) — test for BOTH, or a
        // plain-bordered splash passes as a captioned main window.
        if ctx.require_caption {
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
            if style & WS_CAPTION != WS_CAPTION {
                return 1;
            }
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != 0 {
            if let Some(name) = exe_name_of(pid) {
                if ctx.names.contains(&name) {
                    ctx.hwnd = hwnd;
                    return 0; // found — stop enumerating
                }
            }
        }
        1
    }

    /// The first matching top-level window, or null when none is up yet.
    fn find(exe_names: &[String], require_caption: bool) -> HWND {
        let mut ctx = Ctx {
            names: exe_names.iter().map(|s| s.to_lowercase()).collect(),
            require_caption,
            hwnd: std::ptr::null_mut(),
        };
        unsafe { EnumWindows(Some(enum_cb), &mut ctx as *mut Ctx as LPARAM) };
        ctx.hwnd
    }

    pub fn minimize(exe_names: &[String], timeout_ms: u64) -> bool {
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            let hwnd = find(exe_names, true);
            if !hwnd.is_null() {
                // Cross-process ShowWindow is what `focus` already does. It can
                // stall against a window whose thread isn't pumping (a Daz deep
                // in its content-DB load) — which is survivable here because
                // this runs on a blocking thread and nothing awaits the result.
                unsafe { ShowWindow(hwnd, SW_MINIMIZE) };
                let settle = Instant::now() + Duration::from_millis(SETTLE_MS);
                while Instant::now() < settle {
                    std::thread::sleep(Duration::from_millis(POLL_MS));
                    unsafe {
                        if IsIconic(hwnd) == 0 {
                            ShowWindow(hwnd, SW_MINIMIZE);
                        }
                    }
                }
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(POLL_MS));
        }
    }

    pub fn focus(exe_names: &[String]) -> bool {
        let hwnd = find(exe_names, false);
        unsafe {
            if hwnd.is_null() {
                return false;
            }
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            // Inherit the current foreground thread's right to set the foreground
            // window, so the call isn't demoted to a taskbar flash.
            let fg = GetForegroundWindow();
            let cur = GetCurrentThreadId();
            let fg_thread = if fg.is_null() {
                0
            } else {
                GetWindowThreadProcessId(fg, std::ptr::null_mut())
            };
            let attached = fg_thread != 0 && fg_thread != cur && AttachThreadInput(cur, fg_thread, 1) != 0;
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
            if attached {
                AttachThreadInput(cur, fg_thread, 0);
            }
        }
        true
    }
}
