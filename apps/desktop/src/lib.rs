use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// Paths are resolved by the frontend (which release/plugin, where); the native
// side only does the heavy recursive copy. Keys arrive camelCase from JS. The
// install is split in two — the DTH release content vs the (admin-sensitive)
// plugin DLLs — so each reports only its own steps and fails independently.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseInstallRequest {
    /// Release root holding `Daz Studio Content` and `Houdini Assets`.
    release_root: String,
    /// "My DAZ 3D Library" — destination for the release's Daz content.
    daz_lib_folder: String,
    /// Houdini documents folder — destination for the release's Houdini assets ("" skips).
    houdini_docs_folder: String,
    /// Count what would be copied without writing anything.
    dry_run: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginInstallRequest {
    /// Folder holding the exporter DLLs (`dth_exporter.dll` / `dsp_dth_exporter.dll`).
    exporter_folder: String,
    /// Daz Studio install root — DLLs go into its `plugins` subfolder.
    daz_install_folder: String,
    dry_run: bool,
}

/// Shared guidance for the failures that need elevation (or a locked DLL).
const ADMIN_HINT: &str =
    "close all Daz and Houdini apps, then restart DTH Character Studio as administrator and try again";

/// Format an IO error, appending the admin guidance for permission failures.
fn io_detail(prefix: &str, e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        format!("{prefix}: access denied — {ADMIN_HINT}")
    } else {
        format!("{prefix}: {e}")
    }
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

/// Recursively copy `src` into `dst`, adding only files missing at the
/// destination (never overwrites — preserves the user's edits). Returns files added.
fn copy_dir_add_only(src: &Path, dst: &Path) -> std::io::Result<u64> {
    fs::create_dir_all(dst)?;
    let mut count = 0;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            count += copy_dir_add_only(&from, &to)?;
        } else if !to.exists() {
            fs::copy(&from, &to)?;
            count += 1;
        }
    }
    Ok(count)
}

// --- "Optional" installs: your own Daz/Houdini content (not DTH release) ----
// Daz content folders an asset contributes to the library; Documentation is a
// fallback when none of the real content folders are present.
const CONTENT_FOLDERS: [&str; 3] = ["data", "People", "Runtime"];
const META_FOLDERS: [&str; 1] = ["Documentation"];

/// The display name of a path's final component.
fn folder_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.display().to_string())
}

/// Which content (or, failing that, metadata) folders sit directly in `dir`.
fn content_folders_in(dir: &Path) -> Vec<String> {
    let real: Vec<String> = CONTENT_FOLDERS
        .iter()
        .filter(|n| dir.join(n).is_dir())
        .map(|n| (*n).to_string())
        .collect();
    if !real.is_empty() {
        return real;
    }
    META_FOLDERS
        .iter()
        .filter(|n| dir.join(n).is_dir())
        .map(|n| (*n).to_string())
        .collect()
}

