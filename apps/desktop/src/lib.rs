use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Concrete paths resolved by the frontend (which release/plugin, where). The
/// native side only does the heavy recursive copy. Keys arrive camelCase from JS.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallRequest {
    /// Release root holding `Daz Studio Content` and `Houdini Assets`.
    release_root: String,
    /// Folder holding the exporter DLLs (`dth_exporter.dll`, optional `dth_tools.dll`).
    exporter_folder: String,
    /// "My DAZ 3D Library" — destination for the release's Daz content ("" skips it).
    daz_lib_folder: String,
    /// Daz Studio install root — DLLs go into its `plugins` subfolder ("" skips them).
    daz_install_folder: String,
    /// Houdini documents folder — destination for the release's Houdini assets ("" skips).
    houdini_docs_folder: String,
    /// Count what would be copied without writing anything.
    dry_run: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallStep {
    label: String,
    files: u64,
    /// "ok" | "skipped" | "error".
    status: String,
    detail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallReport {
    dry_run: bool,
    steps: Vec<InstallStep>,
    total_files: u64,
}

fn step_ok(label: &str, files: u64, detail: String) -> InstallStep {
    InstallStep { label: label.into(), files, status: "ok".into(), detail }
}
fn step_skip(label: &str, reason: String) -> InstallStep {
    InstallStep { label: label.into(), files: 0, status: "skipped".into(), detail: reason }
}
fn step_err(label: &str, msg: String) -> InstallStep {
    InstallStep { label: label.into(), files: 0, status: "error".into(), detail: msg }
}

/// Number of files (recursively) under `dir`; 0 when it can't be read.
fn count_files(dir: &Path) -> u64 {
    let mut n = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                n += count_files(&path);
            } else {
                n += 1;
            }
        }
    }
    n
}

/// Recursively copy `src` into `dst` (created if missing; overwrites), returning
/// the number of files copied.
fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<u64> {
    fs::create_dir_all(dst)?;
    let mut count = 0;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            count += copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
            count += 1;
        }
    }
    Ok(count)
}

/// Copy a whole folder `src` → `dst` (e.g. `Daz Studio Content/data` → `<lib>/data`).
fn install_folder(label: &str, src: &Path, dst: &Path, dry: bool) -> InstallStep {
    if !src.exists() {
        return step_skip(label, format!("not in release ({})", src.display()));
    }
    if dry {
        return step_ok(label, count_files(src), format!("would copy → {}", dst.display()));
    }
    match copy_dir(src, dst) {
        Ok(n) => step_ok(label, n, format!("→ {}", dst.display())),
        Err(e) => step_err(label, format!("{} → {}: {}", src.display(), dst.display(), e)),
    }
}

/// Merge each entry of `src_dir` into `dst_dir` (e.g. `Houdini Assets/*` →
/// `<houdini docs>/`), preserving other files already there.
fn install_contents(label: &str, src_dir: &Path, dst_dir: &Path, dry: bool) -> InstallStep {
    if !src_dir.exists() {
        return step_skip(label, format!("not in release ({})", src_dir.display()));
    }
    let entries = match fs::read_dir(src_dir) {
        Ok(e) => e,
        Err(e) => return step_err(label, e.to_string()),
    };
    if !dry {
        if let Err(e) = fs::create_dir_all(dst_dir) {
            return step_err(label, format!("{}: {}", dst_dir.display(), e));
        }
    }
    let mut files = 0u64;
    for entry in entries.flatten() {
        let from = entry.path();
        let to = dst_dir.join(entry.file_name());
        if dry {
            files += if from.is_dir() { count_files(&from) } else { 1 };
            continue;
        }
        let result = if from.is_dir() {
            copy_dir(&from, &to)
        } else {
            fs::copy(&from, &to).map(|_| 1)
        };
        match result {
            Ok(n) => files += n,
            Err(e) => return step_err(label, format!("{}: {}", from.display(), e)),
        }
    }
    let detail = if dry {
        format!("would copy → {}", dst_dir.display())
    } else {
        format!("→ {}", dst_dir.display())
    };
    step_ok(label, files, detail)
}

