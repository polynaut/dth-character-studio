use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

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
    /// "ok" | "skipped" | "error" | "header".
    status: String,
    detail: String,
    /// Per-asset detail: the (capped) list of files an install would copy.
    files_list: Vec<String>,
    /// A hint shown beside the row — set when this asset writes the same library
    /// files as another in the report (e.g. a folder and its `.zip`). Empty otherwise.
    note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallReport {
    dry_run: bool,
    steps: Vec<InstallStep>,
    total_files: u64,
}

fn step_ok(label: &str, files: u64, detail: String) -> InstallStep {
    InstallStep { label: label.into(), files, status: "ok".into(), detail, files_list: Vec::new(), note: String::new() }
}
fn step_skip(label: &str, reason: String) -> InstallStep {
    InstallStep { label: label.into(), files: 0, status: "skipped".into(), detail: reason, files_list: Vec::new(), note: String::new() }
}
fn step_err(label: &str, msg: String) -> InstallStep {
    InstallStep { label: label.into(), files: 0, status: "error".into(), detail: msg, files_list: Vec::new(), note: String::new() }
}
/// A group header row (a source folder) — rendered as a heading, not a step.
fn step_header(label: &str) -> InstallStep {
    InstallStep { label: label.into(), files: 0, status: "header".into(), detail: String::new(), files_list: Vec::new(), note: String::new() }
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

/// Striped locks keyed by destination path: assets install in parallel, and two
/// that map to the SAME library file (e.g. a folder and its `.zip`) must not write
/// it at once. Same path → same stripe → serialized; different paths almost always
/// take different stripes → still parallel. 64 stripes comfortably covers the pool.
const DEST_LOCK_STRIPES: usize = 64;
fn lock_dest(path: &Path) -> MutexGuard<'static, ()> {
    static LOCKS: OnceLock<Vec<Mutex<()>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| (0..DEST_LOCK_STRIPES).map(|_| Mutex::new(())).collect());
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    let idx = (h.finish() as usize) % DEST_LOCK_STRIPES;
    // Recover from a poisoned lock — the guarded data is `()`, so there's nothing
    // to corrupt; a peer thread panicking shouldn't wedge the rest of the install.
    locks[idx].lock().unwrap_or_else(|e| e.into_inner())
}

/// Fold one destination-relative path into an order-independent fingerprint of an
/// asset's destination file set (XOR of per-path hashes). Two assets that install
/// the same set of files share a fingerprint even if a few files' contents differ.
fn fp_add(fp: &mut u64, rel: &str) {
    let mut h = DefaultHasher::new();
    rel.hash(&mut h);
    *fp ^= h.finish();
}

/// Copy `src` → `dst` file-by-file, copying each only when the destination is
/// missing or a *different size* (or always, with `force`). `dry` counts what
/// would copy without writing. Pushes each changed file's path (relative to
/// `rel`) into `out`, and returns the total file count — so "already installed"
/// is simply "`out` empty", read from the real filesystem rather than a fragile
/// single-file marker, and `out` powers the expandable per-asset list.
fn sync_dir(
    src: &Path,
    dst: &Path,
    dry: bool,
    force: bool,
    rel: &Path,
    out: &mut Vec<String>,
    fp: &mut u64,
    accepted: &HashSet<String>,
) -> std::io::Result<u64> {
    if !dry {
        fs::create_dir_all(dst)?;
    }
    // Enumerate the destination directory ONCE into a name→size map rather than
    // an individual `fs::metadata` syscall per source file — the slow part on
    // large/networked libraries. A missing dest dir yields an empty map, so every
    // source file is (correctly) seen as needing a copy.
    let dst_sizes = dir_file_sizes(dst);
    let mut total = 0u64;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let from = entry.path();
        let to = dst.join(&name);
        let rel_child = rel.join(&name);
        if from.is_dir() {
            total += sync_dir(&from, &to, dry, force, &rel_child, out, fp, accepted)?;
        } else {
            total += 1;
            let rel_str = rel_child.to_string_lossy().replace('\\', "/");
            fp_add(fp, &rel_str);
            let src_len = entry.metadata().map(|m| m.len()).unwrap_or(0);
            // An accepted (legitimately-shared) file is treated as already in sync.
            let needs = !accepted.contains(&rel_str)
                && (force
                    || match dst_sizes.get(&name) {
                        Some(&len) => len != src_len,
                        None => true,
                    });
            if needs {
                out.push(rel_str);
                if !dry {
                    // Serialize writes to the same library file across assets.
                    let _guard = lock_dest(&to);
                    fs::copy(&from, &to)?;
                }
            }
        }
    }
    Ok(total)
}

/// Enumerate a directory once into a map of file name → byte size (files only).
/// Empty when the directory is missing or unreadable.
fn dir_file_sizes(dir: &Path) -> HashMap<OsString, u64> {
    let mut map = HashMap::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(md) = entry.metadata() {
                if md.is_file() {
                    map.insert(entry.file_name(), md.len());
                }
            }
        }
    }
    map
}

/// Join a `/`-separated relative path onto `base`, component by component (so the
/// separator is normalized to the OS one rather than relying on `/` passthrough).
fn join_rel(base: &Path, rel: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    for c in rel.split('/').filter(|s| !s.is_empty()) {
        p.push(c);
    }
    p
}

