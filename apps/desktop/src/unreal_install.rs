//! --- Unreal Engine: installed versions + plugin sources ---------------------
//! Which Unreal Engine versions are on this machine, where the user's UE
//! plugins live, what a linked `.uproject` already carries, and installing a
//! plugin build into a project.
//!
//! **Engine detection** mirrors `houdini_install.rs`: the Epic launcher records
//! every installed engine under `HKLM\SOFTWARE\EpicGames\Unreal Engine`, one
//! SUBKEY per version (`5.7`) whose `InstalledDirectory` value is the engine
//! folder. That is authoritative for launcher installs — probing default
//! folders would miss a relocated engine. Source builds (registered per-user
//! under `HKCU\...\Builds` with a GUID, no version) are deliberately NOT
//! listed: their version would need a filesystem read of the build tree, and a
//! `.uproject` bound to one carries a GUID `EngineAssociation` the UI already
//! reports as "unknown engine version".
//!
//! **Plugin scanning** walks each configured source folder a bounded three
//! levels deep and collects every folder holding a `.uplugin` (never
//! descending INTO a found plugin — its `Content`/`Source` are the plugin's
//! own). That one rule covers all the shipped shapes: the folder being a
//! plugin itself, a folder of plugins, and a multi-build root
//! (`DazToUnrealBridge/UE_5.7/Plugins/…`).
//!
//! **Which engine a plugin build is FOR**: a version-looking segment of the
//! plugin folder's full path (deepest wins — `UE_5.7`, `ue5.7`, `Daz 5.6`),
//! falling back to the `.uplugin`'s own `EngineVersion`. The path wins over
//! the manifest on purpose: the folder layout is the signal the user can see
//! and fix, a stale manifest field is neither. No version anywhere = an
//! any-engine plugin (matches every project).
//!
//! Registry access and the measured-unreliable `exists` probes (see
//! `unreal_dth_present` in install.rs) are why this is native; matching
//! plugins to a project's engine version is TS, in
//! `apps/web/src/lib/unreal-install.ts`, where it is unit-testable.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::fsutil::copy_dir;

#[derive(Debug, serde::Serialize)]
#[cfg_attr(test, derive(serde::Deserialize, PartialEq))]
#[serde(rename_all = "camelCase")]
pub struct UnrealEngineInstall {
    /// The version as Epic keys it (`5.7`, `4.27`) — always major.minor.
    pub version: String,
    /// Engine install folder, trailing separator trimmed.
    pub path: String,
}

/// One plugin build found under a configured source folder.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(test, derive(serde::Deserialize, PartialEq))]
#[serde(rename_all = "camelCase")]
pub struct UnrealPluginSource {
    /// Plugin name — the `.uplugin` file's stem (`DazToUnreal`), which is also
    /// the folder name the install writes under the project's `Plugins/`.
    pub name: String,
    /// The folder holding the `.uplugin` (what an install copies).
    pub path: String,
    /// `major.minor` this build targets (`5.7`), or `""` = any engine.
    pub engine_version: String,
    /// The configured settings folder this was found under.
    pub source_folder: String,
}

/// What a linked `.uproject` is and already carries — one probe for the
/// install dialog. Rust-side because the JS fs plugin's `exists` proved
/// unreliable on a real project (see `unreal_dth_present`).
#[derive(Debug, serde::Serialize)]
#[cfg_attr(test, derive(serde::Deserialize, PartialEq))]
#[serde(rename_all = "camelCase")]
pub struct UnrealProjectState {
    /// The `.uproject`'s `EngineAssociation`, verbatim: `5.7` for a launcher
    /// engine, a GUID for a source build, `""` when absent.
    pub engine_association: String,
    /// Whether `Content/DazToHue` exists (the DTH content install's target).
    pub dth_present: bool,
    /// Folder names under the project's `Plugins/`, sorted.
    pub installed_plugins: Vec<String>,
}

/// Every Unreal Engine the Epic launcher has registered, in registry order
/// (the caller sorts — registry order is ALPHABETIC, which misorders `5.10`
/// vs `5.7`).
///
/// Never fails: no key (UE was never installed), no permission, or a
/// non-Windows build all return an empty list. A missing Unreal is not an
/// error.
#[tauri::command(async)]
pub fn unreal_engine_installs() -> Vec<UnrealEngineInstall> {
    read_engine_installs()
}

#[cfg(not(windows))]
fn read_engine_installs() -> Vec<UnrealEngineInstall> {
    Vec::new()
}