/// Copy every `.dll` in `exporter_folder` into `<daz_install>/plugins`.
fn install_plugin_dlls(label: &str, exporter_folder: &Path, daz_install: &Path, dry: bool) -> InstallStep {
    if !exporter_folder.exists() {
        return step_skip(label, format!("exporter folder not found ({})", exporter_folder.display()));
    }
    let dlls: Vec<std::path::PathBuf> = match fs::read_dir(exporter_folder) {
        Ok(entries) => entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_file()
                    && p.extension()
                        .and_then(|s| s.to_str())
                        .map(|s| s.eq_ignore_ascii_case("dll"))
                        .unwrap_or(false)
            })
            .collect(),
        Err(e) => return step_err(label, e.to_string()),
    };
    if dlls.is_empty() {
        return step_skip(label, "no .dll files in the exporter folder".into());
    }
    let plugins = daz_install.join("plugins");
    if dry {
        return step_ok(label, dlls.len() as u64, format!("would copy {} dll(s) → {}", dlls.len(), plugins.display()));
    }
    if !plugins.exists() {
        return step_err(
            label,
            format!("plugins folder not found: {} — is Daz Studio installed there?", plugins.display()),
        );
    }
    let mut files = 0u64;
    for dll in &dlls {
        let to = plugins.join(dll.file_name().unwrap());
        if let Err(e) = fs::copy(dll, &to) {
            // Windows locks plugin DLLs loaded by a running Daz Studio, and the
            // plugins folder usually needs elevation to write.
            return step_err(
                label,
                format!(
                    "could not write {}: {} — close Daz Studio (it locks loaded plugin DLLs) and run the studio as Administrator if needed",
                    to.display(),
                    e
                ),
            );
        }
        files += 1;
    }
    step_ok(label, files, format!("{} dll(s) → {}", files, plugins.display()))
}

/// Install a DTH release + the Exporter Plugin into the local Daz Studio +
/// Houdini installs — the native port of the dth-cli install commands. Each
/// destination with an empty path is skipped; the report lists every step.
#[tauri::command]
fn install_dth(request: InstallRequest) -> InstallReport {
    let dry = request.dry_run;
    let release_root = Path::new(&request.release_root);
    let daz_content = release_root.join("Daz Studio Content");
    let houdini_assets = release_root.join("Houdini Assets");
    let mut steps: Vec<InstallStep> = Vec::new();

    // 1. Daz content (data, DazToHue) → My DAZ 3D Library.
    if request.daz_lib_folder.is_empty() {
        steps.push(step_skip("Daz content", "“My DAZ 3D Library” not set".into()));
    } else {
        let lib = Path::new(&request.daz_lib_folder);
        for folder in ["data", "DazToHue"] {
            steps.push(install_folder(
                &format!("Daz content: {folder}"),
                &daz_content.join(folder),
                &lib.join(folder),
                dry,
            ));
        }
    }

    // 2. Exporter plugin DLLs → <Daz install>/plugins.
    if request.daz_install_folder.is_empty() {
        steps.push(step_skip("Exporter plugin", "Daz Studio install folder not set".into()));
    } else {
        steps.push(install_plugin_dlls(
            "Exporter plugin",
            Path::new(&request.exporter_folder),
            Path::new(&request.daz_install_folder),
            dry,
        ));
    }

    // 3. Houdini assets (otls/presets/toolbar/…) → Houdini documents folder.
    if request.houdini_docs_folder.is_empty() {
        steps.push(step_skip("Houdini assets", "Houdini documents folder not set".into()));
    } else {
        steps.push(install_contents(
            "Houdini assets",
            &houdini_assets,
            Path::new(&request.houdini_docs_folder),
            dry,
        ));
    }

    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}

// --- Network drives -------------------------------------------------------
// Mapped network drives (e.g. X: → \\jebpot\devs) live in the user's *logon
// session*. When the app is relaunched elevated (to write into an admin-only Daz
// plugins folder) it gets a different session that doesn't see those mappings —
// the classic UAC split-token behaviour. So we remember each drive's UNC as the
// user picks paths, then re-map any that are missing on startup.

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveMapping {
    /// Drive specifier, e.g. "X:".
    drive: String,
    /// UNC target, e.g. "\\\\jebpot\\devs".
    unc: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RemapResult {
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
#[cfg(windows)]
#[tauri::command]
fn unc_for_path(path: String) -> Option<String> {
    unc_for(&path)
}

#[cfg(not(windows))]
#[tauri::command]
fn unc_for_path(_path: String) -> Option<String> {
    None
}

/// Ensure each known network drive is mapped: skip the ones already present,
/// remap the missing ones (current session, no stored credentials), and report
/// every outcome. Runs on startup.
#[cfg(windows)]
#[tauri::command]
fn ensure_network_drives(mappings: Vec<DriveMapping>) -> Vec<RemapResult> {
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
#[tauri::command]
fn ensure_network_drives(_mappings: Vec<DriveMapping>) -> Vec<RemapResult> {
    Vec::new()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init());

    // Updater + relaunch are desktop-only.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            install_dth,
            unc_for_path,
            ensure_network_drives
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