/// A small cache of destination directory listings (file name → size), so many
/// scattered lookups (e.g. zip entries) read each dest directory only once.
struct DestSizes {
    cache: HashMap<PathBuf, HashMap<OsString, u64>>,
}
impl DestSizes {
    fn new() -> Self {
        Self { cache: HashMap::new() }
    }
    /// The installed size of `file` at the destination, or None if it isn't there.
    fn len_of(&mut self, file: &Path) -> Option<u64> {
        let dir = file.parent()?;
        let name = file.file_name()?;
        let map = self.cache.entry(dir.to_path_buf()).or_insert_with(|| dir_file_sizes(dir));
        map.get(name).copied()
    }
}

/// Find the directory *inside a zip* (within 5 levels) that holds Daz content
/// folders, plus the folder names — the archive equivalent of `find_content_level`,
/// computed purely from the central-directory entry paths (no extraction).
fn find_zip_content_level(paths: &[&str]) -> Option<(String, Vec<String>)> {
    // Map each directory in the archive to its immediate child directory names.
    let mut children: HashMap<String, BTreeSet<String>> = HashMap::new();
    for p in paths {
        let comps: Vec<&str> = p.split('/').filter(|c| !c.is_empty()).collect();
        // The last component is the file name; the rest are directories.
        for i in 0..comps.len().saturating_sub(1) {
            let parent = comps[..i].join("/");
            children.entry(parent).or_default().insert(comps[i].to_string());
        }
    }
    fn folders_in(dir: &str, children: &HashMap<String, BTreeSet<String>>) -> Vec<String> {
        let kids = match children.get(dir) {
            Some(k) => k,
            None => return Vec::new(),
        };
        let real: Vec<String> =
            CONTENT_FOLDERS.iter().filter(|f| kids.contains(**f)).map(|f| (*f).to_string()).collect();
        if !real.is_empty() {
            return real;
        }
        META_FOLDERS.iter().filter(|f| kids.contains(**f)).map(|f| (*f).to_string()).collect()
    }
    fn rec(
        dir: String,
        depth: u32,
        children: &HashMap<String, BTreeSet<String>>,
    ) -> Option<(String, Vec<String>)> {
        let here = folders_in(&dir, children);
        if !here.is_empty() {
            return Some((dir, here));
        }
        if depth == 0 {
            return None;
        }
        if let Some(kids) = children.get(&dir) {
            for k in kids {
                let sub = if dir.is_empty() { k.clone() } else { format!("{dir}/{k}") };
                if let Some(found) = rec(sub, depth - 1, children) {
                    return Some(found);
                }
            }
        }
        None
    }
    rec(String::new(), 5, &children)
}

/// Format the final step for an asset once its diff is known.
fn finish_step(name: &str, diff_files: Vec<String>, total: u64, dry: bool) -> InstallStep {
    if diff_files.is_empty() {
        return step_skip(name, format!("already installed · {total} files"));
    }
    let verb = if dry { "to copy" } else { "copied" };
    let diff = diff_files.len() as u64;
    let mut s = step_ok(name, diff, format!("{diff}/{total} files {verb}"));
    s.files_list = diff_files.into_iter().take(200).collect();
    s
}

/// An asset's report step plus the fingerprint of its destination file set (None
/// when it resolved to no content / errored) — the fingerprint powers the
/// "same files as …" duplicate hint.
type AssetStep = (InstallStep, Option<u64>);

/// Diff (and, unless `dry`, install) one asset *folder* against the library.
fn process_folder_asset(
    asset: &Path,
    name: &str,
    dest: &Path,
    dry: bool,
    force: bool,
    accepted: &HashSet<String>,
) -> AssetStep {
    let (content_root, folders) = match find_content_level(asset, 5) {
        Some(found) => found,
        None => return (step_skip(name, "no Daz content".into()), None),
    };
    let mut diff_files: Vec<String> = Vec::new();
    let mut total = 0u64;
    let mut fp = 0u64;
    for f in &folders {
        match sync_dir(&content_root.join(f), &dest.join(f), dry, force, Path::new(f), &mut diff_files, &mut fp, accepted) {
            Ok(t) => total += t,
            Err(e) => return (step_err(name, io_detail(&format!("{} → {}", f, dest.join(f).display()), &e)), None),
        }
    }
    (finish_step(name, diff_files, total, dry), Some(fp))
}

/// Inflate one archive entry to `dest_path` (creating parent dirs as needed).
fn extract_zip_entry(
    archive: &mut zip::ZipArchive<fs::File>,
    idx: usize,
    dest_path: &Path,
) -> std::io::Result<()> {
    let mut entry = archive
        .by_index(idx)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Serialize writes to the same library file across assets (see lock_dest).
    let _guard = lock_dest(dest_path);
    let mut out = fs::File::create(dest_path)?;
    std::io::copy(&mut entry, &mut out)?;
    Ok(())
}

