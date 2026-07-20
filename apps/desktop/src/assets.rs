use rayon::prelude::*;
use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use crate::archive::{
    extract_nested_zip, extract_zip_entry, zip_file_entries, InflateBudget, NESTED_ZIP_DEPTH,
};
use crate::content::{find_content_level, zip_dir_level, CONTENT_FOLDERS, META_FOLDERS};
use crate::dedup::{collect_asset_files, genesis_rank, AssetFiles};
use crate::fsutil::{entry_is_real_dir, folder_name, join_rel, lock_dest};
use crate::report::{
    io_detail, step_err, step_header, step_ok, step_skip, InstallReport, InstallStep,
};

// --- "Optional" installs: your own Daz/Houdini content (not DTH release) ----

/// Fold one destination-relative path into an order-independent fingerprint of an
/// asset's destination file set (XOR of per-path hashes). Two assets that install
/// the same set of files share a fingerprint even if a few files' contents differ.
pub(crate) fn fp_add(fp: &mut u64, rel: &str) {
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
// 8 args: one cohesive recursive dir-sync (source/rel/out + counters/flags); a
// params struct would add indirection without making it clearer.
#[allow(clippy::too_many_arguments)]
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
        if entry_is_real_dir(&entry) {
            total += sync_dir(&from, &to, dry, force, &rel_child, out, fp, accepted)?;
        } else if from.is_dir() {
            // A directory symlink/junction (real dir above is symlink-free — the
            // fsutil walker rule): following it can loop forever on a cycle while
            // COPYING — filling the destination disk — or escape the asset tree.
            // Not the asset's own content; treat it as a leaf and skip it.
            continue;
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

/// Diff (and, unless `dry`, install) the content of one opened zip archive into
/// `dest`, accumulating the changed files / total / destination fingerprint so
/// nested package zips merge into their outer asset's step. Returns whether a Daz
/// content level was found in this archive or a nested one; `Err` carries a
/// step_err detail. `budget` is the top-level archive's inflate budget; nested
/// archives SHARE it, so one budget bounds the whole tree's inflation (a crafted
/// wrapper can't mint a fresh allowance per inner zip).
// 11 args: a recursive zip-diff threading scan state through each nested archive;
// splitting it would just scatter that state across a struct.
#[allow(clippy::too_many_arguments)]
fn diff_zip_archive(
    archive: &mut zip::ZipArchive<fs::File>,
    dest: &Path,
    dry: bool,
    force: bool,
    accepted: &HashSet<String>,
    depth: u32,
    dest_sizes: &mut DestSizes,
    diff_files: &mut Vec<String>,
    total: &mut u64,
    fp: &mut u64,
    budget: &mut InflateBudget,
) -> Result<bool, String> {
    let entries = zip_file_entries(archive);
    let paths: Vec<&str> = entries.iter().map(|(_, p, _)| p.as_str()).collect();
    // Same precedence as find_zip_content_level, with nested packages between the
    // two passes: content in this archive → content in nested zips → Documentation.
    let content = zip_dir_level(&paths, &CONTENT_FOLDERS);
    if content.is_none() && depth > 0 {
        let mut found = false;
        for (idx, path, _) in &entries {
            if !path.to_ascii_lowercase().ends_with(".zip") {
                continue;
            }
            let tmp = extract_nested_zip(archive, *idx, budget)
                .map_err(|e| io_detail(&format!("unpack {path}"), &e))?;
            let file =
                fs::File::open(&tmp.0).map_err(|e| io_detail(&format!("open {path}"), &e))?;
            let mut inner =
                zip::ZipArchive::new(file).map_err(|e| format!("unzip {path} failed: {e}"))?;
            // The inner archive shares the OUTER budget (see the fn doc).
            budget.check_entry_count(inner.len()).map_err(|e| e.to_string())?;
            found |= diff_zip_archive(
                &mut inner, dest, dry, force, accepted, depth - 1, dest_sizes, diff_files, total,
                fp, budget,
            )?;
        }
        if found {
            return Ok(true);
        }
    }
    let (root, folders) = match content.or_else(|| zip_dir_level(&paths, &META_FOLDERS)) {
        Some(level) => level,
        None => return Ok(false),
    };
    let prefix = if root.is_empty() { String::new() } else { format!("{root}/") };
    let mut needed: Vec<(usize, String)> = Vec::new();
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
        *total += 1;
        fp_add(fp, sub);
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
            if let Err(e) = extract_zip_entry(archive, *idx, &join_rel(dest, sub), budget) {
                return Err(io_detail(&format!("extract {sub}"), &e));
            }
        }
    }
    Ok(true)
}

