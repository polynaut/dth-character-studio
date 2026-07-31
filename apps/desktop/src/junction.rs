use serde::Deserialize;
use std::path::Path;

// Directory JUNCTIONS — the one native primitive behind the `dth-exports`
// shortcut inside a character's Houdini project folder (see EXPORTS_FOLDER /
// HOUDINI_PROJECT_FOLDER in the web layer).
//
// Why a junction and not a symlink: a junction needs NO elevation, ever, while
// a directory symlink needs SeCreateSymbolicLinkPrivilege (admin) or Developer
// Mode plus SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE. The studio runs
// unelevated, so a symlink would simply fail for most users. The price is that
// a junction can only target a LOCAL absolute path — no UNC, no mapped network
// drive — which is fine here: the target is always inside the project folder.
//
// Why hand-rolled: std has `symlink_dir` (a symlink, see above) but no junction
// at all, so the reparse point is written directly with FSCTL_SET_REPARSE_POINT.
//
// The junction is a CONVENIENCE and every caller must treat it as best-effort:
// nothing in the export pipeline resolves through it (the studio and the
// generated Daz scripts use real absolute paths), so a failure here costs the
// user a Houdini file-picker shortcut and nothing else.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JunctionRequest {
    /// Where the junction itself goes. Must not already exist as a REAL folder.
    pub link_path: String,
    /// The existing directory it points at.
    pub target_path: String,
}

/// Create — or repair — a directory junction at `linkPath` pointing at
/// `targetPath`. Returns `"created"`, or `"exists"` when a correct junction was
/// already there (both are success; the caller shows nothing either way).
///
/// Self-healing by design: anything that scans a Houdini project folder may
/// delete the junction (`p4 clean` and friends treat it as an untracked extra),
/// and a junction left pointing at a stale target is repointed rather than
/// trusted. Removing a link never touches its target — verified against
/// `std::fs::remove_dir_all`, which deletes the reparse point itself.
///
/// It REFUSES to touch a real directory at `linkPath`: that would mean deleting
/// whatever the user put there.
#[tauri::command]
pub fn create_junction(request: JunctionRequest) -> Result<String, String> {
    let link = Path::new(&request.link_path);
    let target = Path::new(&request.target_path);
    if !target.is_dir() {
        return Err(format!(
            "The junction target is not a folder: {}",
            target.display()
        ));
    }
    match std::fs::symlink_metadata(link) {
        // std reports a junction as a symlink (see .ai/gotchas.md).
        Ok(meta) if meta.file_type().is_symlink() => {
            let same = match (std::fs::canonicalize(link), std::fs::canonicalize(target)) {
                (Ok(a), Ok(b)) => a == b,
                _ => false,
            };
            if same {
                return Ok("exists".into());
            }
            std::fs::remove_dir(link)
                .map_err(|e| format!("Could not replace the stale junction: {e}"))?;
        }
        Ok(_) => {
            return Err(format!(
                "A real folder is already at {} — refusing to replace it with a junction.",
                link.display()
            ))
        }
        Err(_) => {}
    }
    create_junction_impl(link, target)?;
    Ok("created".into())
}

