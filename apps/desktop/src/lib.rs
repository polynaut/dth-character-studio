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
        .invoke_handler(tauri::generate_handler![install_dth])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
