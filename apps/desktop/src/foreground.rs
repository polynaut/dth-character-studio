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

#[cfg(windows)]
mod windows_impl {
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindow, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
    };

    struct Ctx {
        names: Vec<String>,
        hwnd: HWND,
    }

    /// The image file name (lowercased) of a process, e.g. `"dazstudio.exe"`.
    fn exe_name_of(pid: u32) -> Option<String> {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 {
                return None;
            }
            let full = String::from_utf16_lossy(&buf[..size as usize]);
            Some(full.rsplit(['\\', '/']).next().unwrap_or(&full).to_lowercase())
        }
    }

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> i32 {
        let ctx = &mut *(lparam as *mut Ctx);
        // A real main window: visible and not owned by another window (skips
        // dialogs, tool windows, splash owners).
        if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
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

    pub fn focus(exe_names: &[String]) -> bool {
        let mut ctx = Ctx {
            names: exe_names.iter().map(|s| s.to_lowercase()).collect(),
            hwnd: std::ptr::null_mut(),
        };
        unsafe {
            EnumWindows(Some(enum_cb), &mut ctx as *mut Ctx as LPARAM);
            let hwnd = ctx.hwnd;
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