/// Diff (and, unless `dry`, install) one `.zip` asset — read straight from the
/// archive's central directory (uncompressed sizes), never extracting the whole
/// thing. For a real install only the entries that differ are inflated. Wrapper
/// downloads (no content folders, a package zip inside) are descended into.
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
    let compressed_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(e) => return (step_err(name, format!("unzip failed: {e}")), None),
    };
    // Decompression-bomb rails: a ratio-based inflate budget + an entry-count cap.
    let mut budget = InflateBudget::new(name, compressed_len);
    if let Err(e) = budget.check_entry_count(archive.len()) {
        return (step_err(name, e.to_string()), None);
    }
    let mut dest_sizes = DestSizes::new();
    let mut diff_files: Vec<String> = Vec::new();
    let (mut total, mut fp) = (0u64, 0u64);
    match diff_zip_archive(
        &mut archive,
        dest,
        dry,
        force,
        accepted,
        NESTED_ZIP_DEPTH,
        &mut dest_sizes,
        &mut diff_files,
        &mut total,
        &mut fp,
        &mut budget,
    ) {
        Err(detail) => (step_err(name, detail), None),
        Ok(false) => (step_skip(name, "no Daz content".into()), None),
        Ok(true) => (finish_step(name, diff_files, total, dry), Some(fp)),
    }
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
    let is_zip = asset.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"));
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

