use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use crate::archive::{walk_zip_content, InflateBudget, TempFile, NESTED_ZIP_DEPTH};
use crate::content::find_content_level;
use crate::fsutil::{
    copy_dir, folder_name, path_contains, rail_target, rel_key, unsafe_recursive_target,
    walk_dir, DirVisitor,
};

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
    /// Full asset PATHS the user explicitly chose to keep in their duplicate
    /// group (overriding the auto-pick). Paths, not labels: an exact-dup group's
    /// members share a label by construction, so only the path identifies WHICH
    /// copy to keep. The rest of that group is quarantined. A chosen path that no
    /// longer resolves is reported and its group is left untouched — never a
    /// silent fall-back to auto.
    #[serde(default)]
    keepers: Vec<String>,
    /// Folder the redundant duplicate copies are moved into. Required to apply —
    /// nothing is moved when empty.
    #[serde(default)]
    quarantine: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
struct ConflictCopy {
    label: String,
    /// The source folder this copy lives in (e.g. "_genesis 9").
    source: String,
    size: u64,
    in_zip: bool,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
struct FileConflict {
    rel: String,
    copies: Vec<ConflictCopy>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
struct DupMember {
    label: String,
    /// The source folder this copy lives in (e.g. "_genesis 9").
    source: String,
    /// Full path of this copy — unique by construction (labels collide inside an
    /// exact-dup group), so keeper choices and UI rows key on it.
    path: String,
    file_count: u64,
    is_zip: bool,
    /// The copy kept (others are quarantined). The default is auto-picked but the
    /// user can override it via the request's `keepers` (paths).
    is_keeper: bool,
    /// Set on apply when this redundant copy was fully moved to quarantine.
    moved: bool,
    /// Empty, or why this copy couldn't be (fully) quarantined.
    error: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
struct AssetDup {
    members: Vec<DupMember>,
    /// "exact" (identical file paths AND sizes) or "version" (same product,
    /// different version — high file overlap with differences, e.g. a `…UD` vs
    /// `…UPDATE`).
    kind: String,
    /// Set after apply: EVERY redundant copy of the group was quarantined.
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
/// (e.g. the quarantine folder is on a different drive). `Ok` means the asset was
/// FULLY moved; `Err` carries why it wasn't (and what state it was left in) —
/// silence here used to hide half-done quarantines from the report.
fn move_to_quarantine(src: &Path, dst: &Path) -> Result<(), String> {
    // A junction/symlink AS the asset root: move the LINK itself, never its
    // target. `is_dir()` follows links, so without this check the cross-drive
    // fallback would deep-copy the link TARGET's gigabytes and then delete —
    // rename moves the reparse point on the same volume; across volumes we
    // refuse rather than materialize the target.
    let is_link =
        fs::symlink_metadata(src).map(|m| m.file_type().is_symlink()).unwrap_or(false);
    if is_link {
        if let Some(p) = dst.parent() {
            fs::create_dir_all(p).map_err(|e| format!("create {}: {e}", p.display()))?;
        }
        return fs::rename(src, dst).map_err(|e| {
            format!(
                "the asset is a directory link/junction and moving the link itself failed: {e} — \
                 links are never deep-copied (that would materialize the target); move it manually"
            )
        });
    }
    let is_dir = src.is_dir();
    // Rail: quarantining a folder can end in a recursive delete (the copy-then-
    // delete fallback). Refuse a root/too-shallow source, judged on the CANONICAL
    // path so a junction or `..`-laden spelling can't dress a dangerous target up
    // as a safe-looking one. (An asset directly in a drive/share root trips this —
    // the reason is surfaced instead of silently skipping it.)
    if is_dir {
        if let Some(reason) = unsafe_recursive_target(&rail_target(src)) {
            return Err(format!("refused: {reason}"));
        }
    }
    if let Some(p) = dst.parent() {
        fs::create_dir_all(p).map_err(|e| format!("create {}: {e}", p.display()))?;
    }
    if fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    // Cross-drive fallback: copy, then delete the source.
    let copied: Result<(), String> = if is_dir {
        match copy_dir(src, dst) {
            // A dir link inside is never followed while copying, so a copy-based
            // move would silently drop it — refuse rather than lose the link.
            Ok(stats) if stats.skipped_links > 0 => Err(format!(
                "{} linked folder(s) inside (links are never followed, so a copy-based move would lose them)",
                stats.skipped_links
            )),
            Ok(_) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        fs::copy(src, dst).map(|_| ()).map_err(|e| e.to_string())
    };
    if let Err(reason) = copied {
        // The COPY failed — `dst` is partial/garbage. Roll it back so the
        // next run's name-collision loop doesn't mint " (1)" duplicates from it.
        // The source is untouched, so nothing is lost.
        if is_dir {
            let _ = fs::remove_dir_all(dst);
        } else {
            let _ = fs::remove_file(dst);
        }
        return Err(format!("copy to quarantine failed: {reason}"));
    }
    // Copy succeeded — `dst` is now a COMPLETE copy. Delete the source. If that
    // fails (e.g. Daz holds a file open, so `remove_dir_all` deletes some children
    // and then errors), DO NOT roll back `dst`: after a partial source delete it is
    // the only intact copy of the asset, and removing it would lose the user's
    // downloaded asset entirely. Keep it and report the failure — the (now partial)
    // source is left for the user to clean up, never destroyed alongside its backup.
    let removed = if is_dir { fs::remove_dir_all(src) } else { fs::remove_file(src) };
    removed.map_err(|e| {
        format!(
            "a complete quarantine copy was made at {}, but deleting the source failed: {e} — \
             the source may be partially deleted; clean it up manually (the quarantine copy is intact)",
            dst.display()
        )
    })
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
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
pub(crate) struct DedupReport {
    dry_run: bool,
    conflicts: Vec<FileConflict>,
    duplicates: Vec<AssetDup>,
    assets_quarantined: u64,
    backup_dir: String,
    /// Report-level failures: a quarantine folder inside a source, keeper choices
    /// that no longer resolve, groups skipped because their scan inventory had
    /// read errors. Empty when everything went cleanly.
    errors: Vec<String>,
}

/// One asset's content files, plus what's needed to quarantine it.
pub(crate) struct AssetFiles {
    pub(crate) label: String,
    /// The source folder this asset lives in (e.g. "_genesis 9"). Set by the caller.
    pub(crate) source_root: String,
    pub(crate) is_zip: bool,
    /// The top-level entry (folder or `.zip`) — moved on quarantine.
    pub(crate) asset_path: PathBuf,
    /// Folder assets: the directory the content folders live in (`files`' rel
    /// paths join onto it). Empty for zips.
    pub(crate) content_root: PathBuf,
    pub(crate) files: Vec<(String, u64)>,
    /// Zip assets collected with `keep_zip_handles`: for each entry of `files`
    /// (same order), the physical archive it lives in — the asset `.zip` itself
    /// or one of `nested_temps` — plus its index there. A real install extracts
    /// straight from these instead of re-walking (and re-inflating) the archive.
    /// Empty otherwise.
    pub(crate) zip_entries: Vec<(PathBuf, usize)>,
    /// Keeps nested-zip temp inflations alive for `zip_entries` — the temp files
    /// delete themselves when this inventory drops.
    // Held for its Drop (the temps' self-delete), never read in production.
    #[allow(dead_code)]
    pub(crate) nested_temps: Vec<TempFile>,
    /// Entries the collection could NOT read (unreadable dirs/metadata, skipped
    /// zip entries, unreadable nested zips). Non-zero means `files` may be an
    /// INCOMPLETE inventory — quarantine decisions refuse such groups.
    pub(crate) read_errors: u64,
}

/// Collects one content folder's files (rel path → size) via the shared walker;
/// lenient, but unreadable entries are COUNTED so an incomplete inventory is
/// visible (a silent omission used to let >260-char/locked trees group and
/// quarantine on partial data). Directory links are skipped (not asset content).
struct FolderCollect<'a> {
    prefix: &'a Path,
    out: &'a mut Vec<(String, u64)>,
    read_errors: &'a mut u64,
}
impl DirVisitor for FolderCollect<'_> {
    fn file(&mut self, entry: &fs::DirEntry, rel: &Path) -> std::io::Result<()> {
        match entry.metadata() {
            Ok(md) => self
                .out
                .push((self.prefix.join(rel).to_string_lossy().replace('\\', "/"), md.len())),
            Err(_) => *self.read_errors += 1,
        }
        Ok(())
    }
    fn unreadable(&mut self, _path: &Path, _e: std::io::Error) -> std::io::Result<()> {
        *self.read_errors += 1;
        Ok(())
    }
}

/// Resolve an asset to its full content-file list (rel path → size). None for
/// loose files / assets with no Daz content. `keep_zip_handles` additionally
/// records each zip entry's physical archive + index (`zip_entries`) and keeps
/// nested temp inflations alive (`nested_temps`) so a real install can extract
/// without re-walking the archive — pass false for scan-only collects (dedup,
/// dry runs) so temps don't pile up on disk for the whole run.
pub(crate) fn collect_asset_files(asset: &Path, keep_zip_handles: bool) -> Option<AssetFiles> {
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
        let mut zip_entries: Vec<(PathBuf, usize)> = Vec::new();
        let mut nested_temps: Vec<TempFile> = Vec::new();
        let mut read_errors = 0u64;
        // Lenient posture: unreadable nested zips are counted, never fatal — the
        // shared walk descends into nested package zips exactly like the install.
        let found = walk_zip_content(
            &mut archive,
            asset,
            NESTED_ZIP_DEPTH,
            &mut budget,
            false,
            &mut read_errors,
            if keep_zip_handles { Some(&mut nested_temps) } else { None },
            &mut |_archive, _budget, apath, idx, sub, size| {
                files.push((sub.to_string(), size));
                if keep_zip_handles {
                    zip_entries.push((apath.to_path_buf(), idx));
                }
                Ok(())
            },
        )
        .unwrap_or(false);
        if !found {
            return None;
        }
        Some(AssetFiles {
            label,
            source_root: String::new(),
            is_zip: true,
            asset_path: asset.to_path_buf(),
            content_root: PathBuf::new(),
            files,
            zip_entries,
            nested_temps,
            read_errors,
        })
    } else {
        let (content_root, folders) = find_content_level(asset, 5)?;
        let mut files = Vec::new();
        let mut read_errors = 0u64;
        for f in &folders {
            let mut v = FolderCollect {
                prefix: Path::new(f),
                out: &mut files,
                read_errors: &mut read_errors,
            };
            let _ = walk_dir(&content_root.join(f), &mut v); // visitor never errors
        }
        Some(AssetFiles {
            label,
            source_root: String::new(),
            is_zip: false,
            asset_path: asset.to_path_buf(),
            content_root,
            files,
            zip_entries: Vec::new(),
            nested_temps: Vec::new(),
            read_errors,
        })
    }
}

/// Order-independent fingerprint of an asset's (path, size) inventory: the
/// sorted (case-folded rel, size) list hashed as ONE sequence. Unlike the old
/// per-path XOR it is not malleable — duplicate entries can't cancel out — and
/// it folds SIZES in, so equal fingerprints mean same paths AND same sizes
/// ("exact" actually means exact; a same-paths-different-sizes pair reports as
/// "version" via the overlap heuristic instead).
fn content_fingerprint(files: &[(String, u64)]) -> u64 {
    let mut items: Vec<(String, u64)> = files.iter().map(|(r, s)| (rel_key(r), *s)).collect();
    items.sort();
    let mut h = DefaultHasher::new();
    for (r, s) in &items {
        r.hash(&mut h);
        s.hash(&mut h);
    }
    h.finish()
}

/// The report a containment error produces: nothing scanned, nothing moved.
fn containment_error_report(dry: bool, quarantine: String, error: String) -> DedupReport {
    DedupReport {
        dry_run: dry,
        conflicts: Vec::new(),
        duplicates: Vec::new(),
        assets_quarantined: 0,
        backup_dir: quarantine,
        errors: vec![error],
    }
}

/// Find duplicate assets + conflicting shared files across the source folders, and
/// (unless `dry_run`) QUARANTINE the redundant copies of each duplicate/version
/// group — keeping the chosen/auto keeper, moving the rest under the quarantine
/// folder (reversible). Shared-file conflicts are reported only — never rewritten
/// (that would mutate an author's downloaded asset); they're resolved by Accept.
// `(async)`: runs off the main thread — see assets::install_daz_assets.
#[tauri::command(async)]
pub fn dedup_daz_assets(request: DedupRequest) -> DedupReport {
    let dry = request.dry_run;
    // Case-folded for lookups (NTFS); the report keeps original casing.
    let accepted: HashSet<String> = request.accepted.iter().map(|r| rel_key(r)).collect();
    let chosen_keepers: HashSet<String> = request.keepers.into_iter().collect();
    // Where redundant copies are moved. Empty (e.g. on a dry run) → nothing moves.
    let quarantine = request.quarantine.clone();
    let mut errors: Vec<String> = Vec::new();

    // Source rail #1: the same physical folder listed twice (a case/spelling
    // variant) would make every asset an exact duplicate of ITSELF — and apply
    // would quarantine the only physical copy while reporting `fixed: true` with
    // a keeper path that no longer exists. Fold to the canonical spelling
    // (case-insensitively, like every other NTFS compare here) and dedupe,
    // keeping each source's first-listed spelling and its canonical form.
    let sources: Vec<(String, PathBuf)> = {
        let mut seen: HashSet<String> = HashSet::new();
        let mut out = Vec::new();
        for source in &request.sources {
            let canon = rail_target(Path::new(source));
            if seen.insert(canon.to_string_lossy().to_lowercase()) {
                out.push((source.clone(), canon));
            }
        }
        out
    };

    // Source rail #2: a source nested inside another source is scanned TWICE —
    // once as a source, once as a single "asset" of its parent (find_content_level
    // resolves the child folder's content) — and the parent's grouping could then
    // quarantine the ENTIRE child source folder. Hard error before anything is
    // scanned or moved, like the quarantine rail below, so no source root (or an
    // ancestor/descendant of one) can ever be selected as a redundant member.
    for (a, (source_a, canon_a)) in sources.iter().enumerate() {
        for (b, (source_b, canon_b)) in sources.iter().enumerate() {
            if a == b || !Path::new(source_a).is_dir() || !Path::new(source_b).is_dir() {
                continue;
            }
            if path_contains(canon_a, canon_b) {
                return containment_error_report(
                    dry,
                    quarantine,
                    format!(
                        "Source folders must not contain each other ({source_b} is inside {source_a}) — remove one of them; nothing was scanned or moved."
                    ),
                );
            }
        }
    }

    // Containment rail: a quarantine folder inside a source would be scanned as
    // an asset itself and could be moved into itself; a source inside the
    // quarantine would re-scan quarantined copies. Hard error BEFORE anything is
    // scanned or moved, judged on canonical paths.
    let qcanon = if quarantine.is_empty() { None } else { Some(rail_target(Path::new(&quarantine))) };
    if let Some(q) = &qcanon {
        for (source, sc) in &sources {
            if !Path::new(source).is_dir() {
                continue;
            }
            if path_contains(sc, q) || path_contains(q, sc) {
                return containment_error_report(
                    dry,
                    quarantine,
                    format!(
                        "The quarantine folder ({}) must be outside the source folders ({source}) — nothing was scanned or moved.",
                        request.quarantine
                    ),
                );
            }
        }
    }

    // Gather every asset's content files (independent reads → parallel).
    let mut assets: Vec<AssetFiles> = Vec::new();
    for (source, _canon) in &sources {
        let src = Path::new(source);
        if !src.is_dir() {
            continue;
        }
        let mut entries: Vec<PathBuf> = match fs::read_dir(src) {
            Ok(e) => e.flatten().map(|x| x.path()).collect(),
            Err(_) => continue,
        };
        entries.sort();
        // Belt-and-braces beside the containment rail: never scan the quarantine
        // folder itself as an asset.
        if let Some(q) = &qcanon {
            entries.retain(|p| !path_contains(q, &rail_target(p)));
        }
        let root_label = folder_name(src);
        // Scan-only collect: no archive handles/temps kept (dedup never extracts).
        let mut found: Vec<AssetFiles> =
            entries.par_iter().filter_map(|a| collect_asset_files(a, false)).collect();
        for af in &mut found {
            af.source_root = root_label.clone();
        }
        assets.append(&mut found);
    }

    let n = assets.len();
    let filecount: Vec<usize> = assets.iter().map(|a| a.files.len()).collect();
    let totalbytes: Vec<u64> = assets.iter().map(|a| a.files.iter().map(|(_, s)| *s).sum()).collect();

    // path (case-folded — NTFS) → which assets ship it. Original casing is kept
    // aside for the user-facing conflict rows.
    let mut byrel: HashMap<String, Vec<usize>> = HashMap::new();
    let mut display_rel: HashMap<String, String> = HashMap::new();
    for (i, af) in assets.iter().enumerate() {
        for (rel, _sz) in &af.files {
            let key = rel_key(rel);
            display_rel.entry(key.clone()).or_insert_with(|| rel.clone());
            byrel.entry(key).or_default().push(i);
        }
    }
    // Fingerprint each asset by its (path, size) inventory (exact-dup detection).
    let fp_of: Vec<u64> = assets.iter().map(|af| content_fingerprint(&af.files)).collect();
    // Per-asset (case-folded rel → size), built ONCE — the conflict sizing below
    // used to run a linear `find` over each member's whole file list (with a
    // fresh lowercase allocation per element) for every shared rel.
    let sizes_by_key: Vec<HashMap<String, u64>> = assets
        .iter()
        .map(|af| af.files.iter().map(|(r, s)| (rel_key(r), *s)).collect())
        .collect();

    // Group assets that are the same content: exact (identical inventory) OR a
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
            .map(|&i| (i, sizes_by_key[i].get(rel).copied().unwrap_or(0)))
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
        conflicts.push(FileConflict {
            rel: display_rel.get(rel).cloned().unwrap_or_else(|| rel.clone()),
            copies,
        });
    }
    conflicts.sort_by(|a, b| a.rel.cmp(&b.rel));