#[cfg(windows)]
fn read_engine_installs() -> Vec<UnrealEngineInstall> {
    use windows_sys::Win32::Foundation::{ERROR_SUCCESS, MAX_PATH};
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE,
        KEY_READ, RRF_RT_REG_SZ,
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

    let subkey = wide(r"SOFTWARE\EpicGames\Unreal Engine");
    let mut key: HKEY = std::ptr::null_mut();
    // SAFETY: `subkey` is a valid NUL-terminated wide string that outlives the
    // call, and `key` is a valid out-pointer. Nothing is read from `key` unless
    // the call reports success.
    let opened = unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.as_ptr(), 0, KEY_READ, &mut key) };
    if opened != ERROR_SUCCESS {
        return Vec::new();
    }

    let mut installs = Vec::new();
    let mut index = 0u32;
    loop {
        let mut name = [0u16; 256];
        let mut name_len = name.len() as u32;
        // SAFETY: `name` is a live local of the length passed alongside it;
        // `key` came from a successful RegOpenKeyExW above.
        let status = unsafe {
            RegEnumKeyExW(
                key,
                index,
                name.as_mut_ptr(),
                &mut name_len,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            break;
        }
        index += 1;
        let version = from_wide(&name[..name_len.min(name.len() as u32) as usize]);
        if !is_engine_version(&version) {
            continue;
        }
        let version_w = wide(&version);
        let value_w = wide("InstalledDirectory");
        let mut data = [0u16; (MAX_PATH as usize) * 2];
        let mut data_len = (std::mem::size_of_val(&data)) as u32;
        // SAFETY: all pointers refer to live locals; RegGetValueW opens the
        // named subkey itself, so `key` stays the parent handle.
        let got = unsafe {
            RegGetValueW(
                key,
                version_w.as_ptr(),
                value_w.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                data.as_mut_ptr().cast(),
                &mut data_len,
            )
        };
        if got != ERROR_SUCCESS {
            continue;
        }
        let path = trim_trailing_sep(&from_wide(&data));
        if path.is_empty() {
            continue;
        }
        installs.push(UnrealEngineInstall { version, path });
    }

    // SAFETY: `key` is the handle RegOpenKeyExW returned and is not used after.
    unsafe { RegCloseKey(key) };
    installs
}