// --- "Optional" tab installs ----------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DazAssetsRequest {
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
pub(crate) struct AssetScanRequest {
    sources: Vec<String>,
    dest: String,
    #[serde(default)]
    accepted: Vec<String>,
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
// `(async)` on this and every other I/O-heavy command: a sync command runs on the
// MAIN thread (see windows::open_project_window), so a multi-GB install / network
// walk would freeze every window's chrome and queue all other IPC behind it.
#[tauri::command(async)]
pub fn install_daz_assets(request: DazAssetsRequest) -> InstallReport {
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
// InstallStep is the shared install-report type threaded through the whole install
// pipeline; boxing it here alone wouldn't shrink the others, so keep it inline.
#[allow(clippy::result_large_err)]
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
#[tauri::command(async)]
pub fn list_daz_assets(request: AssetScanRequest) -> InstallReport {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{unique_temp_dir, write_wrapper_zip, write_zip, zip_bytes};

    #[test]
    fn zip_asset_descends_into_nested_package_zip() {
        let base = unique_temp_dir("nested_zip");
        fs::create_dir_all(&base).unwrap();
        let outer = base.join("67582_Meipe.zip");
        write_wrapper_zip(&outer);
        let dest = base.join("lib");

        // Dry run resolves the inner package's data/Runtime files (its
        // Documentation folder is metadata, like in a flat zip).
        let (step, fp) =
            process_zip_asset(&outer, "67582_Meipe.zip", &dest, true, false, &HashSet::new());
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        assert_eq!(step.files, 2);
        let mut list = step.files_list.clone();
        list.sort();
        assert_eq!(list, vec!["Runtime/Textures/t.png", "data/Meipe/morph.dsf"]);
        assert!(fp.is_some());

        // A real install inflates the nested entries into the library.
        let (step, _) =
            process_zip_asset(&outer, "67582_Meipe.zip", &dest, false, false, &HashSet::new());
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        assert_eq!(fs::read(join_rel(&dest, "data/Meipe/morph.dsf")).unwrap(), b"morph-data");
        assert!(join_rel(&dest, "Runtime/Textures/t.png").is_file());

        // A re-scan now reports the wrapper as already installed.
        let (step, _) =
            process_zip_asset(&outer, "67582_Meipe.zip", &dest, true, false, &HashSet::new());
        assert_eq!(step.status, "skipped");
        assert!(step.detail.contains("already installed"), "detail: {}", step.detail);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn zip_asset_nested_zip_without_content_is_skipped() {
        let base = unique_temp_dir("nested_zip_none");
        fs::create_dir_all(&base).unwrap();
        let inner = zip_bytes(&[("random/notes.txt", b"x".as_slice())]);
        let outer = base.join("wrapper.zip");
        write_zip(&outer, &[("inner.zip", inner.as_slice())]);

        let (step, fp) =
            process_zip_asset(&outer, "wrapper.zip", &base.join("lib"), true, false, &HashSet::new());
        assert_eq!(step.status, "skipped");
        assert_eq!(step.detail, "no Daz content");
        assert!(fp.is_none());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn zip_asset_with_own_content_ignores_nested_zips() {
        // A product that legitimately ships a .zip *inside* its content is not a
        // wrapper — the archive's own content level wins and the nested zip is
        // treated as a file to install, not descended into.
        let base = unique_temp_dir("nested_zip_own_content");
        fs::create_dir_all(&base).unwrap();
        let inner = zip_bytes(&[("Content/data/other.dsf", b"other".as_slice())]);
        let outer = base.join("asset.zip");
        write_zip(
            &outer,
            &[
                ("data/main.dsf", b"main".as_slice()),
                ("Runtime/extra.zip", inner.as_slice()),
            ],
        );

        let (step, _) =
            process_zip_asset(&outer, "asset.zip", &base.join("lib"), true, false, &HashSet::new());
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        let mut list = step.files_list.clone();
        list.sort();
        assert_eq!(list, vec!["Runtime/extra.zip", "data/main.dsf"]);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn nested_package_content_wins_over_outer_documentation() {
        // A wrapper that also carries a Documentation folder: the package's real
        // content must win over the shallower docs-only level (the zip-in-zip
        // equivalent of `zip_content_level_descends_past_top_level_documentation`).
        let base = unique_temp_dir("nested_zip_docs");
        fs::create_dir_all(&base).unwrap();
        let inner = zip_bytes(&[("Content/data/x.dsf", b"x".as_slice())]);
        let outer = base.join("wrapper.zip");
        write_zip(
            &outer,
            &[
                ("Documentation/read.pdf", b"pdf".as_slice()),
                ("pkg.zip", inner.as_slice()),
            ],
        );

        let (step, _) =
            process_zip_asset(&outer, "wrapper.zip", &base.join("lib"), true, false, &HashSet::new());
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        assert_eq!(step.files_list, vec!["data/x.dsf"]);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn nested_and_flat_zip_share_a_fingerprint() {
        // A wrapper download and a flat repack of the same product install the same
        // library files, so they must share a fingerprint (the "same files as …"
        // duplicate hint).
        let base = unique_temp_dir("nested_zip_fp");
        fs::create_dir_all(&base).unwrap();
        let content: &[(&str, &[u8])] = &[
            ("Content/data/x.dsf", b"x".as_slice()),
            ("Content/People/Genesis 9/y.duf", b"y".as_slice()),
        ];
        let flat = base.join("flat.zip");
        write_zip(&flat, content);
        let wrapper = base.join("wrapper.zip");
        write_zip(&wrapper, &[("IM123_Product.zip", zip_bytes(content).as_slice())]);
        let dest = base.join("lib");

        let (_, fp_flat) = process_zip_asset(&flat, "flat.zip", &dest, true, false, &HashSet::new());
        let (_, fp_wrap) =
            process_zip_asset(&wrapper, "wrapper.zip", &dest, true, false, &HashSet::new());
        assert!(fp_flat.is_some());
        assert_eq!(fp_flat, fp_wrap);

        let _ = fs::remove_dir_all(&base);
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
