// --- Network drives -------------------------------------------------------
// Mapped network drives (e.g. X: → \\jebpot\devs) live in the user's *logon
// session*. When the app is relaunched elevated (to write into an admin-only Daz
// plugins folder) it gets a different session that doesn't see those mappings —
// the classic UAC split-token behaviour. So we remember each drive's UNC as the
// user picks paths, then re-map any that are missing on startup.

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DriveMapping {
    /// Drive specifier, e.g. "X:".
    drive: String,
    /// UNC target, e.g. "\\\\jebpot\\devs".
    unc: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemapResult {
    drive: String,
    unc: String,
    /// "already" (mapped) | "remapped" | "conflict" | "failed" | "unsupported".
    status: String,
    detail: String,
}

#[cfg(windows)]
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The drive specifier ("X:") for a path that starts with a drive letter.
#[cfg(windows)]
fn drive_letter(path: &str) -> Option<String> {
    let mut chars = path.chars();
    let c = chars.next()?;
    if !c.is_ascii_alphabetic() || chars.next()? != ':' {
        return None;
    }
    Some(format!("{}:", c.to_ascii_uppercase()))
}

/// The UNC a mapped network drive points to ("X:" → "\\\\host\\share"), or None
/// for a local or unmapped drive.
#[cfg(windows)]
fn unc_for(path: &str) -> Option<String> {
    use windows_sys::Win32::Foundation::NO_ERROR;
    use windows_sys::Win32::NetworkManagement::WNet::WNetGetConnectionW;

    let drive = drive_letter(path)?;
    let local = to_wide(&drive);
    let mut buf = vec![0u16; 1024];
    let mut len = buf.len() as u32;
    // SAFETY: `local` is a NUL-terminated wide string; `buf`/`len` describe a
    // valid, writable buffer.
    let ret = unsafe { WNetGetConnectionW(local.as_ptr(), buf.as_mut_ptr(), &mut len) };
    if ret == NO_ERROR {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..end]))
    } else {
        None
    }
}

/// `net use <drive> <unc>` — returns the Win32 status code (0 = success).
#[cfg(windows)]
fn add_connection(drive: &str, unc: &str) -> u32 {
    use windows_sys::Win32::NetworkManagement::WNet::{
        WNetAddConnection2W, NETRESOURCEW, RESOURCETYPE_DISK,
    };

    let mut local = to_wide(drive);
    let mut remote = to_wide(unc);
    // SAFETY: NETRESOURCEW is plain data; we set the disk type plus the local +
    // remote names and leave the rest zeroed. NULL credentials use the caller's
    // session. The wide buffers outlive the call.
    let mut nr: NETRESOURCEW = unsafe { std::mem::zeroed() };
    nr.dwType = RESOURCETYPE_DISK;
    nr.lpLocalName = local.as_mut_ptr();
    nr.lpRemoteName = remote.as_mut_ptr();
    unsafe { WNetAddConnection2W(&nr, std::ptr::null(), std::ptr::null(), 0) }
}

#[cfg(windows)]
fn error_text(code: u32) -> String {
    match code {
        5 => "access denied".into(),
        67 => "network name not found — is the server reachable?".into(),
        85 => "drive letter already in use".into(),
        86 => "wrong password".into(),
        1219 => "conflicting credentials for that server".into(),
        1326 => "sign-in failed — the share needs credentials".into(),
        other => format!("error {other}"),
    }
}

/// Resolve the UNC behind a path on a mapped network drive (for remembering it).
// `(async)`: WNet calls can block on an unreachable server — off the main thread.
#[cfg(windows)]
#[tauri::command(async)]
pub fn unc_for_path(path: String) -> Option<String> {
    unc_for(&path)
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn unc_for_path(_path: String) -> Option<String> {
    None
}

/// Ensure each known network drive is mapped: skip the ones already present,
/// remap the missing ones (current session, no stored credentials), and report
/// every outcome. Runs on startup.
#[cfg(windows)]
#[tauri::command(async)]
pub fn ensure_network_drives(mappings: Vec<DriveMapping>) -> Vec<RemapResult> {
    use windows_sys::Win32::Foundation::NO_ERROR;

    mappings
        .into_iter()
        .map(|m| {
            let drive = m.drive.trim().to_string();
            let unc = m.unc.trim().to_string();
            match unc_for(&drive) {
                Some(cur) if cur.eq_ignore_ascii_case(&unc) => RemapResult {
                    drive,
                    unc,
                    status: "already".into(),
                    detail: String::new(),
                },
                Some(cur) => RemapResult {
                    drive,
                    unc,
                    status: "conflict".into(),
                    detail: format!("in use → {cur}"),
                },
                None => {
                    let code = add_connection(&drive, &unc);
                    if code == NO_ERROR {
                        RemapResult { drive, unc, status: "remapped".into(), detail: String::new() }
                    } else {
                        RemapResult { drive, unc, status: "failed".into(), detail: error_text(code) }
                    }
                }
            }
        })
        .collect()
}

#[cfg(not(windows))]
#[tauri::command(async)]
pub fn ensure_network_drives(_mappings: Vec<DriveMapping>) -> Vec<RemapResult> {
    Vec::new()
}