/// Diff (and, unless `dry`, install) one `.zip` asset — read straight from the
/// archive's central directory (uncompressed sizes), never extracting the whole
/// thing. For a real install only the entries that differ are inflated.
fn process_zip_asset(
    asset: &Path,
    name: &str,
    dest: &Path,
    dry: bool,
    force: bool,
    accepted: &HashSet<String>,
) -> AssetStep {
    let file = match fs::File::open(asset) {
        Ok(f) => f,
        Err(e) => return (step_err(name, io_detail("open zip", &e)), None),
    };
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return (step_err(name, format!("unzip failed: {e}")), None),
    };
    // Central-directory pass: each file entry's path + uncompressed size. Setting
    // up `by_index` reads only the local header — no decompression happens here.
    let mut entries: Vec<(usize, String, u64)> = Vec::new();
    for i in 0..archive.len() {
        let entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        // enclosed_name rejects absolute / `..` paths (zip-slip).
        let rel = match entry.enclosed_name() {
            Some(p) => p.to_string_lossy().replace('\\', "/"),
            None => continue,
        };
        entries.push((i, rel, entry.size()));
    }
    let paths: Vec<&str> = entries.iter().map(|(_, p, _)| p.as_str()).collect();
    let (root, folders) = match find_zip_content_level(&paths) {
        Some(found) => found,
        None => return (step_skip(name, "no Daz content".into()), None),
    };
    let prefix = if root.is_empty() { String::new() } else { format!("{root}/") };
    let mut dest_sizes = DestSizes::new();
    let mut diff_files: Vec<String> = Vec::new();
    let mut needed: Vec<(usize, String)> = Vec::new();
    let mut total = 0u64;
    let mut fp = 0u64;
    for (idx, path, size) in &entries {
        // Keep only entries under <content-root>/<one of the chosen folders>.
        let sub = match path.strip_prefix(&prefix) {
            Some(s) => s,
            None => continue,
        };
        let first = sub.split('/').next().unwrap_or("");
        if !folders.iter().any(|f| f == first) {
            continue;
        }
        total += 1;
        fp_add(&mut fp, sub);
        let needs = !accepted.contains(sub)
            && (force || dest_sizes.len_of(&join_rel(dest, sub)) != Some(*size));
        if needs {
            diff_files.push(sub.to_string());
            needed.push((*idx, sub.to_string()));
        }
    }
    // Inflate only the differing entries on a real install.
    if !dry {
        for (idx, sub) in &needed {
            if let Err(e) = extract_zip_entry(&mut archive, *idx, &join_rel(dest, sub)) {
                return (step_err(name, io_detail(&format!("extract {sub}"), &e)), None);
            }
        }
    }
    (finish_step(name, diff_files, total, dry), Some(fp))
}

/// Diff/install one asset (folder or `.zip`). Loose files at the source root
/// (`.DS_Store`, readmes) aren't assets — they return None and are skipped.
fn process_asset(
    asset: &Path,
    dest: &Path,
    dry: bool,
    force: bool,
    skip_map: &HashMap<PathBuf, HashSet<String>>,
) -> Option<AssetStep> {
    let is_zip = asset.extension().map_or(false, |e| e.eq_ignore_ascii_case("zip"));
    if !asset.is_dir() && !is_zip {
        return None;
    }
    let name = folder_name(asset);
    // Files to leave alone: accepted ∪ the ones this asset loses to a newer-genesis
    // / bigger copy (per winner_skip_map). Empty if this asset wasn't resolved.
    let empty = HashSet::new();
    let skip = skip_map.get(asset).unwrap_or(&empty);
    Some(if is_zip {
        process_zip_asset(asset, &name, dest, dry, force, skip)
    } else {
        process_folder_asset(asset, &name, dest, dry, force, skip)
    })
}

