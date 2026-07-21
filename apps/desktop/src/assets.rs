use rayon::prelude::*;
use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use crate::archive::{
    extract_zip_entry, walk_zip_content, InflateBudget, ZipWalkState, NESTED_ZIP_DEPTH,
};
use crate::dedup::{collect_asset_files, genesis_rank, AssetFiles};
use crate::fsutil::{folder_name, join_rel, lock_dest, rail_target, rel_key};
use crate::report::{
    io_detail, step_err, step_header, step_ok, step_skip, InstallReport, InstallStep,
};

// --- "Optional" installs: your own Daz/Houdini content (not DTH release) ----

/// Fold one destination-relative path into an order-independent fingerprint of an
/// asset's destination file set (XOR of per-path hashes), case-folded — NTFS
/// resolves two casings of a path to the SAME library file. Two assets that
/// install the same set of files share a fingerprint even if a few files'
/// contents differ.
pub(crate) fn fp_add(fp: &mut u64, rel: &str) {
    let mut h = DefaultHasher::new();
    rel_key(rel).hash(&mut h);
    *fp ^= h.finish();
}

/// Enumerate a directory once into a map of case-folded file name → byte size
/// (files only). Case-folded because NTFS resolves names case-insensitively — a
/// byte-exact lookup misses a case-variant installed file, which is then
/// re-copied forever (Windows preserves the destination's casing, so it never
/// converges). Empty when the directory is missing or unreadable.
fn dir_file_sizes(dir: &Path) -> HashMap<String, u64> {
    let mut map = HashMap::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(md) = entry.metadata() {
                if md.is_file() {
                    map.insert(rel_key(&entry.file_name().to_string_lossy()), md.len());
                }
            }
        }
    }
    map
}

/// A small cache of destination directory listings (case-folded file name →
/// size), so many scattered lookups read each dest directory only once.
struct DestSizes {
    cache: HashMap<PathBuf, HashMap<String, u64>>,
}
impl DestSizes {
    fn new() -> Self {
        Self { cache: HashMap::new() }
    }
    /// The installed size of `file` at the destination, or None if it isn't there.
    fn len_of(&mut self, file: &Path) -> Option<u64> {
        let dir = file.parent()?;
        let name = rel_key(&file.file_name()?.to_string_lossy());
        let map = self.cache.entry(dir.to_path_buf()).or_insert_with(|| dir_file_sizes(dir));
        map.get(&name).copied()
    }
}

/// Format the final step for an asset once its diff is known. `unsafe_names`
/// entries were refused by the zip-slip rail (absolute/`..` names — see
/// `zip_file_entries`): they can never install, so the safe subset installs and
/// the refusal is surfaced accurately on the step — hard-erroring here (like
/// the unreadable-entry posture) turned a sloppy-but-real archive permanently
/// uninstallable behind a misleading "fix access and retry". Quarantine
/// decisions still refuse such incomplete inventories (dedup.rs).
fn finish_step(
    name: &str,
    diff_files: Vec<String>,
    total: u64,
    dry: bool,
    unsafe_names: u64,
) -> InstallStep {
    let mut step = if diff_files.is_empty() {
        step_skip(name, format!("already installed · {total} files"))
    } else {
        let verb = if dry { "to copy" } else { "copied" };
        let diff = diff_files.len() as u64;
        let mut s = step_ok(name, diff, format!("{diff}/{total} files {verb}"));
        s.files_list = diff_files.into_iter().take(200).collect();
        s
    };
    if unsafe_names > 0 {
        let plural = if unsafe_names == 1 { "y" } else { "ies" };
        step.detail.push_str(&format!(
            " · {unsafe_names} entr{plural} with unsafe names (absolute or '..' paths) refused"
        ));
    }
    step
}

/// An asset's report step plus the fingerprint of its destination file set (None
/// when it resolved to no content / errored) — the fingerprint powers the
/// "same files as …" duplicate hint.
type AssetStep = (InstallStep, Option<u64>);

