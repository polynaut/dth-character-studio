//! --- Installed Houdini versions -------------------------------------------
//! Which Houdini versions are on this machine, and where.
//!
//! SideFX records every install under
//! `HKLM\SOFTWARE\Side Effects Software\Houdini`, one REG_SZ value per version:
//! the value NAME is the four-part version (`22.0.0.368`) and its DATA is the
//! install folder (`C:\Program Files\Side Effects Software\Houdini 22.0.368\`).
//! That is authoritative — a user is free to install outside Program Files, so
//! probing the default folder would find the common case and miss the rest.
//!
//! Registry access is the only reason this is native at all; everything about
//! what a version MEANS (pairing an install with its `houdini<major>.<minor>`
//! preferences folder, ordering, which to recommend) is TS, in
//! `apps/web/src/lib/houdini-install.ts`, where it is unit-testable.
//!
//! The key also carries non-version values (`LicenseServer`), so the caller
//! filters by name shape — see `is_version` below, which is where that rule
//! lives and is tested.

#[derive(Debug, serde::Serialize)]
#[cfg_attr(test, derive(serde::Deserialize, PartialEq))]
#[serde(rename_all = "camelCase")]
pub struct HoudiniInstall {
    /// The four-part version as SideFX writes it (`22.0.0.368`). Note this is
    /// NOT the folder's spelling (`Houdini 22.0.368`) — the third component is
    /// dropped there — so never derive one from the other.
    pub version: String,
    /// Install folder, trailing separator trimmed.
    pub path: String,
}

/// Whether a registry value name is a Houdini version rather than a setting.
///
/// `LicenseServer` sits in the same key, and a future SideFX release may add
/// more. Requiring `<n>.<n>.<n>.<n>` keeps anything that isn't a version out,
/// including a name that merely starts with digits.
fn is_version(name: &str) -> bool {
    let parts: Vec<&str> = name.split('.').collect();
    parts.len() == 4 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// Trailing `\` / `/` removed — SideFX stores the path WITH one, and every
/// comparison and join on the TS side assumes there is none.
fn trim_trailing_sep(path: &str) -> String {
    path.trim_end_matches(['\\', '/']).to_string()
}

/// Every Houdini install this machine has registered, newest LAST (the caller
/// orders; this is registry order).
///
/// Never fails: no key (Houdini was never installed), no permission, or a
/// non-Windows build all return an empty list, which the UI shows as "nothing
/// detected — set the folders yourself". A missing Houdini is not an error.
#[tauri::command(async)]
pub fn houdini_installs() -> Vec<HoudiniInstall> {
    read_installs()
}

#[cfg(not(windows))]
fn read_installs() -> Vec<HoudiniInstall> {
    Vec::new()
}

#[cfg(windows)]
fn read_installs() -> Vec<HoudiniInstall> {
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, MAX_PATH};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ, REG_SZ,
    };

    /// A NUL-terminated UTF-16 buffer for a Windows `W` API.
    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// UTF-16 up to the first NUL, as a String.
    fn from_wide(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    let subkey = wide(r"SOFTWARE\Side Effects Software\Houdini");
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: `subkey` is a valid NUL-terminated wide string that outlives the
    // call, and `key` is a valid out-pointer. Nothing is read from `key` unless
    // the call reports success.
    let opened = unsafe {
        RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.as_ptr(), 0, KEY_READ, &mut key)
    };
    if opened != ERROR_SUCCESS {
        return Vec::new();
    }

    let mut installs = Vec::new();
    let mut index = 0u32;
    loop {
        // Value names are short; the DATA is a path, so MAX_PATH plus room for
        // the long-path spellings Windows also permits here.
        let mut name = [0u16; 256];
        let mut data = [0u16; (MAX_PATH as usize) * 2];
        let mut name_len = name.len() as u32;
        let mut data_len = (std::mem::size_of_val(&data)) as u32;
        let mut value_type = 0u32;
        // SAFETY: every pointer refers to a live local of the length passed
        // alongside it; `key` came from a successful RegOpenKeyExW above.
        let status = unsafe {
            RegEnumValueW(
                key,
                index,
                name.as_mut_ptr(),
                &mut name_len,
                std::ptr::null_mut(),
                &mut value_type,
                data.as_mut_ptr().cast(),
                &mut data_len,
            )
        };
        if status != ERROR_SUCCESS {
            break;
        }
        index += 1;
        if value_type != REG_SZ {
            continue;
        }
        let version = from_wide(&name[..name_len.min(name.len() as u32) as usize]);
        if !is_version(&version) {
            continue;
        }
        let path = trim_trailing_sep(&from_wide(&data));
        if path.is_empty() {
            continue;
        }
        installs.push(HoudiniInstall { version, path });
    }

    // SAFETY: `key` is the handle RegOpenKeyExW returned and is not used after.
    unsafe { RegCloseKey(key) };
    installs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_four_part_version_and_nothing_else() {
        assert!(is_version("22.0.0.368"));
        assert!(is_version("20.5.0.864"));
        // The setting that shares the key — measured, not hypothetical.
        assert!(!is_version("LicenseServer"));
        assert!(!is_version("22.0.368"));
        assert!(!is_version("22.0.0.368.1"));
        assert!(!is_version("22.0..368"));
        assert!(!is_version("22.0.0.368a"));
        assert!(!is_version(""));
    }

    /// What this machine's registry actually holds. IGNORED by default: the
    /// answer is whatever Houdini is installed here, so it can only ever be a
    /// probe, never an assertion CI could share. Run it when the registry
    /// reading itself is in question:
    ///   cargo test --manifest-path apps/desktop/Cargo.toml houdini_installs_here -- --ignored --nocapture
    #[test]
    #[ignore = "machine-dependent: prints this machine's Houdini installs"]
    fn houdini_installs_here() {
        for install in houdini_installs() {
            println!("{} -> {}", install.version, install.path);
        }
    }

    #[test]
    fn trims_the_separator_sidefx_stores() {
        // Measured: the registry data ends with a backslash. Every TS-side
        // compare and join assumes it does not.
        assert_eq!(
            trim_trailing_sep(r"C:\Program Files\Side Effects Software\Houdini 22.0.368\"),
            r"C:\Program Files\Side Effects Software\Houdini 22.0.368"
        );
        assert_eq!(trim_trailing_sep("D:/houdini/"), "D:/houdini");
        assert_eq!(trim_trailing_sep("D:/houdini"), "D:/houdini");
    }
}
