// --- Running processes: what is up, and WHERE it was started from ------------
//
// A process NAME is not an identity. Daz Studio 4 and Daz Studio 6 are separate
// applications, installed side by side, and both ship an executable called
// `DAZStudio.exe` — so "is DAZStudio.exe running?" cannot answer "is the
// installation this batch is meant for running?". The full executable path can,
// and it is the only thing that can.
//
// Windows-only, like everything that drives Daz. Enumeration is a ToolHelp
// snapshot (in-process, no console child) rather than shelling out to
// `tasklist`/PowerShell: these probes sit inside one-second UI polls, and a
// per-tick process spawn is both slow and a window-flash risk.

/// The executables of every running process whose image name is `name`
/// (case-insensitive, e.g. `"DAZStudio.exe"`) — one entry per process, in
/// enumeration order.
///
/// An entry is `None` when the path could not be read: `OpenProcess` is denied
/// for a process at a higher integrity level (an elevated Daz seen from an
/// unelevated studio). That is UNKNOWN, never "not the one you asked about" —
/// callers decide which way to lean, and the honest options are both there
/// only because the entry exists at all.
#[cfg(windows)]
pub(crate) fn running_exe_paths(name: &str) -> Vec<Option<String>> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut found = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return found;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snapshot, &mut entry);
        while ok != 0 {
            if wide_to_string(&entry.szExeFile).eq_ignore_ascii_case(name) {
                found.push(exe_path_of_pid(entry.th32ProcessID));
            }
            ok = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    found
}

/// Every running process whose image name is `name`, as `(pid, exe path)` —
/// the pid-carrying sibling of [`running_exe_paths`], for the one caller that
/// must act ON a process (the export supervisor's kill) rather than merely ask
/// about it. Same path semantics: `None` = the path could not be read (an
/// elevated process seen from an unelevated studio), which is UNKNOWN — the
/// kill deliberately leans the other way from the probes and skips it.
#[cfg(windows)]
pub(crate) fn running_procs(name: &str) -> Vec<(u32, Option<String>)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let mut found = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return found;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snapshot, &mut entry);
        while ok != 0 {
            if wide_to_string(&entry.szExeFile).eq_ignore_ascii_case(name) {
                found.push((entry.th32ProcessID, exe_path_of_pid(entry.th32ProcessID)));
            }
            ok = Process32NextW(snapshot, &mut entry);
        }
        CloseHandle(snapshot);
    }
    found
}

/// Terminate the process `pid`. `false` when it could not be opened or the
/// terminate call failed (already gone, or access denied).
#[cfg(windows)]
pub(crate) fn terminate_pid(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return false;
        }
        let ok = TerminateProcess(handle, 1);
        CloseHandle(handle);
        ok != 0
    }
}

/// The full path of a process' executable, e.g.
/// `C:\Program Files\DAZ 3D\DAZStudio4\DAZStudio.exe`. `None` when the process
/// is gone or the query is denied (see [`running_exe_paths`]).
#[cfg(windows)]
pub(crate) fn exe_path_of_pid(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };

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
        Some(String::from_utf16_lossy(&buf[..size as usize]))
    }
}

/// A fixed-size, NUL-terminated wide buffer as a `String` (the tail after the
/// first NUL is padding, not content).
#[cfg(windows)]
fn wide_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}