/// Diff (and, unless `dry`, install) one asset from its COLLECTED inventory —
/// the walk `collect_sources` already did, instead of re-walking the folder /
/// re-reading the zip. Folder assets copy each differing file from
/// `af.content_root`; zip assets extract each differing entry from the archives
/// the collect kept handles to (`zip_entries`: the asset `.zip` and/or its
/// nested temp inflations) — so a real wrapper-zip install no longer inflates
/// the nested package zip a second time. A zip collected WITHOUT handles only
/// diffs here (dry runs); its real install goes through `process_zip_asset`.
fn process_collected_asset(
    af: &AssetFiles,
    name: &str,
    dest: &Path,
    dry: bool,
    force: bool,
    skip: &HashSet<String>,
) -> AssetStep {
    debug_assert!(
        !af.is_zip || dry || af.zip_entries.len() == af.files.len(),
        "a real zip install needs the collected archive handles"
    );
    if af.read_errors > 0 {
        // The install pipeline hard-errors rather than acting on a partial
        // inventory (a lenient walker silently omitting entries would report
        // "already installed" for files it never saw).
        let plural = if af.read_errors == 1 { "y" } else { "ies" };
        return (
            step_err(
                name,
                format!(
                    "{} unreadable entr{plural} while scanning the source — fix access and retry",
                    af.read_errors
                ),
            ),
            None,
        );
    }
    let mut dest_sizes = DestSizes::new();
    let mut diff_files: Vec<String> = Vec::new();
    let mut fp = 0u64;
    // Zip extraction: each referenced archive (the outer `.zip` / a nested temp)
    // is opened lazily, once, with its own inflate budget.
    let mut archives: HashMap<&Path, (zip::ZipArchive<fs::File>, InflateBudget)> = HashMap::new();
    for (i, (rel, size)) in af.files.iter().enumerate() {
        fp_add(&mut fp, rel);
        // An accepted (legitimately-shared) or winner-lost file is already in sync.
        let needs = !skip.contains(&rel_key(rel))
            && (force || dest_sizes.len_of(&join_rel(dest, rel)) != Some(*size));
        if !needs {
            continue;
        }
        diff_files.push(rel.clone());
        if dry {
            continue;
        }
        let to = join_rel(dest, rel);
        if af.is_zip {
            let (apath, idx) = &af.zip_entries[i];
            let slot = match archives.entry(apath.as_path()) {
                std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
                std::collections::hash_map::Entry::Vacant(e) => {
                    let file = match fs::File::open(apath) {
                        Ok(f) => f,
                        Err(err) => {
                            return (
                                step_err(
                                    name,
                                    io_detail(&format!("open {}", apath.display()), &err),
                                ),
                                None,
                            )
                        }
                    };
                    let compressed_len = file.metadata().map(|m| m.len()).unwrap_or(0);
                    let archive = match zip::ZipArchive::new(file) {
                        Ok(a) => a,
                        Err(err) => {
                            return (
                                step_err(name, format!("unzip {} failed: {err}", apath.display())),
                                None,
                            )
                        }
                    };
                    e.insert((archive, InflateBudget::new(name, compressed_len)))
                }
            };
            // extract_zip_entry creates parent dirs and takes the dest lock itself.
            if let Err(e) = extract_zip_entry(&mut slot.0, *idx, &to, &mut slot.1) {
                return (step_err(name, io_detail(&format!("extract {rel}"), &e)), None);
            }
        } else {
            let from = join_rel(&af.content_root, rel);
            if let Some(parent) = to.parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    return (
                        step_err(name, io_detail(&format!("create {}", parent.display()), &e)),
                        None,
                    );
                }
            }
            // Serialize writes to the same library file across assets.
            let _guard = lock_dest(&to);
            if let Err(e) = fs::copy(&from, &to) {
                return (step_err(name, io_detail(&format!("{rel} → {}", to.display()), &e)), None);
            }
        }
    }
    (finish_step(name, diff_files, af.files.len() as u64, dry, af.unsafe_names), Some(fp))
}