/// Set the duplicate hint on any assets that share a destination fingerprint —
/// two copies of the same content (e.g. a folder and its `.zip`) that would write
/// the same library files. Returns the steps with notes applied, fingerprints dropped.
fn annotate_duplicates(mut items: Vec<AssetStep>) -> Vec<InstallStep> {
    let mut groups: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, (_, fp)) in items.iter().enumerate() {
        if let Some(fp) = fp {
            groups.entry(*fp).or_default().push(i);
        }
    }
    for idxs in groups.values() {
        if idxs.len() < 2 {
            continue;
        }
        let names: Vec<String> = idxs.iter().map(|&i| items[i].0.label.clone()).collect();
        for (pos, &i) in idxs.iter().enumerate() {
            let others: Vec<&str> =
                names.iter().enumerate().filter(|(j, _)| *j != pos).map(|(_, n)| n.as_str()).collect();
            items[i].0.note = if others.len() == 1 {
                format!("same files as “{}”", others[0])
            } else {
                format!("same files as {} other copies", others.len())
            };
        }
    }
    items.into_iter().map(|(s, _)| s).collect()
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
    /// When non-empty, install only the assets whose name is listed — the set a
    /// prior dry-run/scan flagged as changed — so the many already-installed
    /// assets aren't walked again. Empty installs every asset (a full pass).
    #[serde(default)]
    only: Vec<String>,
    /// Dest-relative paths the user accepted as legitimately shared — never
    /// counted as "to copy" nor copied (left as whatever is installed).
    #[serde(default)]
    accepted: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetScanRequest {
    sources: Vec<String>,
    dest: String,
    #[serde(default)]
    accepted: Vec<String>,
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

/// Resolve, across ALL source folders, the winner of every shared library file by
/// (newer Genesis, then bigger size), and return per-asset the set of dest-relative
/// paths to treat as already in-sync — `accepted` plus every file where this asset
/// is NOT the winner. The install then writes only the winning copy of a shared
/// file and never flags the losing copies, so the result is deterministic and
/// independent of folder order ("newer genesis wins, then bigger wins").
fn winner_skip_map(
    sources: &[String],
    accepted: &HashSet<String>,
) -> HashMap<PathBuf, HashSet<String>> {
    // Collect every asset's files, tagged with its source folder's Genesis rank.
    let mut all: Vec<(u32, AssetFiles)> = Vec::new();
    for source in sources {
        let src = Path::new(source);
        if !src.is_dir() {
            continue;
        }
        let genesis = genesis_rank(&folder_name(src));
        let entries: Vec<PathBuf> = match fs::read_dir(src) {
            Ok(e) => e.flatten().map(|x| x.path()).collect(),
            Err(_) => continue,
        };
        let collected: Vec<AssetFiles> =
            entries.par_iter().filter_map(|a| collect_asset_files(a)).collect();
        for af in collected {
            all.push((genesis, af));
        }
    }
    // Winner per dest path = the max (genesis, size) tuple across all copies.
    let mut winners: HashMap<String, (u32, u64)> = HashMap::new();
    for (g, af) in &all {
        for (rel, size) in &af.files {
            let cand = (*g, *size);
            winners.entry(rel.clone()).and_modify(|w| *w = (*w).max(cand)).or_insert(cand);
        }
    }
    // Per-asset skip set: accepted ∪ files where this asset isn't the winner.
    let mut skip_map: HashMap<PathBuf, HashSet<String>> = HashMap::new();
    for (g, af) in &all {
        let mut skip = accepted.clone();
        for (rel, size) in &af.files {
            if winners.get(rel).is_some_and(|&w| (*g, *size) != w) {
                skip.insert(rel.clone());
            }
        }
        skip_map.insert(af.asset_path.clone(), skip);
    }
    skip_map
}

/// Install your own Daz assets (G3/G8/G9, `.zip`s extracted) from the source
/// folders into the library — content-folder-aware, overwriting per asset, and
/// skipping ones that already appear installed unless `force`. Shared files are
/// resolved by `winner_skip_map` (newer genesis, then bigger), so only the winning
/// copy is installed and the losers are never flagged.
#[tauri::command]
fn install_daz_assets(request: DazAssetsRequest) -> InstallReport {
    let dry = request.dry_run;
    let force = request.force;
    let dest = Path::new(&request.dest);
    let only = request.only;
    let accepted: HashSet<String> = request.accepted.into_iter().collect();
    let skip_map = winner_skip_map(&request.sources, &accepted);
    let mut items: Vec<AssetStep> = Vec::new();
    for source in &request.sources {
        match collect_assets(source) {
            Err(step) => {
                items.push((step_header(source), None));
                items.push((step, None));
            }
            Ok(assets) => {
                let asset_items = process_assets(&assets, dest, dry, force, &only, &skip_map);
                // When filtering to a changed-asset set, skip a header whose whole
                // source contributed nothing (every asset already installed).
                if !asset_items.is_empty() {
                    items.push((step_header(source), None));
                    items.extend(asset_items);
                }
            }
        }
    }
    let steps = annotate_duplicates(items);
    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}

/// Read a source folder's immediate children, sorted. On failure returns a single
/// step (folder-missing skip or read error) for the caller to surface.
fn collect_assets(source: &str) -> Result<Vec<PathBuf>, InstallStep> {
    let src = Path::new(source);
    if !src.is_dir() {
        return Err(step_skip(&folder_name(src), format!("folder not found ({})", src.display())));
    }
    match fs::read_dir(src) {
        Ok(e) => {
            let mut assets: Vec<PathBuf> = e.flatten().map(|x| x.path()).collect();
            assets.sort();
            Ok(assets)
        }
        Err(e) => Err(step_err(&folder_name(src), io_detail("read", &e))),
    }
}

/// Process a source folder's assets in parallel — each is independent (I/O-bound
/// folder walks / zip reads), and `collect` preserves order so they stay sorted
/// under their header. Loose files are filtered out (process_asset returns None).
/// When `only` is non-empty, only assets whose name is listed are processed (the
/// changed-asset set from a prior dry-run — matched by name; a name shared across
/// two sources installs in both, which is harmless: the other is already in sync).
fn process_assets(
    assets: &[PathBuf],
    dest: &Path,
    dry: bool,
    force: bool,
    only: &[String],
    skip_map: &HashMap<PathBuf, HashSet<String>>,
) -> Vec<AssetStep> {
    assets
        .par_iter()
        .filter(|asset| only.is_empty() || only.iter().any(|n| *n == folder_name(asset)))
        .filter_map(|asset| process_asset(asset, dest, dry, force, skip_map))
        .collect()
}

/// Read-only scan: what content each asset holds and whether it's already in the library.
#[tauri::command]
fn list_daz_assets(request: AssetScanRequest) -> InstallReport {
    let dest = Path::new(&request.dest);
    let accepted: HashSet<String> = request.accepted.into_iter().collect();
    let skip_map = winner_skip_map(&request.sources, &accepted);
    let mut items: Vec<AssetStep> = Vec::new();
    for source in &request.sources {
        items.push((step_header(source), None));
        match collect_assets(source) {
            Err(step) => items.push((step, None)),
            Ok(assets) => items.extend(process_assets(&assets, dest, true, false, &[], &skip_map)),
        }
    }
    let steps = annotate_duplicates(items);
    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: true, steps, total_files }
}