/// Whether a registry subkey name is a launcher-installed engine version.
/// Epic keys launcher installs `major.minor` (`5.7`, `4.27`) — anything else
/// under the key is not an engine this app can match a `.uproject` against.
fn is_engine_version(name: &str) -> bool {
    let parts: Vec<&str> = name.split('.').collect();
    parts.len() == 2 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// Trailing `\` / `/` removed — every comparison and join on the TS side
/// assumes there is none.
fn trim_trailing_sep(path: &str) -> String {
    path.trim_end_matches(['\\', '/']).to_string()
}

/// Every plugin build found under the given source folders (the
/// `unrealPluginFolders` setting), sorted by name/version/path. A missing or
/// empty folder contributes nothing — the UI shows that as "no plugins found",
/// it is not an error.
#[tauri::command(async)]
pub fn scan_unreal_plugins(folders: Vec<String>) -> Vec<UnrealPluginSource> {
    let mut out = Vec::new();
    for folder in &folders {
        let root = Path::new(folder);
        if root.is_dir() {
            scan_dir(root, 3, folder, &mut out);
        }
    }
    out.sort_by(|a, b| {
        (a.name.to_lowercase(), &a.engine_version, &a.path)
            .cmp(&(b.name.to_lowercase(), &b.engine_version, &b.path))
    });
    out
}

/// Collect plugin folders up to `depth` levels below `dir`. A folder holding a
/// `.uplugin` IS a plugin — record it and do not descend further (its
/// `Content`/`Source` are plugin internals, and a nested `.uplugin` in there
/// is not a separate install source).
fn scan_dir(dir: &Path, depth: u32, source_folder: &str, out: &mut Vec<UnrealPluginSource>) {
    if let Some(uplugin) = uplugin_in(dir) {
        push_plugin(dir, &uplugin, source_folder, out);
        return;
    }
    // A plugin can also arrive ZIPPED — several vendors ship exactly one
    // `<Plugin>.zip` in a versioned folder and nothing else (measured:
    // `…/UnrealEnginePlugin/Unreal Engine 5.7 Plugin/DazToHue.zip`). The folder
    // holds no `.uplugin`, so the walk used to pass straight over it and report
    // "no Unreal plugin found here" about a folder that plainly has one.
    for zip in sorted_zips(dir) {
        if let Some(found) = zipped_plugin(&zip) {
            push_zipped_plugin(&zip, &found, source_folder, out);
        }
    }
    if depth == 0 {
        return;
    }
    for child in sorted_dirs(dir) {
        scan_dir(&child, depth - 1, source_folder, out);
    }
}

fn push_plugin(dir: &Path, uplugin: &Path, source_folder: &str, out: &mut Vec<UnrealPluginSource>) {
    let name = match uplugin.file_stem() {
        Some(stem) => stem.to_string_lossy().into_owned(),
        None => return,
    };
    // The path is the user-visible, user-fixable signal, so it outranks the
    // `.uplugin`'s own EngineVersion (see the module docs).
    let engine_version = version_from_components(dir)
        .or_else(|| engine_version_from_uplugin(uplugin))
        .unwrap_or_default();
    out.push(UnrealPluginSource {
        name,
        path: dir.to_string_lossy().into_owned(),
        engine_version,
        source_folder: source_folder.to_string(),
    });
}

/// A plugin found INSIDE a zip: the `.uplugin` entry's name, the archive-
/// relative folder it sits in ('' when it is at the archive root), and the
/// `EngineVersion` its JSON declares.
struct ZippedPlugin {
    name: String,
    /// Everything under this prefix is the plugin; the install strips it so the
    /// `.uplugin` lands directly in `Plugins/<name>/`.
    prefix: String,
    engine_version: Option<String>,
}

/// Read a zip's directory and, if it holds a `.uplugin`, describe the plugin.
///
/// Only the ONE `.uplugin` entry is inflated (a few hundred bytes) — the rest
/// of the archive is never touched, so scanning a folder of large plugin zips
/// stays a central-directory read. The SHALLOWEST `.uplugin` wins: a plugin
/// that vendors a second plugin under its own `Content` is still one install.
fn zipped_plugin(zip_path: &Path) -> Option<ZippedPlugin> {
    let file = std::fs::File::open(zip_path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut best: Option<(usize, usize, String)> = None; // (depth, index, name)
    for idx in 0..archive.len() {
        let entry = archive.by_index_raw(idx).ok()?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().replace('\\', "/");
        if !name.to_lowercase().ends_with(".uplugin") {
            continue;
        }
        let depth = name.matches('/').count();
        // Ties broken by name so a two-`.uplugin` archive scans the same way
        // every time.
        let better = match &best {
            None => true,
            Some((d, _, n)) => depth < *d || (depth == *d && &name < n),
        };
        if better {
            best = Some((depth, idx, name));
        }
    }
    let (_, idx, entry_name) = best?;
    let prefix = match entry_name.rfind('/') {
        Some(cut) => entry_name[..=cut].to_string(),
        None => String::new(),
    };
    let name = Path::new(&entry_name).file_stem()?.to_string_lossy().into_owned();
    // Tolerant like the loose-file read: an unreadable manifest costs the
    // version fallback, never the plugin.
    let engine_version = crate::archive::read_zip_entry_string(&mut archive, idx, ".uplugin")
        .ok()
        .as_deref()
        .and_then(engine_version_from_uplugin_json);
    Some(ZippedPlugin { name, prefix, engine_version })
}

fn push_zipped_plugin(
    zip_path: &Path,
    found: &ZippedPlugin,
    source_folder: &str,
    out: &mut Vec<UnrealPluginSource>,
) {
    // Same precedence as a loose plugin: the path the user can see and fix
    // outranks the manifest. The zip's own folder carries the version here
    // ("Unreal Engine 5.7 Plugin"), which is exactly the visible signal.
    let engine_version = version_from_components(zip_path)
        .or_else(|| found.engine_version.clone())
        .unwrap_or_default();
    out.push(UnrealPluginSource {
        name: found.name.clone(),
        path: zip_path.to_string_lossy().into_owned(),
        engine_version,
        source_folder: source_folder.to_string(),
    });
}

/// `.zip` files directly in `dir`, sorted by name.
fn sorted_zips(dir: &Path) -> Vec<PathBuf> {
    let mut zips: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
                .map(|e| e.path())
                .filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false))
                .collect()
        })
        .unwrap_or_default();
    zips.sort();
    zips
}

/// The first `.uplugin` file directly in `dir` (sorted, so a stray second one
/// is at least deterministic), or None.
fn uplugin_in(dir: &Path) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.path())
        .filter(|p| {
            p.extension().map(|e| e.eq_ignore_ascii_case("uplugin")).unwrap_or(false)
        })
        .collect();
    found.sort();
    found.into_iter().next()
}

/// Child directories of `dir`, sorted by name. Symlinked dirs are skipped —
/// same policy as every walker in fsutil: a link is not the tree's own content.
fn sorted_dirs(dir: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| e.path())
                .collect()
        })
        .unwrap_or_default();
    dirs.sort();
    dirs
}

/// The engine version named by the plugin folder's own path — the deepest
/// version-looking segment wins (`…/DazToUnrealBridge/UE_5.7/Plugins/X` → the
/// `UE_5.7` beats anything above it).
fn version_from_components(path: &Path) -> Option<String> {
    let mut segments: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    segments.reverse();
    segments.iter().find_map(|s| ue_version_in(s))
}

