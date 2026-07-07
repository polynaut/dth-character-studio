use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::archive::{extract_nested_zip, zip_file_entries, InflateBudget, NESTED_ZIP_DEPTH};
use crate::assets::fp_add;
use crate::content::{find_content_level, zip_dir_level, CONTENT_FOLDERS, META_FOLDERS};
use crate::fsutil::{copy_dir, entry_is_real_dir, folder_name, rail_target, unsafe_recursive_target};

// --- "Dedup" action: resolve duplicate assets + conflicting shared files ------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DedupRequest {
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
    // Rail: quarantining a folder can end in a recursive delete (the copy-then-
    // delete fallback). Refuse a root/too-shallow source, judged on the CANONICAL
    // path so a junction or `..`-laden spelling can't dress a dangerous target up
    // as a safe-looking one.
    if src.is_dir() && unsafe_recursive_target(&rail_target(src)).is_some() {
        return false;
    }
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
/// 9, "_genesis 8" → 8). The FIRST digit run after the "genesis" token — so
/// "_genesis 9 (2024)" ranks 9, not 2024, and "Genesis 8.1" ranks 8, not 1.
/// 0 when there is no "genesis" token. Overflow saturates to 0.
pub(crate) fn genesis_rank(source_root: &str) -> u32 {
    let lower = source_root.to_ascii_lowercase();
    let after = match lower.find("genesis") {
        Some(i) => &lower[i + "genesis".len()..],
        None => return 0,
    };
    let digits: String = after
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DedupReport {
    dry_run: bool,
    conflicts: Vec<FileConflict>,
    duplicates: Vec<AssetDup>,
    assets_quarantined: u64,
    backup_dir: String,
}

/// One asset's content files, plus what's needed to quarantine it.
pub(crate) struct AssetFiles {
    pub(crate) label: String,
    /// The source folder this asset lives in (e.g. "_genesis 9"). Set by the caller.
    pub(crate) source_root: String,
    pub(crate) is_zip: bool,
    /// The top-level entry (folder or `.zip`) — moved on quarantine.
    pub(crate) asset_path: PathBuf,
    pub(crate) files: Vec<(String, u64)>,
}

fn collect_folder_files(dir: &Path, rel: &Path, out: &mut Vec<(String, u64)>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for e in entries.flatten() {
            let p = e.path();
            let rc = rel.join(e.file_name());
            if entry_is_real_dir(&e) {
                collect_folder_files(&p, &rc, out);
            } else if let Ok(md) = e.metadata() {
                out.push((rc.to_string_lossy().replace('\\', "/"), md.len()));
            }
        }
    }
}

/// Dedup's counterpart of `diff_zip_archive`: collect an opened archive's
/// content-file list (dest-relative path → size), descending into nested package
/// zips the same way so a wrapper download dedups like a flat zip of the same
/// content. Returns whether a content level was found; unreadable nested zips are
/// skipped (dedup is lenient — the asset resolves to None, not an error).
/// `budget` is the CURRENT archive's inflate budget (its nested-zip entries are
/// the only thing this scan inflates); each inner archive derives its own.
fn collect_zip_files(
    archive: &mut zip::ZipArchive<fs::File>,
    depth: u32,
    out: &mut Vec<(String, u64)>,
    budget: &mut InflateBudget,
) -> bool {
    let entries = zip_file_entries(archive);
    let paths: Vec<&str> = entries.iter().map(|(_, p, _)| p.as_str()).collect();
    let content = zip_dir_level(&paths, &CONTENT_FOLDERS);
    if content.is_none() && depth > 0 {
        let mut found = false;
        for (idx, path, _) in &entries {
            if !path.to_ascii_lowercase().ends_with(".zip") {
                continue;
            }
            if let Ok(tmp) = extract_nested_zip(archive, *idx, budget) {
                let inner_len = fs::metadata(&tmp.0).map(|m| m.len()).unwrap_or(0);
                if let Ok(file) = fs::File::open(&tmp.0) {
                    if let Ok(mut inner) = zip::ZipArchive::new(file) {
                        let mut inner_budget = budget.nested(path, inner_len);
                        if inner_budget.check_entry_count(inner.len()).is_ok() {
                            found |= collect_zip_files(&mut inner, depth - 1, out, &mut inner_budget);
                        }
                    }
                }
            }
        }
        if found {
            return true;
        }
    }
    let (root, folders) = match content.or_else(|| zip_dir_level(&paths, &META_FOLDERS)) {
        Some(level) => level,
        None => return false,
    };
    let prefix = if root.is_empty() { String::new() } else { format!("{root}/") };
    for (_, p, sz) in &entries {
        if let Some(sub) = p.strip_prefix(&prefix) {
            if folders.iter().any(|f| f == sub.split('/').next().unwrap_or("")) {
                out.push((sub.to_string(), *sz));
            }
        }
    }
    true
}

