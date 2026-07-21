use rayon::prelude::*;
use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use crate::archive::{extract_zip_entry, walk_zip_content, InflateBudget, NESTED_ZIP_DEPTH};
use crate::dedup::{collect_asset_files, genesis_rank, AssetFiles};
use crate::fsutil::{folder_name, join_rel, lock_dest, rel_key};
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

/// Diff (and, unless `dry`, install) one asset from its COLLECTED inventory —
/// the walk `collect_sources` already did, instead of re-walking the folder /
/// re-reading the zip. Folder assets run both modes here (a real install copies
/// each differing file from `af.content_root`); zip assets only DIFF here (dry
/// runs) — extraction needs the archive, so real zip installs go through
/// `process_zip_asset`.
fn process_collected_asset(
    af: &AssetFiles,
    name: &str,
    dest: &Path,
    dry: bool,
    force: bool,
    skip: &HashSet<String>,
) -> AssetStep {
    debug_assert!(!af.is_zip || dry, "real zip installs re-open the archive");
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
    for (rel, size) in &af.files {
        fp_add(&mut fp, rel);
        // An accepted (legitimately-shared) or winner-lost file is already in sync.
        let needs = !skip.contains(&rel_key(rel))
            && (force || dest_sizes.len_of(&join_rel(dest, rel)) != Some(*size));
        if !needs {
            continue;
        }
        diff_files.push(rel.clone());
        if !dry {
            let from = join_rel(&af.content_root, rel);
            let to = join_rel(dest, rel);
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
    (finish_step(name, diff_files, af.files.len() as u64, dry), Some(fp))
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
    let walked = walk_zip_content(
        &mut archive,
        NESTED_ZIP_DEPTH,
        &mut budget,
        true,
        &mut read_errors,
        &mut |archive, budget, idx, sub, size| {
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
        Ok(true) => (finish_step(name, diff_files, total, dry), Some(fp)),
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
        // Folder assets (both modes) + zip dry runs: the collected inventory IS
        // the diff input — no second walk of the source.
        Some(af) if !af.is_zip || dry => process_collected_asset(af, &name, dest, dry, force, skip),
        // Real zip installs re-open the archive (extraction needs the entries);
        // an uncollected zip (no content / bomb rail) reproduces its skip/error.
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

fn collect_sources(sources: &[String]) -> CollectedSources {
    let mut listings = Vec::new();
    let mut files = HashMap::new();
    for source in sources {
        let listing = collect_assets(source);
        if let Ok(assets) = &listing {
            let genesis = genesis_rank(&folder_name(Path::new(source)));
            // Independent reads → parallel, like the per-asset processing.
            let collected: Vec<(PathBuf, AssetFiles)> = assets
                .par_iter()
                .filter_map(|a| collect_asset_files(a).map(|af| (a.clone(), af)))
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
/// by (newer Genesis, then bigger size), and return per-asset the set of
/// case-folded dest-relative paths to treat as already in-sync — `accepted` plus
/// every file where this asset is NOT the winner. The install then writes only
/// the winning copy of a shared file and never flags the losing copies, so the
/// result is deterministic and independent of folder order ("newer genesis wins,
/// then bigger wins"). Keys fold case, so case-variant copies of a shared file
/// meet in ONE bucket instead of racing last-write-wins under rayon.
fn winner_skip_map(
    collected: &HashMap<PathBuf, (u32, AssetFiles)>,
    accepted: &HashSet<String>,
) -> HashMap<PathBuf, HashSet<String>> {
    // Winner per dest path = the max (genesis, size) tuple across all copies.
    let mut winners: HashMap<String, (u32, u64)> = HashMap::new();
    for (genesis, af) in collected.values() {
        for (rel, size) in &af.files {
            let cand = (*genesis, *size);
            winners.entry(rel_key(rel)).and_modify(|w| *w = (*w).max(cand)).or_insert(cand);
        }
    }
    // Per-asset skip set: accepted ∪ files where this asset isn't the winner.
    let mut skip_map: HashMap<PathBuf, HashSet<String>> = HashMap::new();
    for (path, (genesis, af)) in collected {
        let mut skip = accepted.clone();
        for (rel, size) in &af.files {
            let key = rel_key(rel);
            if winners.get(&key).is_some_and(|&w| (*genesis, *size) != w) {
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
    let CollectedSources { listings, files } = collect_sources(&request.sources);
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
                    process_assets(&assets, &files, dest, dry, force, &only, &skip_map);
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
fn process_assets(
    assets: &[PathBuf],
    files: &HashMap<PathBuf, (u32, AssetFiles)>,
    dest: &Path,
    dry: bool,
    force: bool,
    only: &[String],
    skip_map: &HashMap<PathBuf, HashSet<String>>,
) -> Vec<AssetStep> {
    assets
        .par_iter()
        .filter(|asset| only.is_empty() || only.iter().any(|n| *n == folder_name(asset)))
        .filter_map(|asset| {
            let af = files.get(asset.as_path()).map(|(_, af)| af);
            process_asset(asset, af, dest, dry, force, skip_map)
        })
        .collect()
}

/// Read-only scan: what content each asset holds and whether it's already in the library.
#[tauri::command(async)]
pub fn list_daz_assets(request: AssetScanRequest) -> InstallReport {
    let dest = Path::new(&request.dest);
    let accepted: HashSet<String> = request.accepted.iter().map(|r| rel_key(r)).collect();
    let CollectedSources { listings, files } = collect_sources(&request.sources);
    let skip_map = winner_skip_map(&files, &accepted);
    let mut items: Vec<AssetStep> = Vec::new();
    for (source, listing) in listings {
        items.push((step_header(&source), None));
        match listing {
            Err(step) => items.push((step, None)),
            Ok(assets) => {
                items.extend(process_assets(&assets, &files, dest, true, false, &[], &skip_map));
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