/// A `major.minor` engine version found in ONE path segment, normalized
/// (`UE_5.7`, `ue5.7`, `DazToUnreal 5.6`, `Bridge_5.6.1` → `5.6`). A
/// `UE`-prefixed occurrence beats a bare one; among bare occurrences the LAST
/// wins (versions suffix names). Digits glued to a word (`Plugin2.0`) are not
/// a version, and a lone `UE5` names a generation, not a build target.
fn ue_version_in(segment: &str) -> Option<String> {
    let chars: Vec<char> = segment.chars().collect();
    let mut best_bare: Option<String> = None;
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }
        // Need `.digits` right after the major run.
        if i >= chars.len() || chars[i] != '.' || i + 1 >= chars.len() || !chars[i + 1].is_ascii_digit()
        {
            continue;
        }
        let major: String = chars[start..i].iter().collect();
        i += 1;
        let minor_start = i;
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }
        let minor: String = chars[minor_start..i].iter().collect();
        // Boundary after: end of segment, a separator, or a `.patch` tail.
        let after_ok = i >= chars.len() || matches!(chars[i], '_' | '-' | ' ' | '.' | '(' | ')');
        let (before_ok, ue_prefixed) = boundary_before(&chars, start);
        if !after_ok || !before_ok {
            continue;
        }
        let normalized = format!(
            "{}.{}",
            major.parse::<u32>().unwrap_or(0),
            minor.parse::<u32>().unwrap_or(0)
        );
        if ue_prefixed {
            return Some(normalized);
        }
        best_bare = Some(normalized);
    }
    best_bare
}

/// Whether the digits starting at `start` sit on a word boundary, and whether
/// that boundary is a `UE` prefix (`UE5.7`, `UE_5.7`, `ue-5.7`).
fn boundary_before(chars: &[char], start: usize) -> (bool, bool) {
    if start == 0 {
        return (true, false);
    }
    // The candidate `E` of a UE prefix sits right before the digits, or before
    // one separator (`UE_5.7`).
    let mut e_end = start;
    if matches!(chars[start - 1], '_' | '-' | ' ') {
        if start == 1 {
            return (true, false);
        }
        e_end = start - 1;
    }
    if e_end >= 2
        && matches!(chars[e_end - 1], 'E' | 'e')
        && matches!(chars[e_end - 2], 'U' | 'u')
        && (e_end == 2 || !chars[e_end - 3].is_ascii_alphanumeric())
    {
        return (true, true);
    }
    (!chars[start - 1].is_ascii_alphanumeric(), false)
}

/// `major.minor` out of a `.uplugin`'s `EngineVersion` field (`"5.7.0"` →
/// `5.7`), or None when the file is unreadable, not JSON, or carries none —
/// a tolerant fallback, never an error.
fn engine_version_from_uplugin(uplugin: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(uplugin).ok()?;
    engine_version_from_uplugin_json(&raw)
}

fn engine_version_from_uplugin_json(raw: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(raw).ok()?;
    let version = json.get("EngineVersion")?.as_str()?;
    let mut parts = version.split('.');
    let major: u32 = parts.next()?.trim().parse().ok()?;
    let minor: u32 = parts.next()?.trim().parse().ok()?;
    Some(format!("{major}.{minor}"))
}

/// The `.uproject` file checks shared by every command that takes one.
fn uproject_dir(uproject_path: &str) -> Result<PathBuf, String> {
    let uproject = Path::new(uproject_path);
    let is_uproject =
        uproject.extension().map(|e| e.eq_ignore_ascii_case("uproject")).unwrap_or(false);
    if !is_uproject || !uproject.is_file() {
        return Err("Not an Unreal project file (.uproject).".into());
    }
    uproject
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "The .uproject has no parent folder.".to_string())
}