#[cfg(windows)]
fn create_junction_impl(link: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;

    // Defined locally so the crate doesn't need the Win32_System_Ioctl feature
    // for two constants.
    const FSCTL_SET_REPARSE_POINT: u32 = 0x0009_00A4;
    const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
    const GENERIC_WRITE: u32 = 0x4000_0000;

    // canonicalize gives the \\?\ extended form; a junction's substitute name
    // wants the NT-namespace \??\ prefix and its print name the plain path.
    let full = std::fs::canonicalize(target)
        .map_err(|e| format!("Could not resolve the junction target: {e}"))?;
    let plain = full.to_string_lossy().replace(r"\\?\", "");
    let substitute: Vec<u16> = format!(r"\??\{plain}")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let print: Vec<u16> = plain.encode_utf16().chain(std::iter::once(0)).collect();

    // REPARSE_DATA_BUFFER: an 8-byte header, then the mount-point block's four
    // u16 offsets/lengths, then both names (each NUL-terminated). The declared
    // lengths EXCLUDE those terminators.
    let names_bytes = (substitute.len() + print.len()) * 2;
    let mut buf: Vec<u8> = Vec::with_capacity(8 + 8 + names_bytes);
    buf.extend_from_slice(&IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
    buf.extend_from_slice(&(((8 + names_bytes) as u16).to_le_bytes())); // ReparseDataLength
    buf.extend_from_slice(&0u16.to_le_bytes()); // Reserved
    buf.extend_from_slice(&0u16.to_le_bytes()); // SubstituteNameOffset
    buf.extend_from_slice(&(((substitute.len() - 1) * 2) as u16).to_le_bytes());
    buf.extend_from_slice(&((substitute.len() * 2) as u16).to_le_bytes()); // PrintNameOffset
    buf.extend_from_slice(&(((print.len() - 1) * 2) as u16).to_le_bytes());
    for unit in substitute.iter().chain(print.iter()) {
        buf.extend_from_slice(&unit.to_le_bytes());
    }

    // The junction IS a directory — create it first, then stamp the reparse
    // point onto it. Any failure past this point removes the empty folder again
    // so a retry starts clean.
    std::fs::create_dir(link).map_err(|e| format!("Could not create the junction folder: {e}"))?;
    let wide: Vec<u16> = link
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        let handle = CreateFileW(
            wide.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            std::ptr::null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE {
            Err(std::io::Error::last_os_error())
        } else {
            let mut returned: u32 = 0;
            let ok = DeviceIoControl(
                handle,
                FSCTL_SET_REPARSE_POINT,
                buf.as_ptr().cast(),
                buf.len() as u32,
                std::ptr::null_mut(),
                0,
                &mut returned,
                std::ptr::null_mut(),
            );
            let outcome = if ok == 0 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            };
            CloseHandle(handle);
            outcome
        }
    };
    if let Err(e) = result {
        let _ = std::fs::remove_dir(link);
        return Err(format!("Could not write the junction: {e}"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn create_junction_impl(_link: &Path, _target: &Path) -> Result<(), String> {
    Err("Directory junctions are a Windows feature.".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// The whole contract in one pass: a junction is created unelevated, reads
    /// through to the target's contents, is reported as already present on a
    /// second call, and — the property the caller depends on — removing the
    /// folder that CONTAINS it leaves the target's files untouched.
    #[test]
    fn creates_reports_and_never_eats_the_target() {
        let base = std::env::temp_dir().join("dth_junction_test");
        let _ = std::fs::remove_dir_all(&base);
        let real = base.join("real");
        std::fs::create_dir_all(real.join("primary")).unwrap();
        std::fs::write(real.join("primary/Kira.dth"), b"payload").unwrap();
        let project = base.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let link = project.join("dth-exports");

        let request = JunctionRequest {
            link_path: link.to_string_lossy().into_owned(),
            target_path: real.to_string_lossy().into_owned(),
        };
        assert_eq!(create_junction(request).unwrap(), "created");
        assert_eq!(
            std::fs::read_to_string(link.join("primary/Kira.dth")).unwrap(),
            "payload"
        );

        let again = JunctionRequest {
            link_path: link.to_string_lossy().into_owned(),
            target_path: real.to_string_lossy().into_owned(),
        };
        assert_eq!(create_junction(again).unwrap(), "exists");

        std::fs::remove_dir_all(&project).unwrap();
        assert!(!project.exists());
        assert!(real.join("primary/Kira.dth").exists());

        // A real folder in the way is never replaced.
        let occupied = base.join("occupied");
        std::fs::create_dir_all(occupied.join("dth-exports")).unwrap();
        let refused = JunctionRequest {
            link_path: occupied.join("dth-exports").to_string_lossy().into_owned(),
            target_path: real.to_string_lossy().into_owned(),
        };
        assert!(create_junction(refused).is_err());

        let _ = std::fs::remove_dir_all(&base);
    }
}