    // A chosen keeper that resolves to no current asset means the folders changed
    // between the dry run and this apply (the TOCTOU window): report it, and only
    // quarantine groups whose keeper choice is CONFIRMED — never fall back to
    // auto behind the user's back.
    let asset_path_str = |af: &AssetFiles| af.asset_path.to_string_lossy().to_string();
    let current_paths: HashSet<String> = assets.iter().map(asset_path_str).collect();
    let stale_keepers: Vec<&String> =
        chosen_keepers.iter().filter(|k| !current_paths.contains(*k)).collect();
    for k in &stale_keepers {
        errors.push(format!(
            "Chosen keeper no longer found: {k} — the folders changed since the scan; re-scan and pick again."
        ));
    }
    let have_stale = !stale_keepers.is_empty();

    // --- duplicate / version asset groups: keep one, quarantine the rest ---
    let mut duplicates: Vec<AssetDup> = Vec::new();
    let mut assets_quarantined = 0u64;
    let mut skipped_unconfirmed = 0u64;
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
        let chosen = members
            .iter()
            .copied()
            .find(|&i| chosen_keepers.contains(&asset_path_str(&assets[i])));
        let keeper = chosen.unwrap_or(auto);
        let redundant: Vec<usize> = members.iter().cloned().filter(|&i| i != keeper).collect();
        let exact = members.iter().all(|&m| fp_of[m] == fp_of[keeper]);
        // Per-member apply outcome: (moved, error). Only set when a move was attempted.
        let mut member_state: HashMap<usize, (bool, String)> = HashMap::new();
        let mut fixed = false;
        if !dry && !quarantine.is_empty() {
            let scan_gaps: u64 = members.iter().map(|&m| assets[m].read_errors).sum();
            if scan_gaps > 0 {
                // An incomplete inventory must never drive a quarantine: what
                // looked identical may differ in the unread entries.
                errors.push(format!(
                    "Not quarantining the “{}” group — {scan_gaps} entr{} couldn't be read during the scan, so its inventory may be incomplete.",
                    assets[keeper].label,
                    if scan_gaps == 1 { "y" } else { "ies" }
                ));
            } else if chosen.is_none() && have_stale {
                // The disk changed since the scan AND this group carries no
                // confirmed keeper choice — leave it untouched (see above).
                skipped_unconfirmed += 1;
            } else {
                let qdir = Path::new(&quarantine);
                let mut all_ok = true;
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
                    match move_to_quarantine(&assets[i].asset_path, &target) {
                        Ok(()) => {
                            assets_quarantined += 1;
                            member_state.insert(i, (true, String::new()));
                        }
                        Err(reason) => {
                            all_ok = false;
                            member_state.insert(i, (false, reason));
                        }
                    }
                }
                fixed = all_ok && !redundant.is_empty();
            }
        }
        let mut sorted = members.clone();
        sorted.sort_by(|&a, &b| assets[a].label.cmp(&assets[b].label));
        duplicates.push(AssetDup {
            members: sorted
                .iter()
                .map(|&i| {
                    let (moved, error) =
                        member_state.get(&i).cloned().unwrap_or((false, String::new()));
                    DupMember {
                        label: assets[i].label.clone(),
                        source: assets[i].source_root.clone(),
                        path: asset_path_str(&assets[i]),
                        file_count: filecount[i] as u64,
                        is_zip: assets[i].is_zip,
                        is_keeper: i == keeper,
                        moved,
                        error,
                    }
                })
                .collect(),
            kind: if exact { "exact".into() } else { "version".into() },
            fixed,
        });
    }
    if skipped_unconfirmed > 0 {
        errors.push(format!(
            "{skipped_unconfirmed} duplicate group(s) were left untouched: a chosen keeper vanished since the scan, so only groups with a confirmed keeper choice were applied. Re-scan and apply again."
        ));
    }
    duplicates.sort_by(|a, b| {
        let ka = a.members.iter().find(|m| m.is_keeper).map(|m| &m.label);
        let kb = b.members.iter().find(|m| m.is_keeper).map(|m| &m.label);
        ka.cmp(&kb)
    });
    // Group iteration order is a HashMap's — sort so the report is deterministic.
    errors.sort();

