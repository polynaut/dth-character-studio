use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::fsutil::{copy_dir, copy_dir_add_only, count_files, folder_name};
use crate::report::{
    io_detail, step_err, step_ok, step_skip, InstallReport, InstallStep, ADMIN_HINT,
};

// Paths are resolved by the frontend (which release/plugin, where); the native
// side only does the heavy recursive copy. Keys arrive camelCase from JS. The
// install is split in two — the DTH release content vs the (admin-sensitive)
// plugin DLLs — so each reports only its own steps and fails independently.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseInstallRequest {
    /// Release root holding `Daz Studio Content` and `Houdini Assets`.
    release_root: String,
    /// "My DAZ 3D Library" — destination for the release's Daz content.
    daz_lib_folder: String,
    /// Houdini documents folder — destination for the release's Houdini assets ("" skips).
    houdini_docs_folder: String,
    /// Count what would be copied without writing anything.
    dry_run: bool,
    /// Which half to install: "daz", "houdini", or "all" (default — both).
    #[serde(default = "default_install_target")]
    target: String,
}

fn default_install_target() -> String {
    "all".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallRequest {
    /// Folder holding the exporter DLLs (`dth_exporter.dll` / `dsp_dth_exporter.dll`).
    exporter_folder: String,
    /// Daz Studio install root — DLLs go into its `plugins` subfolder.
    daz_install_folder: String,
    dry_run: bool,
}

/// Append `SHARED_PRESETS` + `HOUDINI_PATH` to `<houdini_docs>/houdini.env` if not
/// already present (idempotent). Returns whether it changed the file.
fn wire_houdini_env(houdini_docs: &Path, presets_dir: &Path) -> std::io::Result<bool> {
    let env_path = houdini_docs.join("houdini.env");
    let presets_fwd = presets_dir.display().to_string().replace('\\', "/");
    // Distinguish "no file yet" (start empty) from a real read error / non-UTF-8
    // content: a blanket unwrap_or_default() would treat an unreadable existing
    // houdini.env as empty and then OVERWRITE it, wiping the user's other Houdini
    // settings. Read as bytes (so a non-UTF-8 file is a hard error, not "empty")
    // and only treat NotFound as a fresh start.
    let existing = match fs::read(&env_path) {
        Ok(bytes) => String::from_utf8(bytes)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "houdini.env is not valid UTF-8 — leaving it untouched"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    let lower = existing.to_lowercase();
    let mut add = String::new();
    if !lower.contains("shared_presets =") && !lower.contains("shared_presets=") {
        add.push_str(&format!("SHARED_PRESETS = \"{presets_fwd}\"\n"));
    }
    if !lower.contains("$shared_presets") {
        add.push_str("HOUDINI_PATH = $HOUDINI_PATH;$SHARED_PRESETS\n");
    }
    if add.is_empty() {
        return Ok(false);
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&add);
    fs::write(&env_path, content)?;
    Ok(true)
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
        Err(e) => step_err(label, io_detail(&format!("{} → {}", src.display(), dst.display()), &e)),
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
            return step_err(label, io_detail(&dst_dir.display().to_string(), &e));
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
            Err(e) => return step_err(label, io_detail(&from.display().to_string(), &e)),
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
        if fs::copy(dll, &to).is_err() {
            // Writing into Program Files needs elevation, and Windows also locks
            // plugin DLLs that a running Daz Studio has loaded — both surface here.
            return step_err(
                label,
                format!("couldn't write {} — {ADMIN_HINT} (Daz also locks loaded plugin DLLs)", to.display()),
            );
        }
        files += 1;
    }
    step_ok(label, files, format!("{} dll(s) → {}", files, plugins.display()))
}

/// Install the DTH *release* content: `Daz Studio Content/{data,DazToHue}` → the
/// Daz library, and/or `Houdini Assets/*` → the Houdini documents folder,
/// selected by `target` ("daz" / "houdini" / "all"). Native port of the dth-cli
/// `install-daz-dth` / `install-houdini-dth` — now individually runnable.
#[tauri::command]
pub fn install_dth_release(request: ReleaseInstallRequest) -> InstallReport {
    let dry = request.dry_run;
    let release_root = Path::new(&request.release_root);
    let daz_content = release_root.join("Daz Studio Content");
    let lib = Path::new(&request.daz_lib_folder);
    let mut steps: Vec<InstallStep> = Vec::new();

    // Daz content (data, DazToHue) → My DAZ 3D Library.
    if request.target != "houdini" {
        for folder in ["data", "DazToHue"] {
            steps.push(install_folder(
                &format!("Daz content: {folder}"),
                &daz_content.join(folder),
                &lib.join(folder),
                dry,
            ));
        }
    }

    // Houdini assets (otls/presets/toolbar/…) → Houdini documents folder (optional).
    if request.target != "daz" {
        if request.houdini_docs_folder.is_empty() {
            steps.push(step_skip("Houdini assets", "Houdini documents folder not set".into()));
        } else {
            steps.push(install_contents(
                "Houdini assets",
                &release_root.join("Houdini Assets"),
                Path::new(&request.houdini_docs_folder),
                dry,
            ));
        }
    }

    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}

/// Install the *Exporter Plugin* DLLs into `<Daz install>/plugins`. This is the
/// admin-sensitive half — writing into Program Files needs elevation and Daz
/// locks loaded plugin DLLs (see `install_plugin_dlls`).
#[tauri::command]
pub fn install_dth_plugin(request: PluginInstallRequest) -> InstallReport {
    let step = install_plugin_dlls(
        "Exporter plugin",
        Path::new(&request.exporter_folder),
        Path::new(&request.daz_install_folder),
        request.dry_run,
    );
    let total_files = step.files;
    InstallReport { dry_run: request.dry_run, steps: vec![step], total_files }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeInstallRequest {
    label: String,
    source: String,
    dest: String,
    dry_run: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HoudiniPresetsRequest {
    source: String,
    houdini_docs: String,
    dry_run: bool,
}

/// Merge-only install (adds new files, never overwrites) for custom morphs / presets.
#[tauri::command]
pub fn install_daz_merge(request: MergeInstallRequest) -> InstallReport {
    let dry = request.dry_run;
    let src = Path::new(&request.source);
    let dst = Path::new(&request.dest);
    let step = if !src.is_dir() {
        step_skip(&request.label, format!("source not found ({})", src.display()))
    } else if dry {
        step_ok(
            &request.label,
            count_files(src),
            format!("would add new files → {}", dst.display()),
        )
    } else {
        match copy_dir_add_only(src, dst) {
            Ok(n) => step_ok(&request.label, n, format!("{n} new file(s) → {}", dst.display())),
            Err(e) => step_err(
                &request.label,
                io_detail(&format!("{} → {}", src.display(), dst.display()), &e),
            ),
        }
    };
    let total_files = step.files;
    InstallReport { dry_run: dry, steps: vec![step], total_files }
}

/// Install your Houdini `my_presets` into the Houdini docs folder (overwriting)
/// and wire it into that version's `houdini.env`.
#[tauri::command]
pub fn install_houdini_presets(request: HoudiniPresetsRequest) -> InstallReport {
    let dry = request.dry_run;
    let src = Path::new(&request.source);
    let houdini_docs = Path::new(&request.houdini_docs);
    let mut steps: Vec<InstallStep> = Vec::new();
    if !src.is_dir() {
        steps.push(step_skip("Houdini presets", format!("source not found ({})", src.display())));
    } else {
        let dest = houdini_docs.join(folder_name(src));
        if dry {
            steps.push(step_ok("Houdini presets", count_files(src), format!("would merge → {}", dest.display())));
            steps.push(step_skip("houdini.env", "would wire SHARED_PRESETS + HOUDINI_PATH".into()));
        } else {
            let mut failed = false;
            // MERGE (copy over), never remove-then-copy: the destination folder
            // name is derived from the source basename, so a mis-named source
            // (e.g. "otls") must not wipe an arbitrary Houdini subfolder — and a
            // mid-copy failure must not leave a deleted-then-partial install.
            match copy_dir(src, &dest) {
                Ok(n) => steps.push(step_ok("Houdini presets", n, format!("→ {}", dest.display()))),
                Err(e) => {
                    steps.push(step_err("Houdini presets", io_detail(&format!("{} → {}", src.display(), dest.display()), &e)));
                    failed = true;
                }
            }
            if !failed {
                match wire_houdini_env(houdini_docs, &dest) {
                    Ok(true) => steps.push(step_ok("houdini.env", 0, "wired SHARED_PRESETS + HOUDINI_PATH".into())),
                    Ok(false) => steps.push(step_skip("houdini.env", "already wired".into())),
                    Err(e) => steps.push(step_err("houdini.env", io_detail("update houdini.env", &e))),
                }
            }
        }
    }
    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnrealInstallRequest {
    /// Release root holding `Unreal Engine Content/DazToHue`.
    release_root: String,
    /// The linked `.uproject` file — content lands in its folder's `Content/DazToHue`.
    uproject_path: String,
    /// Copy over an existing `Content/DazToHue` (the UI's Ctrl+click).
    overwrite: bool,
}

/// Install the release's Unreal Engine content (`Unreal Engine Content/DazToHue`)
/// into the linked project's `Content/DazToHue` — the instant DTH bootstrap for a
/// fresh Unreal project. Refuses when the path isn't a real `.uproject` file,
/// when the release ships no Unreal content, or when the content already exists
/// and `overwrite` is off. Overwrite copies files over — it never deletes first,
/// so project-local additions inside the folder survive. Returns files copied.
#[tauri::command]
pub fn install_unreal_dth(request: UnrealInstallRequest) -> Result<u64, String> {
    let uproject = Path::new(&request.uproject_path);
    let is_uproject = uproject
        .extension()
        .map(|e| e.eq_ignore_ascii_case("uproject"))
        .unwrap_or(false);
    if !is_uproject || !uproject.is_file() {
        return Err("Not an Unreal project file (.uproject).".into());
    }
    let project_dir = uproject
        .parent()
        .ok_or_else(|| "The .uproject has no parent folder.".to_string())?;
    let src = Path::new(&request.release_root)
        .join("Unreal Engine Content")
        .join("DazToHue");
    if !src.is_dir() {
        return Err("This DTH release ships no Unreal Engine Content.".into());
    }
    let dest = project_dir.join("Content").join("DazToHue");
    if dest.exists() && !request.overwrite {
        return Err(
            "Content/DazToHue already exists in this project — Ctrl+click to overwrite.".into(),
        );
    }
    copy_dir(&src, &dest).map_err(|e| e.to_string())
}