/// Diff (and, unless `dry`, install) one `.zip` asset — read straight from the
/// archive's central directory (uncompressed sizes), never extracting the whole
/// thing. For a real install only the entries that differ are inflated. Wrapper
/// downloads (no content folders, a package zip inside) are descended into via
/// the shared `walk_zip_content` — STRICT posture: an unreadable nested zip is a
/// hard error here (dedup's collect is the lenient counterpart).
fn process_zip_asset(
    asset: &Path,
    name: &str,
    dest: &Path,
    dry: bool,
    force: bool,
    skip: &HashSet<String>,
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
    let mut read_errors = 0u64;
    let mut unsafe_names = 0u64;
    let walked = walk_zip_content(
        &mut archive,
        asset,
        NESTED_ZIP_DEPTH,
        &mut ZipWalkState {
            budget: &mut budget,
            strict: true,
            read_errors: &mut read_errors,
            unsafe_names: &mut unsafe_names,
            keep_temps: None,
        },
        &mut |archive, budget, _apath, idx, sub, size| {
            total += 1;
            fp_add(&mut fp, sub);
            let needs = !skip.contains(&rel_key(sub))
                && (force || dest_sizes.len_of(&join_rel(dest, sub)) != Some(size));
            if needs {
                diff_files.push(sub.to_string());
                // Inflate only the differing entries on a real install.
                if !dry {
                    extract_zip_entry(archive, idx, &join_rel(dest, sub), budget)
                        .map_err(|e| io_detail(&format!("extract {sub}"), &e))?;
                }
            }
            Ok(())
        },
    );
    match walked {
        Err(detail) => (step_err(name, detail), None),
        Ok(false) => (step_skip(name, "no Daz content".into()), None),
        // Mirror the collected path's posture: an incomplete inventory must not
        // report ok — a plain install of a zip with unreadable entries used to
        // silently install just the readable subset.
        Ok(true) if read_errors > 0 => {
            let plural = if read_errors == 1 { "y" } else { "ies" };
            (
                step_err(
                    name,
                    format!(
                        "{read_errors} unreadable entr{plural} while scanning the source — fix access and retry"
                    ),
                ),
                None,
            )
        }
        Ok(true) => (finish_step(name, diff_files, total, dry, unsafe_names), Some(fp)),
    }
}