    DedupReport {
        dry_run: dry,
        conflicts,
        duplicates,
        assets_quarantined,
        backup_dir: quarantine,
        errors,
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

        let af = collect_asset_files(&outer, false).unwrap();
        let mut rels: Vec<String> = af.files.iter().map(|(p, _)| p.clone()).collect();
        rels.sort();
        assert_eq!(rels, vec!["Runtime/Textures/t.png", "data/Meipe/morph.dsf"]);
        assert_eq!(af.read_errors, 0);
        // Scan-only collect keeps no archive handles or temp inflations.
        assert!(af.zip_entries.is_empty() && af.nested_temps.is_empty());

        // Collecting WITH handles records each entry's physical archive + index
        // (the nested package's entries point at a kept temp, not the outer zip).
        let af = collect_asset_files(&outer, true).unwrap();
        assert_eq!(af.zip_entries.len(), af.files.len());
        assert_eq!(af.nested_temps.len(), 1);
        let temp_path = &af.nested_temps[0].0;
        assert!(temp_path.is_file(), "the nested inflation is kept alive");
        assert!(af.zip_entries.iter().all(|(apath, _)| apath == temp_path));

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn move_to_quarantine_leaves_no_debris_when_the_move_fails() {
        let base = unique_temp_dir("quarantine_fail");
        fs::create_dir_all(&base).unwrap();
        // A vanished source (e.g. deleted mid-scan): rename and copy both fail —
        // the failure must carry a reason AND the quarantine target must not be
        // left behind, or the next run's name-collision loop would mint " (1)"
        // duplicates.
        let missing = base.join("not-there.zip");
        let dst = base.join("q").join("not-there.zip");
        let err = move_to_quarantine(&missing, &dst).unwrap_err();
        assert!(err.contains("copy to quarantine failed"), "reason surfaces: {err}");
        assert!(!dst.exists(), "a failed move must not leave a quarantine copy");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn move_to_quarantine_refuses_a_shallow_source_with_a_reason() {
        // An asset directly in a drive/share root used to be silently
        // unquarantinable — the rail's refusal must surface as a reason now.
        // C:\Users exists and has fewer than two Normal segments.
        let err = move_to_quarantine(Path::new("C:\\Users"), Path::new("C:\\q\\Users")).unwrap_err();
        assert!(err.starts_with("refused:"), "reason surfaces: {err}");
    }

    #[test]
    fn content_fingerprint_folds_sizes_and_resists_duplicate_cancellation() {
        let a = vec![("data/x.dsf".to_string(), 10u64), ("Runtime/t.png".to_string(), 20u64)];
        let b = vec![("Runtime/t.png".to_string(), 20u64), ("data/x.dsf".to_string(), 10u64)];
        assert_eq!(content_fingerprint(&a), content_fingerprint(&b), "order-independent");
        // Same paths, one size differs → NOT exact.
        let c = vec![("data/x.dsf".to_string(), 11u64), ("Runtime/t.png".to_string(), 20u64)];
        assert_ne!(content_fingerprint(&a), content_fingerprint(&c), "sizes are part of it");
        // Case variants are the same library file (NTFS).
        let d = vec![("DATA/X.dsf".to_string(), 10u64), ("runtime/T.png".to_string(), 20u64)];
        assert_eq!(content_fingerprint(&a), content_fingerprint(&d), "case-folded");
        // A duplicated entry must CHANGE the fingerprint (the old XOR cancelled).
        let e = vec![
            ("data/x.dsf".to_string(), 10u64),
            ("data/x.dsf".to_string(), 10u64),
            ("Runtime/t.png".to_string(), 20u64),
        ];
        assert_ne!(content_fingerprint(&a), content_fingerprint(&e), "duplicates can't cancel");
    }

    #[cfg(windows)]
    #[test]
    fn move_to_quarantine_moves_a_link_root_itself_never_the_target() {
        // A junction AS the asset root: the LINK moves, its target is untouched —
        // the old path followed the link (`is_dir()`), and a cross-drive
        // quarantine would deep-copy the target's content and then delete.
        let base = unique_temp_dir("quarantine_link_root");
        let target = base.join("target");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("big.bin"), b"payload").unwrap();
        let link = base.join("src").join("LinkedAsset");
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        let status = std::process::Command::new("cmd")
            .arg("/C")
            .arg("mklink")
            .arg("/J")
            .arg(&link)
            .arg(&target)
            .status();
        if !status.map(|s| s.success()).unwrap_or(false) {
            return; // junction creation unavailable in this environment
        }
        let dst = base.join("q").join("LinkedAsset");
        move_to_quarantine(&link, &dst).unwrap();
        assert!(fs::symlink_metadata(&link).is_err(), "the link itself moved away");
        assert!(
            fs::symlink_metadata(&dst).unwrap().file_type().is_symlink(),
            "quarantine holds the LINK, not a materialized copy"
        );
        assert_eq!(fs::read(target.join("big.bin")).unwrap(), b"payload", "target untouched");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn dedup_dedupes_a_source_listed_twice_under_variant_spellings() {
        // The same physical folder listed twice (verbatim + a case variant):
        // before the canonical-fold + dedupe, every asset became an exact
        // duplicate of ITSELF and apply moved the only physical copy to
        // quarantine while reporting `fixed: true`.
        let base = unique_temp_dir("dedup_dup_source");
        let source = base.join("assets");
        let asset = source.join("Thing");
        fs::create_dir_all(asset.join("data")).unwrap();
        fs::write(asset.join("data").join("x.dsf"), b"x").unwrap();
        let quarantine = base.join("q");
        fs::create_dir_all(&quarantine).unwrap();
        let spelled = source.to_string_lossy().to_string();
        let report = dedup_daz_assets(DedupRequest {
            sources: vec![spelled.clone(), spelled.to_uppercase(), spelled],
            dry_run: false,
            accepted: vec![],
            keepers: vec![],
            quarantine: quarantine.to_string_lossy().to_string(),
        });
        assert!(report.duplicates.is_empty(), "an asset must not duplicate itself");
        assert!(report.conflicts.is_empty());
        assert_eq!(report.assets_quarantined, 0);
        assert!(asset.join("data").join("x.dsf").is_file(), "the only copy stays put");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn dedup_refuses_a_source_inside_another_source() {
        // A nested source is collected as one "asset" of its parent (via
        // find_content_level), grouping the child source folder against its own
        // assets — apply could quarantine the ENTIRE child source. Hard error
        // instead, like the quarantine rail.
        let base = unique_temp_dir("dedup_nested_source");
        let outer = base.join("assets");
        let child = outer.join("more assets");
        let asset = child.join("Thing");
        fs::create_dir_all(asset.join("data")).unwrap();
        fs::write(asset.join("data").join("x.dsf"), b"x").unwrap();
        let quarantine = base.join("q");
        fs::create_dir_all(&quarantine).unwrap();
        let report = dedup_daz_assets(DedupRequest {
            sources: vec![
                outer.to_string_lossy().to_string(),
                child.to_string_lossy().to_string(),
            ],
            dry_run: false,
            accepted: vec![],
            keepers: vec![],
            quarantine: quarantine.to_string_lossy().to_string(),
        });
        assert_eq!(report.errors.len(), 1, "hard containment error: {:?}", report.errors);
        assert!(
            report.errors[0].contains("must not contain"),
            "error: {}",
            report.errors[0]
        );
        assert!(report.duplicates.is_empty() && report.conflicts.is_empty(), "nothing scanned");
        assert_eq!(report.assets_quarantined, 0);
        assert!(asset.join("data").join("x.dsf").is_file(), "nothing moved");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn dedup_refuses_a_quarantine_inside_a_source() {
        let base = unique_temp_dir("dedup_containment");
        let source = base.join("assets");
        let quarantine = source.join("_quarantine");
        fs::create_dir_all(&quarantine).unwrap();
        let report = dedup_daz_assets(DedupRequest {
            sources: vec![source.to_string_lossy().to_string()],
            dry_run: false,
            accepted: vec![],
            keepers: vec![],
            quarantine: quarantine.to_string_lossy().to_string(),
        });
        assert_eq!(report.errors.len(), 1, "hard containment error");
        assert!(report.errors[0].contains("must be outside"), "error: {}", report.errors[0]);
        assert!(report.duplicates.is_empty() && report.conflicts.is_empty(), "nothing scanned");
        assert_eq!(report.assets_quarantined, 0);
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