/// What the linked project is and already carries — the install dialog's one
/// probe (engine association + DTH content + installed plugin folders).
// `(async)` even for a probe: fs checks on an unreachable network project can
// block for seconds — that stall must not happen on the main thread.
#[tauri::command(async)]
pub fn unreal_project_state(uproject_path: String) -> Result<UnrealProjectState, String> {
    let dir = uproject_dir(&uproject_path)?;
    let raw = std::fs::read_to_string(&uproject_path)
        .map_err(|e| format!("Could not read the .uproject: {e}"))?;
    let json: serde_json::Value =
        serde_json::from_str(&raw).map_err(|_| "The .uproject is not valid JSON.".to_string())?;
    let engine_association =
        json.get("EngineAssociation").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let dth_present = dir.join("Content").join("DazToHue").is_dir();
    let mut installed_plugins: Vec<String> = std::fs::read_dir(dir.join("Plugins"))
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default();
    installed_plugins.sort();
    Ok(UnrealProjectState { engine_association, dth_present, installed_plugins })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnrealPluginInstallRequest {
    /// The plugin build's folder (holds the `.uplugin`) — a `path` from
    /// `scan_unreal_plugins`.
    plugin_path: String,
    /// The linked `.uproject` — the plugin lands in its folder's
    /// `Plugins/<name>`.
    uproject_path: String,
    /// Copy over an existing `Plugins/<name>` (the install dialog's default —
    /// a checked item means "make it this build").
    overwrite: bool,
}

/// Install one plugin build into the project's `Plugins/<name>` (`name` = the
/// `.uplugin` stem, Unreal's own identity for it — NOT the source folder's
/// name, which may carry a version suffix). Overwrite copies files over — it
/// never deletes first, same policy as the DTH content install. Returns files
/// copied.
#[tauri::command(async)]
pub fn install_unreal_plugin(request: UnrealPluginInstallRequest) -> Result<u64, String> {
    let project_dir = uproject_dir(&request.uproject_path)?;
    let source = Path::new(&request.plugin_path);
    // A zipped plugin installs by EXTRACTING, not copying: what the scan
    // offered is the archive, and what Unreal needs is its contents under
    // `Plugins/<name>/`.
    if source.extension().map(|e| e.eq_ignore_ascii_case("zip")).unwrap_or(false) {
        return install_plugin_from_zip(source, &project_dir, request.overwrite);
    }
    let uplugin = uplugin_in(source)
        .ok_or_else(|| "Not an Unreal plugin folder (no .uplugin inside).".to_string())?;
    let name = uplugin
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .ok_or_else(|| "The .uplugin has no name.".to_string())?;
    let dest = project_dir.join("Plugins").join(&name);
    if dest.exists() && !request.overwrite {
        return Err(format!("Plugins/{name} already exists in this project."));
    }
    copy_dir(source, &dest).map(|stats| stats.files).map_err(|e| e.to_string())
}

/// Extract a zipped plugin into `<project>/Plugins/<name>/`.
///
/// Everything under the `.uplugin`'s own folder inside the archive is written,
/// with that prefix STRIPPED — a zip wrapping its plugin in `DazToHue/` and one
/// holding the files at its root both land as `Plugins/DazToHue/DazToHue.uplugin`.
/// Entries outside that prefix (a README beside the plugin folder, a
/// `__MACOSX` sidecar) are not the plugin and are skipped.
///
/// Like every other install here it is copy-OVER, never delete-first: an
/// existing folder keeps whatever the archive does not replace.
fn install_plugin_from_zip(
    zip_path: &Path,
    project_dir: &Path,
    overwrite: bool,
) -> Result<u64, String> {
    let found = zipped_plugin(zip_path)
        .ok_or_else(|| "That zip holds no Unreal plugin (no .uplugin inside).".to_string())?;
    let dest = project_dir.join("Plugins").join(&found.name);
    if dest.exists() && !overwrite {
        return Err(format!("Plugins/{} already exists in this project.", found.name));
    }
    let file = std::fs::File::open(zip_path).map_err(|e| format!("Could not open the zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Could not read the zip: {e}"))?;
    let mut budget = crate::archive::InflateBudget::new(
        zip_path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        std::fs::metadata(zip_path).map(|m| m.len()).unwrap_or(0),
    );
    budget.check_entry_count(archive.len()).map_err(|e| e.to_string())?;

    let mut written = 0u64;
    for idx in 0..archive.len() {
        let (name, is_dir) = {
            let entry = archive
                .by_index_raw(idx)
                .map_err(|e| format!("Could not read a zip entry: {e}"))?;
            (entry.name().replace('\\', "/"), entry.is_dir())
        };
        if is_dir {
            continue;
        }
        let Some(rel) = name.strip_prefix(&found.prefix) else { continue };
        let Some(safe) = safe_relative(rel) else {
            // Zip-slip: an entry naming `..` or an absolute path would write
            // outside the project. Skipped, never resolved.
            continue;
        };
        crate::archive::extract_zip_entry(&mut archive, idx, &dest.join(safe), &mut budget)
            .map_err(|e| format!("Could not extract {rel}: {e}"))?;
        written += 1;
    }
    if written == 0 {
        return Err("That zip holds no plugin files to install.".into());
    }
    Ok(written)
}

/// An archive entry name as a relative path that cannot escape its destination.
/// Rejects absolute paths, drive letters and any `..` component outright rather
/// than normalizing them away — a refusal is auditable, a rewrite is not.
fn safe_relative(rel: &str) -> Option<PathBuf> {
    let rel = rel.trim_start_matches('/');
    if rel.is_empty() || rel.contains(':') {
        return None;
    }
    let mut out = PathBuf::new();
    for part in rel.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return None;
        }
        out.push(part);
    }
    if out.as_os_str().is_empty() { None } else { Some(out) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::unique_temp_dir;
    use std::fs;

    /// Write a zip at `path` from `(entry name, contents)` pairs.
    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let file = fs::File::create(path).unwrap();
        let mut zipw = zip::ZipWriter::new(file);
        for (name, body) in entries {
            zipw.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut zipw, body.as_bytes()).unwrap();
        }
        zipw.finish().unwrap();
    }

    const UPLUGIN: &str = r#"{"FriendlyName":"DazToHue","EngineVersion":"5.6.0"}"#;

    /// Point this at a real configured plugin folder to see what the scan makes
    /// of it — the same shape as `unreal_engine_installs_here`, and the fastest
    /// way to check a vendor's packaging without building the app:
    ///
    /// ```text
    /// DTH_PLUGIN_SCAN_DIR="X:\…\UnrealEnginePlugin" cargo test unreal_plugins_here -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "machine-dependent: scans the folder in DTH_PLUGIN_SCAN_DIR"]
    fn unreal_plugins_here() {
        let Ok(dir) = std::env::var("DTH_PLUGIN_SCAN_DIR") else {
            println!("set DTH_PLUGIN_SCAN_DIR to a plugin folder");
            return;
        };
        for p in scan_unreal_plugins(vec![dir]) {
            println!("{} [{}] {}", p.name, if p.engine_version.is_empty() { "any" } else { &p.engine_version }, p.path);
        }
    }

    /// Install a REAL vendor zip into a scratch project, to check a shipped
    /// archive's packaging end to end:
    ///
    /// ```text
    /// DTH_PLUGIN_ZIP="…\DazToHue.zip" DTH_PLUGIN_PROJECT="…\Game" cargo test unreal_plugin_zip_installs_here -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "machine-dependent: installs DTH_PLUGIN_ZIP into DTH_PLUGIN_PROJECT"]
    fn unreal_plugin_zip_installs_here() {
        let (Ok(zip), Ok(project)) =
            (std::env::var("DTH_PLUGIN_ZIP"), std::env::var("DTH_PLUGIN_PROJECT"))
        else {
            println!("set DTH_PLUGIN_ZIP and DTH_PLUGIN_PROJECT");
            return;
        };
        match install_plugin_from_zip(Path::new(&zip), Path::new(&project), true) {
            Ok(n) => println!("installed {n} files"),
            Err(e) => println!("FAILED: {e}"),
        }
    }

    #[test]
    fn a_zipped_plugin_is_found_with_its_name_prefix_and_version() {
        let tmp = unique_temp_dir("uezip");
        let zip_path = tmp.join("DazToHue.zip");
        write_zip(
            &zip_path,
            &[("DazToHue/DazToHue.uplugin", UPLUGIN), ("DazToHue/Content/x.uasset", "data")],
        );
        let found = zipped_plugin(&zip_path).expect("plugin in zip");
        assert_eq!(found.name, "DazToHue");
        // The wrapping folder is the prefix the install strips.
        assert_eq!(found.prefix, "DazToHue/");
        assert_eq!(found.engine_version.as_deref(), Some("5.6"));
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn a_zip_with_the_plugin_at_its_root_has_no_prefix() {
        let tmp = unique_temp_dir("uezip");
        let zip_path = tmp.join("Flat.zip");
        write_zip(&zip_path, &[("Flat.uplugin", UPLUGIN), ("Content/y.uasset", "data")]);
        let found = zipped_plugin(&zip_path).expect("plugin in zip");
        assert_eq!(found.name, "Flat");
        assert_eq!(found.prefix, "");
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn the_shallowest_uplugin_wins_over_one_vendored_inside_it() {
        let tmp = unique_temp_dir("uezip");
        let zip_path = tmp.join("Outer.zip");
        write_zip(
            &zip_path,
            &[
                ("Outer/Content/Vendored/Inner.uplugin", UPLUGIN),
                ("Outer/Outer.uplugin", UPLUGIN),
            ],
        );
        assert_eq!(zipped_plugin(&zip_path).unwrap().name, "Outer");
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn a_zip_without_a_uplugin_is_not_a_plugin() {
        let tmp = unique_temp_dir("uezip");
        let zip_path = tmp.join("NotAPlugin.zip");
        write_zip(&zip_path, &[("readme.txt", "hello")]);
        assert!(zipped_plugin(&zip_path).is_none());
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn the_scan_reports_a_zipped_plugin_with_the_version_from_its_folder() {
        // The shape that prompted this: one zip in a versioned folder, no
        // loose `.uplugin` anywhere. The FOLDER names the engine (5.7), which
        // outranks the manifest's own 5.6 — same precedence as a loose plugin.
        let tmp = unique_temp_dir("uescan");
        let root = tmp.join("UnrealEnginePlugin");
        write_zip(&root.join("Unreal Engine 5.7 Plugin").join("DazToHue.zip"), &[(
            "DazToHue/DazToHue.uplugin",
            UPLUGIN,
        )]);
        let found = scan_unreal_plugins(vec![root.to_string_lossy().into_owned()]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "DazToHue");
        assert_eq!(found[0].engine_version, "5.7");
        assert!(found[0].path.ends_with("DazToHue.zip"));
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn installing_a_zipped_plugin_strips_the_wrapping_folder() {
        let tmp = unique_temp_dir("ueinstall");
        let zip_path = tmp.join("DazToHue.zip");
        write_zip(
            &zip_path,
            &[
                ("DazToHue/DazToHue.uplugin", UPLUGIN),
                ("DazToHue/Content/x.uasset", "data"),
                // Beside the plugin folder, so not part of the plugin.
                ("readme.txt", "ignored"),
            ],
        );
        let project = tmp.join("Game");
        fs::create_dir_all(&project).unwrap();
        let written = install_plugin_from_zip(&zip_path, &project, false).unwrap();
        assert_eq!(written, 2);
        assert!(project.join("Plugins/DazToHue/DazToHue.uplugin").is_file());
        assert!(project.join("Plugins/DazToHue/Content/x.uasset").is_file());
        assert!(!project.join("Plugins/DazToHue/readme.txt").exists());

        // Second install without overwrite is refused, not silently merged.
        assert!(install_plugin_from_zip(&zip_path, &project, false).is_err());
        assert!(install_plugin_from_zip(&zip_path, &project, true).is_ok());
        fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn a_zip_entry_cannot_escape_the_plugin_folder() {
        assert_eq!(safe_relative("Content/x.uasset"), Some(PathBuf::from("Content/x.uasset")));
        assert_eq!(safe_relative("./Content/x"), Some(PathBuf::from("Content/x")));
        // Zip-slip shapes: refused outright rather than normalized away.
        assert_eq!(safe_relative("../evil.txt"), None);
        assert_eq!(safe_relative("Content/../../evil.txt"), None);
        assert_eq!(safe_relative("C:/evil.txt"), None);
        assert_eq!(safe_relative("/abs.txt"), Some(PathBuf::from("abs.txt")));
        assert_eq!(safe_relative(""), None);
    }

    #[test]
    fn engine_version_accepts_major_minor_and_nothing_else() {
        assert!(is_engine_version("5.7"));
        assert!(is_engine_version("4.27"));
        assert!(!is_engine_version("5"));
        assert!(!is_engine_version("5.7.1"));
        assert!(!is_engine_version("5.7EA"));
        assert!(!is_engine_version("MyBuild"));
        assert!(!is_engine_version(""));
    }

    #[test]
    fn finds_a_version_in_a_path_segment() {
        assert_eq!(ue_version_in("UE_5.7"), Some("5.7".into()));
        assert_eq!(ue_version_in("UE5.7"), Some("5.7".into()));
        assert_eq!(ue_version_in("ue-5.7"), Some("5.7".into()));
        assert_eq!(ue_version_in("5.7"), Some("5.7".into()));
        assert_eq!(ue_version_in("DazToUnreal 5.6"), Some("5.6".into()));
        assert_eq!(ue_version_in("Bridge_5.6.1"), Some("5.6".into()));
        // A UE-prefixed hit beats a bare one, wherever each sits.
        assert_eq!(ue_version_in("Plugin2.0_UE5.7"), Some("5.7".into()));
        assert_eq!(ue_version_in("MyPlugins_UE5.6"), Some("5.6".into()));
        // Digits glued to a word are a name, not a version…
        assert_eq!(ue_version_in("Plugin2.0"), None);
        // …and a generation without a minor is not a build target.
        assert_eq!(ue_version_in("UE5"), None);
        assert_eq!(ue_version_in("UE_5"), None);
        assert_eq!(ue_version_in("DazToUnreal"), None);
        assert_eq!(ue_version_in(""), None);
    }

    #[test]
    fn deepest_path_segment_wins() {
        let p = Path::new("D:/Tools UE5.6/DazToUnrealBridge/UE_5.7/Plugins/DazToUnreal");
        assert_eq!(version_from_components(p), Some("5.7".into()));
        assert_eq!(version_from_components(Path::new("D:/plain/plugins/X")), None);
    }

    #[test]
    fn uplugin_engine_version_normalizes_to_major_minor() {
        assert_eq!(
            engine_version_from_uplugin_json(r#"{ "EngineVersion": "5.7.0" }"#),
            Some("5.7".into())
        );
        assert_eq!(engine_version_from_uplugin_json(r#"{ "FriendlyName": "X" }"#), None);
        assert_eq!(engine_version_from_uplugin_json("not json"), None);
        assert_eq!(engine_version_from_uplugin_json(r#"{ "EngineVersion": "next" }"#), None);
    }

    /// One scan over all three documented source-folder shapes.
    #[test]
    fn scans_the_three_source_folder_shapes() {
        let root = unique_temp_dir("unreal_scan");
        // Shape 1: the folder IS a plugin (version in its name).
        let direct = root.join("SuperTool_5.6");
        fs::create_dir_all(&direct).unwrap();
        fs::write(direct.join("SuperTool.uplugin"), "{}").unwrap();
        // Shape 2: a folder of plugins; version only in the .uplugin manifest.
        let pool = root.join("pool");
        fs::create_dir_all(pool.join("Alpha")).unwrap();
        fs::write(
            pool.join("Alpha").join("Alpha.uplugin"),
            r#"{ "EngineVersion": "5.7.0" }"#,
        )
        .unwrap();
        // …and one with no version signal at all → any-engine.
        fs::create_dir_all(pool.join("Beta")).unwrap();
        fs::write(pool.join("Beta").join("Beta.uplugin"), "{}").unwrap();
        // Shape 3: a multi-build root (version dir → Plugins → plugin).
        let bridge = root.join("Bridge");
        let build = bridge.join("UE_5.7").join("Plugins").join("DazToUnreal");
        fs::create_dir_all(&build).unwrap();
        fs::write(build.join("DazToUnreal.uplugin"), "{}").unwrap();

        let folders = vec![
            direct.to_string_lossy().into_owned(),
            pool.to_string_lossy().into_owned(),
            bridge.to_string_lossy().into_owned(),
        ];
        let found = scan_unreal_plugins(folders);
        let brief: Vec<(String, String)> =
            found.iter().map(|p| (p.name.clone(), p.engine_version.clone())).collect();
        assert_eq!(
            brief,
            vec![
                ("Alpha".to_string(), "5.7".to_string()),
                ("Beta".to_string(), String::new()),
                ("DazToUnreal".to_string(), "5.7".to_string()),
                ("SuperTool".to_string(), "5.6".to_string()),
            ]
        );
        // The multi-build entry's path is the plugin folder itself…
        let daz = found.iter().find(|p| p.name == "DazToUnreal").unwrap();
        assert_eq!(daz.path, build.to_string_lossy());
        // …and every entry remembers which configured folder it came from.
        assert_eq!(daz.source_folder, bridge.to_string_lossy());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn project_state_reports_association_content_and_plugins() {
        let root = unique_temp_dir("unreal_state");
        let project = root.join("Game");
        fs::create_dir_all(project.join("Content").join("DazToHue")).unwrap();
        fs::create_dir_all(project.join("Plugins").join("DazToUnreal")).unwrap();
        let uproject = project.join("Game.uproject");
        fs::write(&uproject, r#"{ "FileVersion": 3, "EngineAssociation": "5.7" }"#).unwrap();

        let state = unreal_project_state(uproject.to_string_lossy().into_owned()).unwrap();
        assert_eq!(
            state,
            UnrealProjectState {
                engine_association: "5.7".into(),
                dth_present: true,
                installed_plugins: vec!["DazToUnreal".into()],
            }
        );
        // A bare project: no association, nothing installed — still not an error.
        let bare = root.join("Bare");
        fs::create_dir_all(&bare).unwrap();
        let bare_up = bare.join("Bare.uproject");
        fs::write(&bare_up, "{}").unwrap();
        let state = unreal_project_state(bare_up.to_string_lossy().into_owned()).unwrap();
        assert_eq!(state.engine_association, "");
        assert!(!state.dth_present);
        assert!(state.installed_plugins.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_install_copies_under_the_uplugin_name_and_respects_overwrite() {
        let root = unique_temp_dir("unreal_plugin_install");
        // Source folder name carries a version suffix; the DEST must not.
        let src = root.join("DazToUnreal_5.7");
        fs::create_dir_all(src.join("Source")).unwrap();
        fs::write(src.join("DazToUnreal.uplugin"), "{}").unwrap();
        fs::write(src.join("Source").join("a.cpp"), "x").unwrap();
        let project = root.join("Game");
        fs::create_dir_all(&project).unwrap();
        let uproject = project.join("Game.uproject");
        fs::write(&uproject, "{}").unwrap();

        let request = |overwrite| UnrealPluginInstallRequest {
            plugin_path: src.to_string_lossy().into_owned(),
            uproject_path: uproject.to_string_lossy().into_owned(),
            overwrite,
        };
        let files = install_unreal_plugin(request(false)).unwrap();
        assert_eq!(files, 2);
        assert!(project.join("Plugins").join("DazToUnreal").join("DazToUnreal.uplugin").is_file());
        assert!(project.join("Plugins").join("DazToUnreal").join("Source").join("a.cpp").is_file());
        // Present + overwrite off → refused, with the 'already exists' phrasing
        // the rest of the app uses for this situation.
        let err = install_unreal_plugin(request(false)).unwrap_err();
        assert!(err.contains("already exists"), "err: {err}");
        // Overwrite on → copies over (never deletes first).
        assert_eq!(install_unreal_plugin(request(true)).unwrap(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_install_refuses_a_folder_without_a_uplugin() {
        let root = unique_temp_dir("unreal_plugin_bad");
        let src = root.join("NotAPlugin");
        fs::create_dir_all(&src).unwrap();
        let project = root.join("Game");
        fs::create_dir_all(&project).unwrap();
        let uproject = project.join("Game.uproject");
        fs::write(&uproject, "{}").unwrap();
        let err = install_unreal_plugin(UnrealPluginInstallRequest {
            plugin_path: src.to_string_lossy().into_owned(),
            uproject_path: uproject.to_string_lossy().into_owned(),
            overwrite: false,
        })
        .unwrap_err();
        assert!(err.contains(".uplugin"), "err: {err}");
        let _ = fs::remove_dir_all(&root);
    }

    /// What this machine's registry actually holds. IGNORED by default: the
    /// answer is whatever Unreal is installed here, so it can only ever be a
    /// probe, never an assertion CI could share.
    #[test]
    #[ignore = "machine-dependent: prints this machine's Unreal Engine installs"]
    fn unreal_engine_installs_here() {
        for install in unreal_engine_installs() {
            println!("{} -> {}", install.version, install.path);
        }
    }
}