/// Find the directory under `root` (within `depth` levels) that holds Daz content
/// folders, plus the folder names found. Daz assets keep these at the root or a
/// folder or two down (esp. inside zips).
fn find_content_level(root: &Path, depth: u32) -> Option<(PathBuf, Vec<String>)> {
    let here = content_folders_in(root);
    if !here.is_empty() {
        return Some((root.to_path_buf(), here));
    }
    if depth == 0 {
        return None;
    }
    for entry in fs::read_dir(root).into_iter().flatten().flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_content_level(&p, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

/// First file (recursively, name-sorted) under `dir`, relative to `base` — used as
/// an "already installed?" marker for skip detection.
fn first_file_rel(dir: &Path, base: &Path) -> Option<PathBuf> {
    let mut entries: Vec<_> = fs::read_dir(dir).ok()?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in &entries {
        let p = e.path();
        if p.is_file() {
            return p.strip_prefix(base).ok().map(|r| r.to_path_buf());
        }
    }
    for e in &entries {
        let p = e.path();
        if p.is_dir() {
            if let Some(m) = first_file_rel(&p, base) {
                return Some(m);
            }
        }
    }
    None
}

/// Extract a `.zip` into a fresh temp dir (returned for the caller to clean up).
fn extract_zip(zip_path: &Path) -> std::io::Result<PathBuf> {
    let file = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp = std::env::temp_dir().join(format!("dth-asset-{}-{}", std::process::id(), nanos));
    archive
        .extract(&temp)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    Ok(temp)
}

/// An asset resolved to its content level — a zipped asset carries a `temp` dir
/// the caller must remove when done.
enum AssetContent {
    Found { temp: Option<PathBuf>, root: PathBuf, folders: Vec<String> },
    None { temp: Option<PathBuf> },
    Error(String),
}

/// Resolve an asset path (a folder or a `.zip`) to its Daz content level.
fn resolve_asset(asset: &Path) -> AssetContent {
    let is_zip = asset.extension().map_or(false, |e| e.eq_ignore_ascii_case("zip"));
    if is_zip {
        match extract_zip(asset) {
            Ok(t) => match find_content_level(&t, 5) {
                Some((root, folders)) => AssetContent::Found { temp: Some(t), root, folders },
                None => AssetContent::None { temp: Some(t) },
            },
            Err(e) => AssetContent::Error(format!("unzip failed: {e}")),
        }
    } else if asset.is_dir() {
        match find_content_level(asset, 5) {
            Some((root, folders)) => AssetContent::Found { temp: None, root, folders },
            None => AssetContent::None { temp: None },
        }
    } else {
        AssetContent::None { temp: None }
    }
}

/// Append `SHARED_PRESETS` + `HOUDINI_PATH` to `<houdini_docs>/houdini.env` if not
/// already present (idempotent). Returns whether it changed the file.
fn wire_houdini_env(houdini_docs: &Path, presets_dir: &Path) -> std::io::Result<bool> {
    let env_path = houdini_docs.join("houdini.env");
    let presets_fwd = presets_dir.display().to_string().replace('\\', "/");
    let existing = fs::read_to_string(&env_path).unwrap_or_default();
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
/// Daz library, and (optionally) `Houdini Assets/*` → the Houdini documents
/// folder. Native port of the dth-cli `install-daz-dth` / `install-houdini-dth`.
#[tauri::command]
fn install_dth_release(request: ReleaseInstallRequest) -> InstallReport {
    let dry = request.dry_run;
    let release_root = Path::new(&request.release_root);
    let daz_content = release_root.join("Daz Studio Content");
    let lib = Path::new(&request.daz_lib_folder);
    let mut steps: Vec<InstallStep> = Vec::new();

    // Daz content (data, DazToHue) → My DAZ 3D Library.
    for folder in ["data", "DazToHue"] {
        steps.push(install_folder(
            &format!("Daz content: {folder}"),
            &daz_content.join(folder),
            &lib.join(folder),
            dry,
        ));
    }

    // Houdini assets (otls/presets/toolbar/…) → Houdini documents folder (optional).
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

    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}

/// Install the *Exporter Plugin* DLLs into `<Daz install>/plugins`. This is the
/// admin-sensitive half — writing into Program Files needs elevation and Daz
/// locks loaded plugin DLLs (see `install_plugin_dlls`).
#[tauri::command]
fn install_dth_plugin(request: PluginInstallRequest) -> InstallReport {
    let step = install_plugin_dlls(
        "Exporter plugin",
        Path::new(&request.exporter_folder),
        Path::new(&request.daz_install_folder),
        request.dry_run,
    );
    let total_files = step.files;
    InstallReport { dry_run: request.dry_run, steps: vec![step], total_files }
}

// --- "Optional" tab installs ----------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DazAssetsRequest {
    /// Your asset source folders; each holds many assets (folders and/or `.zip`s).
    sources: Vec<String>,
    /// "My DAZ 3D Library" — where content folders are installed.
    dest: String,
    /// Re-install assets that already appear installed.
    force: bool,
    dry_run: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetScanRequest {
    sources: Vec<String>,
    dest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeInstallRequest {
    label: String,
    source: String,
    dest: String,
    dry_run: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HoudiniPresetsRequest {
    source: String,
    houdini_docs: String,
    dry_run: bool,
}

/// Install your own Daz assets (G3/G8/G9, `.zip`s extracted) from the source
/// folders into the library — content-folder-aware, overwriting per asset, and
/// skipping ones that already appear installed unless `force`.
#[tauri::command]
fn install_daz_assets(request: DazAssetsRequest) -> InstallReport {
    let dry = request.dry_run;
    let dest = Path::new(&request.dest);
    let mut steps: Vec<InstallStep> = Vec::new();
    for source in &request.sources {
        let src = Path::new(source);
        if !src.is_dir() {
            steps.push(step_skip(&folder_name(src), format!("folder not found ({})", src.display())));
            continue;
        }
        let mut assets: Vec<PathBuf> = match fs::read_dir(src) {
            Ok(e) => e.flatten().map(|x| x.path()).collect(),
            Err(e) => {
                steps.push(step_err(&folder_name(src), io_detail("read", &e)));
                continue;
            }
        };
        assets.sort();
        for asset in &assets {
            let name = folder_name(asset);
            let (temp, level) = match resolve_asset(asset) {
                AssetContent::Found { temp, root, folders } => (temp, Some((root, folders))),
                AssetContent::None { temp } => (temp, None),
                AssetContent::Error(msg) => {
                    steps.push(step_err(&name, msg));
                    continue;
                }
            };
            match level {
                None => steps.push(step_skip(&name, "no Daz content found".into())),
                Some((content_root, folders)) => {
                    let marker = first_file_rel(&content_root, &content_root);
                    let already = !request.force
                        && marker.as_ref().map_or(false, |m| dest.join(m).exists());
                    if already {
                        steps.push(step_skip(&name, "already installed".into()));
                    } else if dry {
                        let files: u64 =
                            folders.iter().map(|f| count_files(&content_root.join(f))).sum();
                        steps.push(step_ok(&name, files, format!("would install {}", folders.join(", "))));
                    } else {
                        let mut total = 0u64;
                        let mut err: Option<String> = None;
                        for f in &folders {
                            match copy_dir(&content_root.join(f), &dest.join(f)) {
                                Ok(n) => total += n,
                                Err(e) => {
                                    err = Some(io_detail(&format!("{} → {}", f, dest.join(f).display()), &e));
                                    break;
                                }
                            }
                        }
                        match err {
                            Some(m) => steps.push(step_err(&name, m)),
                            None => steps.push(step_ok(&name, total, format!("installed {}", folders.join(", ")))),
                        }
                    }
                }
            }
            if let Some(t) = temp {
                let _ = fs::remove_dir_all(&t);
            }
        }
    }
    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}

/// Read-only scan: what content each asset holds and whether it's already in the library.
#[tauri::command]
fn list_daz_assets(request: AssetScanRequest) -> InstallReport {
    let dest = Path::new(&request.dest);
    let mut steps: Vec<InstallStep> = Vec::new();
    for source in &request.sources {
        let src = Path::new(source);
        if !src.is_dir() {
            steps.push(step_skip(&folder_name(src), format!("folder not found ({})", src.display())));
            continue;
        }
        let mut assets: Vec<PathBuf> = match fs::read_dir(src) {
            Ok(e) => e.flatten().map(|x| x.path()).collect(),
            Err(e) => {
                steps.push(step_err(&folder_name(src), io_detail("read", &e)));
                continue;
            }
        };
        assets.sort();
        for asset in &assets {
            let name = folder_name(asset);
            let (temp, level) = match resolve_asset(asset) {
                AssetContent::Found { temp, root, folders } => (temp, Some((root, folders))),
                AssetContent::None { temp } => (temp, None),
                AssetContent::Error(msg) => {
                    steps.push(step_err(&name, msg));
                    continue;
                }
            };
            match level {
                None => steps.push(step_skip(&name, "no Daz content".into())),
                Some((content_root, folders)) => {
                    let files: u64 = folders.iter().map(|f| count_files(&content_root.join(f))).sum();
                    let installed = first_file_rel(&content_root, &content_root)
                        .map_or(false, |m| dest.join(m).exists());
                    let detail = if installed {
                        format!("{} · installed", folders.join(", "))
                    } else {
                        folders.join(", ")
                    };
                    steps.push(step_ok(&name, files, detail));
                }
            }
            if let Some(t) = temp {
                let _ = fs::remove_dir_all(&t);
            }
        }
    }
    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: true, steps, total_files }
}

/// Merge-only install (adds new files, never overwrites) for custom morphs / presets.
#[tauri::command]
fn install_daz_merge(request: MergeInstallRequest) -> InstallReport {
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
fn install_houdini_presets(request: HoudiniPresetsRequest) -> InstallReport {
    let dry = request.dry_run;
    let src = Path::new(&request.source);
    let houdini_docs = Path::new(&request.houdini_docs);
    let mut steps: Vec<InstallStep> = Vec::new();
    if !src.is_dir() {
        steps.push(step_skip("Houdini presets", format!("source not found ({})", src.display())));
    } else {
        let dest = houdini_docs.join(folder_name(src));
        if dry {
            steps.push(step_ok("Houdini presets", count_files(src), format!("would replace → {}", dest.display())));
            steps.push(step_skip("houdini.env", "would wire SHARED_PRESETS + HOUDINI_PATH".into()));
        } else {
            let mut failed = false;
            if dest.exists() {
                if let Err(e) = fs::remove_dir_all(&dest) {
                    steps.push(step_err("Houdini presets", io_detail(&format!("clear {}", dest.display()), &e)));
                    failed = true;
                }
            }
            if !failed {
                match copy_dir(src, &dest) {
                    Ok(n) => steps.push(step_ok("Houdini presets", n, format!("→ {}", dest.display()))),
                    Err(e) => {
                        steps.push(step_err("Houdini presets", io_detail(&format!("{} → {}", src.display(), dest.display()), &e)));
                        failed = true;
                    }
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

// --- Pose-asset frame counts ----------------------------------------------
// A Daz pose preset (.duf) is DSON — JSON, sometimes gzip-compressed. The ROM
// length a preset occupies on the timeline is the highest animation key time ×
// the DTH 30 fps (+1 for the 0-based count). Measuring this on the fly means we
// never hard-code frame counts and custom assets work the same as DTH ones.

const DTH_FPS: f64 = 30.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PoseAssetFrames {
    path: String,
    /// Frames the asset occupies (0 when it couldn't be measured — see `error`).
    frames: u32,
    /// Empty on success; otherwise why the count couldn't be determined.
    error: String,
}

/// Frames a single `.duf` occupies: `round(maxKeyTime × 30) + 1`.
fn duf_frame_count(path: &Path) -> Result<u32, String> {
    let raw = fs::read(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    // Daz can save pose presets gzip-compressed; detect via the magic bytes.
    let bytes = if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut out = Vec::new();
        std::io::Read::read_to_end(&mut flate2::read::GzDecoder::new(&raw[..]), &mut out)
            .map_err(|e| format!("decompress {}: {}", path.display(), e))?;
        out
    } else {
        raw
    };
    let json: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse {}: {}", path.display(), e))?;
    let animations = json
        .get("scene")
        .and_then(|s| s.get("animations"))
        .and_then(|a| a.as_array())
        .ok_or_else(|| format!("{}: no scene.animations (is it a pose/animation preset?)", path.display()))?;
    let mut max_t = f64::NEG_INFINITY;
    for anim in animations {
        if let Some(keys) = anim.get("keys").and_then(|k| k.as_array()) {
            for key in keys {
                // Each key is [time, value, …]; time is in seconds.
                if let Some(t) = key.get(0).and_then(|v| v.as_f64()) {
                    if t > max_t {
                        max_t = t;
                    }
                }
            }
        }
    }
    if !max_t.is_finite() {
        return Err(format!("{}: no animation keyframes found", path.display()));
    }
    Ok((max_t * DTH_FPS).round() as u32 + 1)
}

/// Measure the frame length of each `.duf` (parallel-friendly but cheap enough
/// serially). Each result carries its own error so the caller can hard-fail on
/// exactly the asset(s) that couldn't be read.
#[tauri::command]
fn pose_asset_frames(paths: Vec<String>) -> Vec<PoseAssetFrames> {
    paths
        .into_iter()
        .map(|path| match duf_frame_count(Path::new(&path)) {
            Ok(frames) => PoseAssetFrames { path, frames, error: String::new() },
            Err(error) => PoseAssetFrames { path, frames: 0, error },
        })
        .collect()
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
            install_dth_release,
            install_dth_plugin,
            install_daz_assets,
            list_daz_assets,
            install_daz_merge,
            install_houdini_presets,
            unc_for_path,
            ensure_network_drives,
            pose_asset_frames
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