/// Diff/install one asset (folder or `.zip`). Loose files at the source root
/// (`.DS_Store`, readmes) aren't assets — they return None and are skipped.
/// `af` is the asset's inventory from the ONE walk `collect_sources` did; when
/// usable it powers the diff directly, so scans/dry runs never walk an asset a
/// second time.
fn process_asset(
    asset: &Path,
    af: Option<&AssetFiles>,
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
    Some(match af {
        // The collected inventory IS the diff input — no second walk of the
        // source. A real zip install additionally needs the archive handles the
        // collect kept (`zip_entries`, one per file); without them it falls
        // through to the re-walking path below.
        Some(af) if !af.is_zip || dry || af.zip_entries.len() == af.files.len() => {
            process_collected_asset(af, &name, dest, dry, force, skip)
        }
        // A zip without kept handles re-opens the archive; an uncollected zip
        // (no content / bomb rail) reproduces its skip/error.
        _ if is_zip => process_zip_asset(asset, &name, dest, dry, force, skip),
        // An uncollected folder holds no Daz content level.
        _ => (step_skip(&name, "no Daz content".into()), None),
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
    /// prior dry-run/scan flagged as changed. (Winner resolution still
    /// inventories EVERY asset in every source; `only` limits which assets are
    /// diffed and written, not which are walked.) Empty installs every asset
    /// (a full pass).
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

/// Every source's asset listing plus every content-bearing asset's inventory,
/// collected ONCE per command. Winner resolution and the per-asset diffs both
/// read this — they used to walk the whole library independently (a scan walked
/// everything twice, and an `only` install re-walked every asset just to resolve
/// winners).
struct CollectedSources {
    /// (source path, its sorted asset entries — or the step to surface).
    listings: Vec<(String, Result<Vec<PathBuf>, InstallStep>)>,
    /// Asset path → (source folder's Genesis rank, collected inventory).
    files: HashMap<PathBuf, (u32, AssetFiles)>,
}

/// `keep_zip_handles`: pass true when a REAL install follows, so each zip
/// asset's archive handles + nested temp inflations are kept for extraction
/// (see `collect_asset_files`) instead of re-walking/re-inflating; scans and
/// dry runs pass false so temps don't pile up on disk. With a non-empty `only`
/// filter, handles are kept ONLY for the assets the install will actually
/// process: winner resolution still inventories every asset, but the
/// filtered-out ones must not pin their nested-zip temp inflations — a real
/// install used to retain EVERY wrapper's temps for the whole command, a
/// multi-GB disk peak for a one-asset install.
fn collect_sources(sources: &[String], keep_zip_handles: bool, only: &[String]) -> CollectedSources {
    let mut listings = Vec::new();
    let mut files = HashMap::new();
    // Source rail (mirroring dedup's): the same folder listed twice — verbatim
    // or a case/`..`/mapped-drive variant spelling — lists every asset twice,
    // and `process_assets` MOVES each asset's inventory out of `files` on first
    // use, so the second pass reported every folder asset "no Daz content"
    // (`None` meant both "no content" and "already consumed"); a variant
    // spelling additionally split winner resolution into a self-tie. Canonical-
    // fold + dedupe, keeping each source's first-listed spelling.
    let mut seen: HashSet<String> = HashSet::new();
    for source in sources {
        if !seen.insert(rail_target(Path::new(source)).to_string_lossy().to_lowercase()) {
            continue;
        }
        let listing = collect_assets(source);
        if let Ok(assets) = &listing {
            let genesis = genesis_rank(&folder_name(Path::new(source)));
            // Independent reads → parallel, like the per-asset processing.
            let collected: Vec<(PathBuf, AssetFiles)> = assets
                .par_iter()
                .filter_map(|a| {
                    // Same name-match as process_assets — keep handles exactly
                    // for the assets that will be diffed and written.
                    let keep = keep_zip_handles
                        && (only.is_empty() || only.iter().any(|n| *n == folder_name(a)));
                    collect_asset_files(a, keep).map(|af| (a.clone(), af))
                })
                .collect();
            for (path, af) in collected {
                files.insert(path, (genesis, af));
            }
        }
        listings.push((source.clone(), listing));
    }
    CollectedSources { listings, files }
}

/// Resolve, across ALL collected assets, the winner of every shared library file
/// by (newer Genesis, then bigger size, then FIRST asset path), and return
/// per-asset the set of case-folded dest-relative paths to treat as already
/// in-sync — `accepted` plus every file where this asset is NOT the winner. The
/// install then writes only the winning copy of a shared file and never flags
/// the losing copies, so the result is deterministic and independent of folder
/// order ("newer genesis wins, then bigger wins"). A FULL tie (equal rank AND
/// size, e.g. two same-size variants of one file) is broken by the
/// lexicographically first asset path — without that, both copies installed in
/// rayon-nondeterministic order. Keys fold case, so case-variant copies of a
/// shared file meet in ONE bucket instead of racing last-write-wins under rayon.
fn winner_skip_map(
    collected: &HashMap<PathBuf, (u32, AssetFiles)>,
    accepted: &HashSet<String>,
) -> HashMap<PathBuf, HashSet<String>> {
    use std::cmp::Reverse;
    // Winner per dest path = the max (genesis, size, Reverse(asset path)) tuple
    // across all copies — Reverse so the tie goes to the FIRST path in sort
    // order (the order the assets list under their header).
    let mut winners: HashMap<String, (u32, u64, Reverse<&Path>)> = HashMap::new();
    for (path, (genesis, af)) in collected {
        for (rel, size) in &af.files {
            let cand = (*genesis, *size, Reverse(path.as_path()));
            winners.entry(rel_key(rel)).and_modify(|w| *w = (*w).max(cand)).or_insert(cand);
        }
    }
    // Per-asset skip set: accepted ∪ files where this asset isn't the winner.
    let mut skip_map: HashMap<PathBuf, HashSet<String>> = HashMap::new();
    for (path, (genesis, af)) in collected {
        let mut skip = accepted.clone();
        for (rel, size) in &af.files {
            let key = rel_key(rel);
            let cand = (*genesis, *size, Reverse(path.as_path()));
            if winners.get(&key).is_some_and(|&w| cand != w) {
                skip.insert(key);
            }
        }
        skip_map.insert(path.clone(), skip);
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
    // Case-folded for lookups (NTFS); reports keep original casing.
    let accepted: HashSet<String> = request.accepted.iter().map(|r| rel_key(r)).collect();
    let CollectedSources { listings, mut files } = collect_sources(&request.sources, !dry, &only);
    let skip_map = winner_skip_map(&files, &accepted);
    let mut items: Vec<AssetStep> = Vec::new();
    for (source, listing) in listings {
        match listing {
            Err(step) => {
                items.push((step_header(&source), None));
                items.push((step, None));
            }
            Ok(assets) => {
                let asset_items =
                    process_assets(&assets, &mut files, dest, dry, force, &only, &skip_map);
                // When filtering to a changed-asset set, skip a header whose whole
                // source contributed nothing (every asset already installed).
                if !asset_items.is_empty() {
                    items.push((step_header(&source), None));
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
/// Each processed asset's collected inventory is MOVED out of `files` and drops
/// when its step finishes — so a zip asset's nested-temp inflations live only
/// while THAT asset installs, instead of all of them piling up on disk until the
/// whole command returns (each asset appears in exactly one source's listing, so
/// the take-out never starves a later source).
fn process_assets(
    assets: &[PathBuf],
    files: &mut HashMap<PathBuf, (u32, AssetFiles)>,
    dest: &Path,
    dry: bool,
    force: bool,
    only: &[String],
    skip_map: &HashMap<PathBuf, HashSet<String>>,
) -> Vec<AssetStep> {
    let tasks: Vec<(PathBuf, Option<AssetFiles>)> = assets
        .iter()
        .filter(|asset| only.is_empty() || only.iter().any(|n| *n == folder_name(asset)))
        .map(|asset| (asset.clone(), files.remove(asset.as_path()).map(|(_, af)| af)))
        .collect();
    tasks
        .into_par_iter()
        .filter_map(|(asset, af)| process_asset(&asset, af.as_ref(), dest, dry, force, skip_map))
        .collect()
}

/// Read-only scan: what content each asset holds and whether it's already in the library.
#[tauri::command(async)]
pub fn list_daz_assets(request: AssetScanRequest) -> InstallReport {
    let dest = Path::new(&request.dest);
    let accepted: HashSet<String> = request.accepted.iter().map(|r| rel_key(r)).collect();
    let CollectedSources { listings, mut files } = collect_sources(&request.sources, false, &[]);
    let skip_map = winner_skip_map(&files, &accepted);
    let mut items: Vec<AssetStep> = Vec::new();
    for (source, listing) in listings {
        items.push((step_header(&source), None));
        match listing {
            Err(step) => items.push((step, None)),
            Ok(assets) => {
                items.extend(process_assets(&assets, &mut files, dest, true, false, &[], &skip_map));
            }
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
    fn zip_install_hard_errors_on_unreadable_entries_instead_of_partial_ok() {
        // One readable content entry + one the reader can't open (legacy
        // ZipCrypto encryption): the inventory is incomplete, so a plain install
        // must ERROR — it used to install the readable subset and report ok.
        use zip::unstable::write::FileOptionsExt;
        let base = unique_temp_dir("zip_unreadable");
        fs::create_dir_all(&base).unwrap();
        let path = base.join("asset.zip");
        let mut w = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        w.start_file("data/ok.dsf", zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut w, b"ok").unwrap();
        w.start_file(
            "data/locked.dsf",
            zip::write::SimpleFileOptions::default().with_deprecated_encryption(b"pw"),
        )
        .unwrap();
        std::io::Write::write_all(&mut w, b"secret").unwrap();
        w.finish().unwrap();

        let dest = base.join("lib");
        let (step, fp) =
            process_zip_asset(&path, "asset.zip", &dest, false, false, &HashSet::new());
        assert_eq!(step.status, "error", "detail: {}", step.detail);
        assert!(step.detail.contains("unreadable"), "detail: {}", step.detail);
        assert!(fp.is_none());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn zip_with_unsafe_names_installs_the_safe_subset_and_surfaces_the_refusal() {
        // A sloppy archive carrying a zip-slip name beside real content: the
        // unsafe entry is refused (never extracted) but the archive still
        // installs — counting the refusal as "unreadable" flipped a previously-
        // installable archive into a permanent, misleading "fix access and
        // retry" (there is no access problem to fix). The refusal is surfaced
        // accurately on the step instead; truly UNREADABLE entries still
        // hard-error (the ZipCrypto test above).
        let base = unique_temp_dir("zip_unsafe_names");
        fs::create_dir_all(&base).unwrap();
        let path = base.join("sloppy.zip");
        write_zip(&path, &[("data/ok.dsf", b"ok".as_slice()), ("../evil.dsf", b"evil".as_slice())]);
        let dest = base.join("lib");
        // The re-walking zip path.
        let (step, fp) = process_zip_asset(&path, "sloppy.zip", &dest, false, false, &HashSet::new());
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        assert!(step.detail.contains("unsafe names"), "detail: {}", step.detail);
        assert!(fp.is_some());
        assert_eq!(fs::read(join_rel(&dest, "data/ok.dsf")).unwrap(), b"ok");
        assert!(!base.join("evil.dsf").exists(), "the refused entry never lands anywhere");
        // The collected path (what a real install runs) keeps the same posture.
        let af = collect_asset_files(&path, true).unwrap();
        assert_eq!(af.unsafe_names, 1);
        assert_eq!(af.read_errors, 0);
        let (step, _) = process_collected_asset(&af, "sloppy.zip", &dest, false, true, &HashSet::new());
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        assert!(step.detail.contains("unsafe names"), "detail: {}", step.detail);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn wrapper_zip_installs_from_its_collected_inventory() {
        // End-to-end through install_daz_assets: the collected inventory (with
        // its KEPT nested-zip inflation) drives the real install — the nested
        // package zip is not inflated a second time, and the files land right.
        let base = unique_temp_dir("collected_zip_install");
        let source = base.join("src");
        fs::create_dir_all(&source).unwrap();
        write_wrapper_zip(&source.join("67582_Meipe.zip"));
        let dest = base.join("lib");
        let request = |dry: bool| DazAssetsRequest {
            sources: vec![source.to_string_lossy().to_string()],
            dest: dest.to_string_lossy().to_string(),
            force: false,
            dry_run: dry,
            only: vec![],
            accepted: vec![],
        };
        let report = install_daz_assets(request(false));
        let step = report.steps.iter().find(|s| s.label == "67582_Meipe.zip").unwrap();
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        assert_eq!(fs::read(join_rel(&dest, "data/Meipe/morph.dsf")).unwrap(), b"morph-data");
        assert!(join_rel(&dest, "Runtime/Textures/t.png").is_file());
        // A re-run reports it already installed (or its whole source contributed
        // nothing and the header row was filtered with it).
        let report = install_daz_assets(request(true));
        if let Some(step) = report.steps.iter().find(|s| s.label == "67582_Meipe.zip") {
            assert_eq!(step.status, "skipped", "detail: {}", step.detail);
        }
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn collect_keeps_zip_handles_only_for_the_only_filtered_assets() {
        // A real install of ONE changed asset must not pin every wrapper's
        // nested-zip temp inflation on disk — handles/temps are kept only for
        // the assets the `only` filter lets through; the rest are still
        // inventoried (winner resolution needs them) but handle-free.
        let base = unique_temp_dir("only_handles");
        let source = base.join("src");
        fs::create_dir_all(&source).unwrap();
        write_wrapper_zip(&source.join("AAA.zip"));
        write_wrapper_zip(&source.join("BBB.zip"));
        let sources = vec![source.to_string_lossy().to_string()];
        let only = vec!["AAA.zip".to_string()];
        let CollectedSources { files, .. } = collect_sources(&sources, true, &only);
        let af_of = |name: &str| {
            files
                .iter()
                .find(|(p, _)| folder_name(p) == name)
                .map(|(_, (_, af))| af)
                .unwrap()
        };
        let kept = af_of("AAA.zip");
        assert_eq!(kept.zip_entries.len(), kept.files.len(), "the installed asset keeps handles");
        assert_eq!(kept.nested_temps.len(), 1);
        let skipped = af_of("BBB.zip");
        assert!(!skipped.files.is_empty(), "still inventoried for winner resolution");
        assert!(skipped.zip_entries.is_empty() && skipped.nested_temps.is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn install_drops_a_zip_assets_temps_when_its_own_step_finishes() {
        // Per-STEP scoping, not end-of-batch: right after asset A's step ran,
        // A's nested-temp inflation is gone while B's — whose step hasn't run —
        // still lives. (The old single-asset assertion checked only after the
        // whole batch returned, so it couldn't tell a per-step drop from one at
        // the end of the batch.)
        let base = unique_temp_dir("temps_scoped");
        let source = base.join("src");
        fs::create_dir_all(&source).unwrap();
        // Distinct content per wrapper, so neither loses its files to the other
        // in winner resolution.
        let inner_a = zip_bytes(&[("Content/data/A/a.dsf", b"a".as_slice())]);
        write_zip(&source.join("AAA.zip"), &[("pkgA.zip", inner_a.as_slice())]);
        let inner_b = zip_bytes(&[("Content/data/B/b.dsf", b"b".as_slice())]);
        write_zip(&source.join("BBB.zip"), &[("pkgB.zip", inner_b.as_slice())]);
        let sources = vec![source.to_string_lossy().to_string()];
        let CollectedSources { listings, mut files } = collect_sources(&sources, true, &[]);
        let temp_of = |files: &HashMap<PathBuf, (u32, AssetFiles)>, name: &str| -> PathBuf {
            files
                .iter()
                .find(|(p, _)| folder_name(p) == name)
                .map(|(_, (_, af))| af.nested_temps[0].0.clone())
                .unwrap()
        };
        let temp_a = temp_of(&files, "AAA.zip");
        let temp_b = temp_of(&files, "BBB.zip");
        assert!(temp_a.is_file() && temp_b.is_file(), "both inflations are kept for the install");
        let Ok(assets) = &listings[0].1 else { panic!("listing failed") };
        let dest = base.join("lib");
        let skip_map = winner_skip_map(&files, &HashSet::new());
        // Run ONLY asset A's step through the real pipeline.
        let only_a = vec!["AAA.zip".to_string()];
        let steps = process_assets(assets, &mut files, &dest, false, false, &only_a, &skip_map);
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].0.status, "ok", "detail: {}", steps[0].0.detail);
        assert!(!temp_a.exists(), "A's temp drops with A's OWN step");
        assert!(temp_b.exists(), "B's temp must still live — its step hasn't run yet");
        assert!(join_rel(&dest, "data/A/a.dsf").is_file());
        // B's step then consumes — and drops — ITS temp.
        let only_b = vec!["BBB.zip".to_string()];
        let steps = process_assets(assets, &mut files, &dest, false, false, &only_b, &skip_map);
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].0.status, "ok", "detail: {}", steps[0].0.detail);
        assert!(!temp_b.exists(), "B's temp drops with B's step");
        assert!(files.is_empty(), "each inventory is consumed by its asset's step");
        assert!(join_rel(&dest, "data/B/b.dsf").is_file());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn duplicate_source_listings_fold_to_one_pass() {
        // The same source listed twice (verbatim + a `..`-laden variant
        // spelling): `process_assets` moves each asset's inventory out of the
        // collected map, so the second pass used to report every folder asset
        // "no Daz content". Sources are canonical-folded + deduped (mirroring
        // dedup's source rails), so each asset is listed and processed once.
        let base = unique_temp_dir("dup_sources");
        let source = base.join("src");
        let asset = source.join("Thing");
        fs::create_dir_all(asset.join("data")).unwrap();
        fs::write(asset.join("data").join("x.dsf"), b"x").unwrap();
        let spelled = source.to_string_lossy().to_string();
        let sneaky = source.join("..").join("src").to_string_lossy().to_string();
        let report = list_daz_assets(AssetScanRequest {
            sources: vec![spelled.clone(), spelled, sneaky],
            dest: base.join("lib").to_string_lossy().to_string(),
            accepted: vec![],
        });
        let thing_steps: Vec<_> = report.steps.iter().filter(|s| s.label == "Thing").collect();
        assert_eq!(thing_steps.len(), 1, "one listing, one step");
        assert_eq!(thing_steps[0].status, "ok", "detail: {}", thing_steps[0].detail);
        assert!(
            !report.steps.iter().any(|s| s.detail == "no Daz content"),
            "a consumed inventory must not read as content-less"
        );
        assert_eq!(report.steps.iter().filter(|s| s.status == "header").count(), 1);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn winner_tie_breaks_deterministically_by_asset_path() {
        // Equal genesis rank AND equal size but different bytes: without a
        // tie-break, NEITHER copy was skipped and both installed in
        // rayon-nondeterministic order. The lexicographically first asset path
        // must win, every run.
        let base = unique_temp_dir("winner_tie");
        let source = base.join("src");
        for (asset, bytes) in [("Alpha", b"aaaa"), ("Bravo", b"bbbb")] {
            let dir = source.join(asset).join("data");
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("shared.dsf"), bytes).unwrap();
        }
        let dest = base.join("lib");
        let report = install_daz_assets(DazAssetsRequest {
            sources: vec![source.to_string_lossy().to_string()],
            dest: dest.to_string_lossy().to_string(),
            force: false,
            dry_run: false,
            only: vec![],
            accepted: vec![],
        });
        let step = |label: &str| report.steps.iter().find(|s| s.label == label).unwrap();
        assert_eq!(step("Alpha").status, "ok", "detail: {}", step("Alpha").detail);
        // Bravo loses the tie deterministically — its copy is never flagged.
        assert_eq!(step("Bravo").status, "skipped", "detail: {}", step("Bravo").detail);
        assert_eq!(fs::read(dest.join("data").join("shared.dsf")).unwrap(), b"aaaa");
        // Twin-pinned with the JS mirror (dedup-report-list.test.ts): `Path`
        // ordering is COMPONENT-wise, so "_genesis 8" sorts before
        // "_genesis 8.1" although the full STRING compares the other way
        // ('.' 0x2E < '/' 0x2F at the fork). The UI's tie-break must match
        // THIS ordering, not a raw string compare.
        assert!(
            std::path::Path::new(r"D:\lib\_genesis 8\Prod")
                < std::path::Path::new(r"D:\lib\_genesis 8.1\Prod")
        );
        assert!(r"D:\lib\_genesis 8\Prod" > r"D:\lib\_genesis 8.1\Prod");
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
        // NTFS: a case-variant of the same path is the SAME library file.
        let mut d = 0u64;
        fp_add(&mut d, "DATA/X");
        fp_add(&mut d, "people/Y");
        assert_eq!(a, d, "case variants share a fingerprint");
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

    #[test]
    fn install_finds_case_variant_installed_files_in_sync() {
        // A `DATA/`-cased source against a `data/`-cased library: NTFS resolves
        // them to the same file, so a size-equal copy must read as installed —
        // the old byte-exact name lookup re-copied it forever (Windows preserves
        // the destination's casing, so it never converged).
        let base = unique_temp_dir("case_insync");
        let source = base.join("src");
        let asset = source.join("CasedAsset");
        fs::create_dir_all(asset.join("DATA")).unwrap();
        fs::write(asset.join("DATA").join("Morph.dsf"), b"same-bytes").unwrap();
        let dest = base.join("lib");
        fs::create_dir_all(dest.join("data")).unwrap();
        fs::write(dest.join("data").join("morph.dsf"), b"same-bytes").unwrap();

        let report = list_daz_assets(AssetScanRequest {
            sources: vec![source.to_string_lossy().to_string()],
            dest: dest.to_string_lossy().to_string(),
            accepted: vec![],
        });
        let step = report.steps.iter().find(|s| s.label == "CasedAsset").unwrap();
        assert_eq!(step.status, "skipped", "detail: {}", step.detail);
        assert!(step.detail.contains("already installed"), "detail: {}", step.detail);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn folder_asset_installs_from_its_collected_inventory() {
        // End-to-end through install_daz_assets: the collected inventory drives
        // both the dry diff and the real copy (no second source walk).
        let base = unique_temp_dir("collected_install");
        let source = base.join("src");
        let asset = source.join("MyAsset");
        fs::create_dir_all(asset.join("data").join("sub")).unwrap();
        fs::write(asset.join("data").join("sub").join("m.dsf"), b"morph").unwrap();
        fs::create_dir_all(asset.join("Runtime")).unwrap();
        fs::write(asset.join("Runtime").join("t.png"), b"tex").unwrap();
        let dest = base.join("lib");

        let request = |dry: bool| DazAssetsRequest {
            sources: vec![source.to_string_lossy().to_string()],
            dest: dest.to_string_lossy().to_string(),
            force: false,
            dry_run: dry,
            only: vec![],
            accepted: vec![],
        };
        let report = install_daz_assets(request(true));
        let step = report.steps.iter().find(|s| s.label == "MyAsset").unwrap();
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        assert_eq!(step.files, 2);

        let report = install_daz_assets(request(false));
        let step = report.steps.iter().find(|s| s.label == "MyAsset").unwrap();
        assert_eq!(step.status, "ok", "detail: {}", step.detail);
        assert_eq!(fs::read(dest.join("data").join("sub").join("m.dsf")).unwrap(), b"morph");
        assert_eq!(fs::read(dest.join("Runtime").join("t.png")).unwrap(), b"tex");

        // A re-scan reports it installed (or its whole source contributed
        // nothing and the header row was filtered with it).
        let report = install_daz_assets(request(true));
        if let Some(step) = report.steps.iter().find(|s| s.label == "MyAsset") {
            assert_eq!(step.status, "skipped", "detail: {}", step.detail);
        }

        let _ = fs::remove_dir_all(&base);
    }
}