// --- "Dedup" action: resolve duplicate assets + conflicting shared files ------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DedupRequest {
    sources: Vec<String>,
    dry_run: bool,
    /// Dest-relative paths the user accepted as legitimately shared — hidden from
    /// the conflict list (and left untouched on apply).
    #[serde(default)]
    accepted: Vec<String>,
    /// Asset labels the user explicitly chose to keep in their duplicate group
    /// (overriding the auto-pick). The rest of that group is quarantined.
    #[serde(default)]
    keepers: Vec<String>,
    /// Folder the redundant duplicate copies are moved into. Required to apply —
    /// nothing is moved when empty.
    #[serde(default)]
    quarantine: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConflictCopy {
    label: String,
    /// The source folder this copy lives in (e.g. "_genesis 9").
    source: String,
    size: u64,
    in_zip: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileConflict {
    rel: String,
    copies: Vec<ConflictCopy>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DupMember {
    label: String,
    /// The source folder this copy lives in (e.g. "_genesis 9").
    source: String,
    file_count: u64,
    is_zip: bool,
    /// The copy kept (others are quarantined). The default is auto-picked but the
    /// user can override it via the request's `keepers`.
    is_keeper: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetDup {
    members: Vec<DupMember>,
    /// "exact" (identical files) or "version" (same product, different version —
    /// high file overlap with differing sizes, e.g. a `…UD` vs `…UPDATE`).
    kind: String,
    /// Set after apply: the redundant copies were quarantined.
    fixed: bool,
}

fn uf_find(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}
fn uf_union(parent: &mut [usize], a: usize, b: usize) {
    let (ra, rb) = (uf_find(parent, a), uf_find(parent, b));
    if ra != rb {
        parent[ra] = rb;
    }
}

/// Move `src` to `dst`, falling back to copy-then-delete when a plain rename fails
/// (e.g. the quarantine folder is on a different drive). Returns success.
fn move_to_quarantine(src: &Path, dst: &Path) -> bool {
    if let Some(p) = dst.parent() {
        let _ = fs::create_dir_all(p);
    }
    if fs::rename(src, dst).is_ok() {
        return true;
    }
    let copied = if src.is_dir() {
        copy_dir(src, dst).is_ok()
    } else {
        fs::copy(src, dst).is_ok()
    };
    if !copied {
        return false;
    }
    if src.is_dir() {
        fs::remove_dir_all(src).is_ok()
    } else {
        fs::remove_file(src).is_ok()
    }
}

/// Rank a source folder by its Genesis number so newer wins (e.g. "_genesis 9" →
/// 9, "_genesis 8" → 8). The last run of digits; 0 when none is found.
fn genesis_rank(source_root: &str) -> u32 {
    let mut best = 0u32;
    let mut cur = String::new();
    for ch in source_root.chars() {
        if ch.is_ascii_digit() {
            cur.push(ch);
        } else {
            if let Ok(v) = cur.parse() {
                best = v;
            }
            cur.clear();
        }
    }
    if let Ok(v) = cur.parse() {
        best = v;
    }
    best
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DedupReport {
    dry_run: bool,
    conflicts: Vec<FileConflict>,
    duplicates: Vec<AssetDup>,
    assets_quarantined: u64,
    backup_dir: String,
}

/// One asset's content files, plus what's needed to quarantine it.
struct AssetFiles {
    label: String,
    /// The source folder this asset lives in (e.g. "_genesis 9"). Set by the caller.
    source_root: String,
    is_zip: bool,
    /// The top-level entry (folder or `.zip`) — moved on quarantine.
    asset_path: PathBuf,
    files: Vec<(String, u64)>,
}

fn collect_folder_files(dir: &Path, rel: &Path, out: &mut Vec<(String, u64)>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            let rc = rel.join(e.file_name());
            if p.is_dir() {
                collect_folder_files(&p, &rc, out);
            } else if let Ok(md) = e.metadata() {
                out.push((rc.to_string_lossy().replace('\\', "/"), md.len()));
            }
        }
    }
}

/// Resolve an asset to its full content-file list (rel path → size). None for
/// loose files / assets with no Daz content.
fn collect_asset_files(asset: &Path) -> Option<AssetFiles> {
    let is_zip = asset.extension().map_or(false, |e| e.eq_ignore_ascii_case("zip"));
    if !asset.is_dir() && !is_zip {
        return None;
    }
    let label = folder_name(asset);
    if is_zip {
        let file = fs::File::open(asset).ok()?;
        let mut archive = zip::ZipArchive::new(file).ok()?;
        let mut entries: Vec<(String, u64)> = Vec::new();
        for i in 0..archive.len() {
            let e = match archive.by_index(i) {
                Ok(e) => e,
                Err(_) => continue,
            };
            if e.is_dir() {
                continue;
            }
            let rel = match e.enclosed_name() {
                Some(p) => p.to_string_lossy().replace('\\', "/"),
                None => continue,
            };
            entries.push((rel, e.size()));
        }
        let paths: Vec<&str> = entries.iter().map(|(p, _)| p.as_str()).collect();
        let (root, folders) = find_zip_content_level(&paths)?;
        let prefix = if root.is_empty() { String::new() } else { format!("{root}/") };
        let mut files = Vec::new();
        for (p, sz) in &entries {
            if let Some(sub) = p.strip_prefix(&prefix) {
                if folders.iter().any(|f| f == sub.split('/').next().unwrap_or("")) {
                    files.push((sub.to_string(), *sz));
                }
            }
        }
        Some(AssetFiles {
            label,
            source_root: String::new(),
            is_zip: true,
            asset_path: asset.to_path_buf(),
            files,
        })
    } else {
        let (content_root, folders) = find_content_level(asset, 5)?;
        let mut files = Vec::new();
        for f in &folders {
            collect_folder_files(&content_root.join(f), Path::new(f), &mut files);
        }
        Some(AssetFiles {
            label,
            source_root: String::new(),
            is_zip: false,
            asset_path: asset.to_path_buf(),
            files,
        })
    }
}

/// Find duplicate assets + conflicting shared files across the source folders, and
/// (unless `dry_run`) QUARANTINE the redundant copies of each duplicate/version
/// group — keeping the chosen/auto keeper, moving the rest under
/// `<sources' parent>/_dth_dedup_backup/quarantine` (reversible). Shared-file
/// conflicts are reported only — never rewritten (that would mutate an author's
/// downloaded asset); they're resolved by Accept.
#[tauri::command]
fn dedup_daz_assets(request: DedupRequest) -> DedupReport {
    let dry = request.dry_run;
    let accepted: HashSet<String> = request.accepted.into_iter().collect();
    let chosen_keepers: HashSet<String> = request.keepers.into_iter().collect();
    // Where redundant copies are moved. Empty (e.g. on a dry run) → nothing moves.
    let quarantine = request.quarantine.clone();

    // Gather every asset's content files (independent reads → parallel).
    let mut assets: Vec<AssetFiles> = Vec::new();
    for source in &request.sources {
        let src = Path::new(source);
        if !src.is_dir() {
            continue;
        }
        let mut entries: Vec<PathBuf> = match fs::read_dir(src) {
            Ok(e) => e.flatten().map(|x| x.path()).collect(),
            Err(_) => continue,
        };
        entries.sort();
        let root_label = folder_name(src);
        let mut found: Vec<AssetFiles> =
            entries.par_iter().filter_map(|a| collect_asset_files(a)).collect();
        for af in &mut found {
            af.source_root = root_label.clone();
        }
        assets.append(&mut found);
    }

    let n = assets.len();
    let filecount: Vec<usize> = assets.iter().map(|a| a.files.len()).collect();
    let totalbytes: Vec<u64> = assets.iter().map(|a| a.files.iter().map(|(_, s)| *s).sum()).collect();

    // path → which assets ship it.
    let mut byrel: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, af) in assets.iter().enumerate() {
        for (rel, _sz) in &af.files {
            byrel.entry(rel.clone()).or_default().push(i);
        }
    }
    // Fingerprint each asset by its path set (exact-duplicate detection).
    let mut fp_of: Vec<u64> = vec![0; n];
    for (i, af) in assets.iter().enumerate() {
        let mut fp = 0u64;
        for (rel, _s) in &af.files {
            fp_add(&mut fp, rel);
        }
        fp_of[i] = fp;
    }

    // Group assets that are the same content: exact (identical path set) OR a
    // near-duplicate version pair (they share ≥60% of *each other's* files — same
    // product, different version — e.g. a "…UD" and a "…UPDATE"). This collapses
    // a version pair's 80+ differing files into one asset-level decision instead
    // of one conflict row each.
    let mut parent: Vec<usize> = (0..n).collect();
    let mut first_fp: HashMap<u64, usize> = HashMap::new();
    for i in 0..n {
        if assets[i].files.is_empty() {
            continue;
        }
        match first_fp.get(&fp_of[i]) {
            Some(&j) => uf_union(&mut parent, i, j),
            None => {
                first_fp.insert(fp_of[i], i);
            }
        }
    }
    let mut shared_pairs: HashMap<(usize, usize), u32> = HashMap::new();
    for idxs in byrel.values() {
        // Files in a great many assets are common base files, not pairing signal.
        if idxs.len() < 2 || idxs.len() > 10 {
            continue;
        }
        for a in 0..idxs.len() {
            for b in (a + 1)..idxs.len() {
                let key = (idxs[a].min(idxs[b]), idxs[a].max(idxs[b]));
                *shared_pairs.entry(key).or_default() += 1;
            }
        }
    }
    for (&(i, j), &c) in &shared_pairs {
        let ri = c as f64 / filecount[i].max(1) as f64;
        let rj = c as f64 / filecount[j].max(1) as f64;
        if c >= 4 && ri >= 0.6 && rj >= 0.6 {
            uf_union(&mut parent, i, j);
        }
    }
    let mut groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        if !assets[i].files.is_empty() {
            let r = uf_find(&mut parent, i);
            groups.entry(r).or_default().push(i);
        }
    }
    // asset → its group root, only for assets in a 2+ group.
    let mut group_of: Vec<Option<usize>> = vec![None; n];
    for members in groups.values() {
        if members.len() >= 2 {
            let root = members[0];
            for &m in members {
                group_of[m] = Some(uf_find(&mut parent, root));
            }
        }
    }

    // --- conflicting shared files: same dest path, different sizes across assets.
    // Files entirely inside one duplicate/version group are skipped — the
    // asset-level quarantine below covers them.
    let mut conflicts: Vec<FileConflict> = Vec::new();
    for (rel, idxs) in &byrel {
        if idxs.len() < 2 {
            continue;
        }
        // The user accepted this file as legitimately shared — leave it be.
        if accepted.contains(rel) {
            continue;
        }
        let g0 = group_of[idxs[0]];
        if g0.is_some() && idxs.iter().all(|&i| group_of[i] == g0) {
            continue;
        }
        let sized: Vec<(usize, u64)> = idxs
            .iter()
            .map(|&i| {
                let s = assets[i].files.iter().find(|(r, _)| r == rel).map(|(_, s)| *s).unwrap_or(0);
                (i, s)
            })
            .collect();
        let distinct: std::collections::HashSet<u64> = sized.iter().map(|(_, s)| *s).collect();
        if distinct.len() < 2 {
            continue;
        }
        // Conflicts are informational only: shared files between different products
        // that differ. We NEVER rewrite them — that would mutate an author's
        // downloaded asset. The only resolution is Accept (leave as-is), which makes
        // the scan/install treat them as in-sync (whatever's installed wins, exactly
        // like installing both and overwriting).
        let copies = sized
            .iter()
            .map(|&(i, s)| ConflictCopy {
                label: assets[i].label.clone(),
                source: assets[i].source_root.clone(),
                size: s,
                in_zip: assets[i].is_zip,
            })
            .collect();
        conflicts.push(FileConflict { rel: rel.clone(), copies });
    }
    conflicts.sort_by(|a, b| a.rel.cmp(&b.rel));

    // --- duplicate / version asset groups: keep one, quarantine the rest ---
    let mut duplicates: Vec<AssetDup> = Vec::new();
    let mut assets_quarantined = 0u64;
    for members in groups.values() {
        if members.len() < 2 {
            continue;
        }
        // keeper: the user's explicit choice if any, else auto — newer Genesis
        // first, then bigger total bytes, then a folder over a zip, then shorter label.
        let auto = *members
            .iter()
            .max_by(|&&a, &&b| {
                genesis_rank(&assets[a].source_root)
                    .cmp(&genesis_rank(&assets[b].source_root))
                    .then(totalbytes[a].cmp(&totalbytes[b]))
                    .then((!assets[a].is_zip).cmp(&!assets[b].is_zip))
                    .then(assets[b].label.len().cmp(&assets[a].label.len()))
            })
            .unwrap();
        let keeper = members
            .iter()
            .copied()
            .find(|&i| chosen_keepers.contains(&assets[i].label))
            .unwrap_or(auto);
        let redundant: Vec<usize> = members.iter().cloned().filter(|&i| i != keeper).collect();
        let exact = members.iter().all(|&m| fp_of[m] == fp_of[keeper]);
        let mut fixed = false;
        if !dry && !quarantine.is_empty() {
            let qdir = Path::new(&quarantine);
            for &i in &redundant {
                let target = qdir.join(&assets[i].label);
                if !target.exists() && move_to_quarantine(&assets[i].asset_path, &target) {
                    assets_quarantined += 1;
                    fixed = true;
                }
            }
        }
        let mut sorted = members.clone();
        sorted.sort_by(|&a, &b| assets[a].label.cmp(&assets[b].label));
        duplicates.push(AssetDup {
            members: sorted
                .iter()
                .map(|&i| DupMember {
                    label: assets[i].label.clone(),
                    source: assets[i].source_root.clone(),
                    file_count: filecount[i] as u64,
                    is_zip: assets[i].is_zip,
                    is_keeper: i == keeper,
                })
                .collect(),
            kind: if exact { "exact".into() } else { "version".into() },
            fixed,
        });
    }
    duplicates.sort_by(|a, b| {
        let ka = a.members.iter().find(|m| m.is_keeper).map(|m| &m.label);
        let kb = b.members.iter().find(|m| m.is_keeper).map(|m| &m.label);
        ka.cmp(&kb)
    });

    DedupReport {
        dry_run: dry,
        conflicts,
        duplicates,
        assets_quarantined,
        backup_dir: quarantine,
    }
}