/// Resolve an asset to its full content-file list (rel path → size). None for
/// loose files / assets with no Daz content.
pub(crate) fn collect_asset_files(asset: &Path) -> Option<AssetFiles> {
    let is_zip = asset.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    if !asset.is_dir() && !is_zip {
        return None;
    }
    let label = folder_name(asset);
    if is_zip {
        let file = fs::File::open(asset).ok()?;
        let compressed_len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut archive = zip::ZipArchive::new(file).ok()?;
        // Bomb rails (lenient like the rest of dedup: a breach skips the asset).
        let mut budget = InflateBudget::new(&label, compressed_len);
        budget.check_entry_count(archive.len()).ok()?;
        let mut files = Vec::new();
        if !collect_zip_files(&mut archive, NESTED_ZIP_DEPTH, &mut files, &mut budget) {
            return None;
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
pub fn dedup_daz_assets(request: DedupRequest) -> DedupReport {
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
    for (i, asset) in assets.iter().enumerate() {
        if !asset.files.is_empty() {
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
                // Disambiguate on a name collision instead of skipping — otherwise
                // a same-named redundant copy (another group, or a prior run) is
                // silently left installed as a live duplicate.
                let mut target = qdir.join(&assets[i].label);
                let mut n = 1;
                while target.exists() {
                    target = qdir.join(format!("{} ({n})", assets[i].label));
                    n += 1;
                }
                if move_to_quarantine(&assets[i].asset_path, &target) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{unique_temp_dir, write_wrapper_zip};

    #[test]
    fn collect_asset_files_descends_into_nested_package_zip() {
        // Dedup resolves a wrapper to the inner package's files too.
        let base = unique_temp_dir("nested_zip_collect");
        fs::create_dir_all(&base).unwrap();
        let outer = base.join("67582_Meipe.zip");
        write_wrapper_zip(&outer);

        let af = collect_asset_files(&outer).unwrap();
        let mut rels: Vec<String> = af.files.iter().map(|(p, _)| p.clone()).collect();
        rels.sort();
        assert_eq!(rels, vec!["Runtime/Textures/t.png", "data/Meipe/morph.dsf"]);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn genesis_rank_reads_the_number() {
        assert_eq!(genesis_rank("_genesis 9"), 9);
        assert_eq!(genesis_rank("_genesis 8"), 8);
        assert_eq!(genesis_rank("_genesis 3"), 3);
        assert_eq!(genesis_rank("my daz assets"), 0); // no genesis token → unranked
        assert!(genesis_rank("_genesis 9") > genesis_rank("_genesis 8"));
        // The FIRST digit run after "genesis" wins — a trailing year must NOT
        // hijack the rank (the old last-run impl returned 2024 here, inverting
        // "newer genesis wins" and quarantining the wrong copy).
        assert_eq!(genesis_rank("_genesis 9 (2024)"), 9);
        assert_eq!(genesis_rank("Genesis 8.1"), 8); // not 1
        assert!(genesis_rank("_genesis 9 (2020)") > genesis_rank("_genesis 8 (2024)"));
        assert_eq!(genesis_rank("Genesis"), 0); // token, no number
    }
}
