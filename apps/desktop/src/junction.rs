use serde::Deserialize;
use std::path::Path;

// Directory JUNCTIONS — RETIRED as a feature (v0.63). The studio used to plant
// `dth-exports` junctions beside every linked `.hip` and inside the shared
// `houdini-project` folder so `$HIP/dth-exports/…` paths could resolve;
// generated paths are plain-relative now (`$JOB/<dazSubdir>/dth-exports/…`),
// which needs no reparse points and upsets no Perforce/backup tooling. What
// remains here is the SWEEP: `remove_junction` deletes the leftovers the old
// versions created — strictly reparse-point-verified, so a real folder (the
// actual export root is itself named `dth-exports`!) can never be touched.
// The creation code survives only as a test helper: the sweep's test has to
// build a junction to prove removing one never eats its target.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveJunctionRequest {
    /// The suspected junction. Removed only when it IS a reparse point.
    pub link_path: String,
}

/// Remove a leftover junction at `linkPath`. Returns `"removed"`, `"absent"`
/// (nothing there), or `"not-a-junction"` (a REAL folder or file sits at that
/// path — left alone, deliberately not an error: the sweep treats it as
/// none of its business). Removing a junction deletes the reparse point only,
/// never its target's contents.
#[tauri::command]
pub fn remove_junction(request: RemoveJunctionRequest) -> Result<String, String> {
    let link = Path::new(&request.link_path);
    match std::fs::symlink_metadata(link) {
        // std reports a junction as a symlink (see .ai/gotchas.md).
        Ok(meta) if meta.file_type().is_symlink() => {
            std::fs::remove_dir(link)
                .map_err(|e| format!("Could not remove the junction: {e}"))?;
            Ok("removed".into())
        }
        Ok(_) => Ok("not-a-junction".into()),
        Err(_) => Ok("absent".into()),
    }
}

#[cfg(all(test, windows))]
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// The sweep's whole contract in one pass: removing a junction reports
    /// `"removed"` and leaves the TARGET's files untouched, a second call says
    /// `"absent"`, and a REAL folder at the path is left alone
    /// (`"not-a-junction"`) with its contents intact.
    #[test]
    fn removes_junctions_only_and_never_eats_the_target() {
        let base = std::env::temp_dir().join("dth_junction_sweep_test");
        let _ = std::fs::remove_dir_all(&base);
        let real = base.join("real");
        std::fs::create_dir_all(real.join("primary")).unwrap();
        std::fs::write(real.join("primary/Kira.dth"), b"payload").unwrap();
        let project = base.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let link = project.join("dth-exports");
        create_junction_impl(&link, &real).unwrap();
        assert_eq!(
            std::fs::read_to_string(link.join("primary/Kira.dth")).unwrap(),
            "payload"
        );

        let request = RemoveJunctionRequest {
            link_path: link.to_string_lossy().into_owned(),
        };
        assert_eq!(remove_junction(request).unwrap(), "removed");
        assert!(!link.exists());
        assert!(real.join("primary/Kira.dth").exists());

        let again = RemoveJunctionRequest {
            link_path: link.to_string_lossy().into_owned(),
        };
        assert_eq!(remove_junction(again).unwrap(), "absent");

        // A real folder of the same name is none of the sweep's business.
        let occupied = base.join("occupied").join("dth-exports");
        std::fs::create_dir_all(&occupied).unwrap();
        std::fs::write(occupied.join("keep.txt"), b"mine").unwrap();
        let refused = RemoveJunctionRequest {
            link_path: occupied.to_string_lossy().into_owned(),
        };
        assert_eq!(remove_junction(refused).unwrap(), "not-a-junction");
        assert!(occupied.join("keep.txt").exists());

        let _ = std::fs::remove_dir_all(&base);
    }
}