// --- "Danger zone": clean up leftover Daz folders after uninstalling Daz -----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UninstallDefaultsRequest {
    daz_lib_folder: String,
}

/// The default leftover-folder list (ported from the dth-cli `uninstall-daz`): the
/// library root (parent of "My DAZ 3D Library"), the common Documents / Public
/// library spots, and the APPDATA `DAZ 3D` + Start-Menu folders.
#[tauri::command]
fn default_daz_uninstall_folders(request: UninstallDefaultsRequest) -> Vec<String> {
    let mut folders: Vec<String> = Vec::new();
    let lib = request.daz_lib_folder.trim();
    if !lib.is_empty() {
        if let Some(parent) = Path::new(lib).parent() {
            folders.push(parent.display().to_string());
        }
    }
    folders.push("D:\\User Data\\Documents\\DAZ 3D".into());
    folders.push("E:\\User Data\\Documents\\DAZ 3D".into());
    folders.push("C:\\Users\\Public\\Documents\\My DAZ 3D Library".into());
    folders.push("C:\\Program Files\\DAZ 3D\\DAZStudio6".into());
    folders.push("C:\\Program Files\\DAZ 3D\\DAZStudio4".into());
    if let Ok(appdata) = std::env::var("APPDATA") {
        folders.push(format!("{appdata}\\DAZ 3D"));
        folders.push(format!("{appdata}\\Microsoft\\Windows\\Start Menu\\Programs\\DAZ 3D"));
    }
    // Prefill is a deliberate action the user runs while Daz is still installed, so a
    // folder that doesn't exist genuinely isn't a Daz location on this machine — drop it.
    folders.into_iter().filter(|f| Path::new(f).exists()).collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UninstallDazRequest {
    folders: Vec<String>,
    dry_run: bool,
}

/// Delete the listed leftover Daz folders (run after removing Daz Studio / DIM via
/// Add or Remove Programs). Recursive — these are whole folders. Each step reports
/// deleted / not found / error; `dry_run` only counts what would be removed.
#[tauri::command]
fn uninstall_daz(request: UninstallDazRequest) -> InstallReport {
    let dry = request.dry_run;
    let mut steps: Vec<InstallStep> = Vec::new();
    for folder in &request.folders {
        let trimmed = folder.trim();
        if trimmed.is_empty() {
            continue;
        }
        let p = Path::new(trimmed);
        if !p.exists() {
            steps.push(step_skip(trimmed, "not found".into()));
        } else if dry {
            steps.push(step_ok(trimmed, count_files(p), "would delete".into()));
        } else {
            match fs::remove_dir_all(p) {
                Ok(_) => steps.push(step_ok(trimmed, 0, "deleted".into())),
                Err(e) => steps.push(step_err(trimmed, io_detail("delete", &e))),
            }
        }
    }
    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
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

/// Recursively collect every `.duf` under `folder`, as paths relative to it
/// ('/'-separated). The frontend classifies these into pose assets on each open /
/// release change — there's no on-disk catalog to build or go stale. One native
/// walk replaces the old per-directory JS round-trips (much faster on a network
/// share). Unreadable subfolders (locked / permission / network) are skipped so
/// one bad directory can't fail the whole scan.
#[tauri::command]
fn scan_duf_files(folder: String) -> Vec<String> {
    let root = Path::new(&folder);
    let mut out = Vec::new();
    collect_duf(root, root, &mut out);
    out
}

fn collect_duf(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let path = entry.path();
        if file_type.is_dir() {
            collect_duf(root, &path, out);
        } else if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("duf")) {
            if let Ok(rel) = path.strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
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
            dedup_daz_assets,
            default_daz_uninstall_folders,
            uninstall_daz,
            install_daz_merge,
            install_houdini_presets,
            unc_for_path,
            ensure_network_drives,
            pose_asset_frames,
            scan_duf_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_content_level_at_root() {
        let paths = vec!["data/foo.dsf", "Runtime/Textures/x.png", "readme.txt"];
        let (root, mut folders) = find_zip_content_level(&paths).unwrap();
        folders.sort();
        assert_eq!(root, "");
        assert_eq!(folders, vec!["Runtime".to_string(), "data".to_string()]);
    }

    #[test]
    fn zip_content_level_nested() {
        let paths = vec![
            "My Asset/Documentation/read.pdf",
            "My Asset/data/people/g9/morph.dsf",
            "My Asset/People/Genesis 9/x.duf",
        ];
        let (root, mut folders) = find_zip_content_level(&paths).unwrap();
        folders.sort();
        assert_eq!(root, "My Asset");
        // Real content folders (data/People) win over the Documentation meta-folder.
        assert_eq!(folders, vec!["People".to_string(), "data".to_string()]);
    }

    #[test]
    fn zip_content_level_meta_only() {
        let paths = vec!["Pkg/Documentation/read.pdf", "Pkg/notes.txt"];
        let (root, folders) = find_zip_content_level(&paths).unwrap();
        assert_eq!(root, "Pkg");
        assert_eq!(folders, vec!["Documentation".to_string()]);
    }

    #[test]
    fn zip_content_level_none() {
        let paths = vec!["random/file.txt", "other.bin"];
        assert!(find_zip_content_level(&paths).is_none());
    }

    #[test]
    fn join_rel_uses_components() {
        let joined = join_rel(Path::new("base"), "data/foo/bar.dsf");
        assert_eq!(joined, Path::new("base").join("data").join("foo").join("bar.dsf"));
    }

    #[test]
    fn genesis_rank_reads_the_number() {
        assert_eq!(genesis_rank("_genesis 9"), 9);
        assert_eq!(genesis_rank("_genesis 8"), 8);
        assert_eq!(genesis_rank("_genesis 3"), 3);
        assert_eq!(genesis_rank("my daz assets"), 0); // no number → unranked
        assert!(genesis_rank("_genesis 9") > genesis_rank("_genesis 8"));
    }

    #[test]
    fn fingerprint_is_order_independent_and_set_based() {
        let (mut a, mut b) = (0u64, 0u64);
        fp_add(&mut a, "data/x");
        fp_add(&mut a, "People/y");
        fp_add(&mut b, "People/y");
        fp_add(&mut b, "data/x");
        assert_eq!(a, b, "order must not matter");
        let mut c = 0u64;
        fp_add(&mut c, "data/x");
        assert_ne!(a, c, "a different file set must differ");
    }

    #[test]
    fn annotate_flags_same_fingerprint() {
        // A folder and its .zip share a destination fingerprint (42); a third asset
        // is on its own (7).
        let items = vec![
            (step_header("src"), None),
            (step_skip("foo.zip", "already installed · 3 files".into()), Some(42)),
            (step_ok("foo", 1, "1/3 files to copy".into()), Some(42)),
            (step_skip("bar", "already installed · 9 files".into()), Some(7)),
        ];
        let steps = annotate_duplicates(items);
        let note = |label: &str| steps.iter().find(|s| s.label == label).unwrap().note.clone();
        assert!(note("foo.zip").contains("foo"), "zip points at the folder");
        assert!(note("foo").contains("foo.zip"), "folder points at the zip");
        assert_eq!(note("bar"), "", "a unique asset gets no hint");
    }
}
