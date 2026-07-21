use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::content::{zip_dir_level, CONTENT_FOLDERS, META_FOLDERS};
use crate::fsutil::lock_dest;
use crate::report::io_detail;

// --- Decompression-bomb bounds ----------------------------------------------
// Users share Daz asset zips with each other, so a hostile archive is in scope.
// Wherever entries are actually INFLATED, the output is bounded per TOP-LEVEL
// archive: a byte budget of max(INFLATE_RATIO × the archive's compressed file
// size, INFLATE_FLOOR) plus an entry-count cap. Nested zips are charged against
// the same budget — one budget bounds the whole tree, so a crafted wrapper can't
// mint a fresh ≥floor allowance per inner zip. Central-directory-only scans
// (`zip_file_entries`) inflate nothing and carry no budget.

/// Total inflated bytes allowed per compressed byte — generous for any real Daz
/// asset (typical zips inflate well under 10×), fatal for a crafted bomb.
const INFLATE_RATIO: u64 = 100;
/// Minimum byte budget, so tiny archives still get a sane allowance: 1 GiB.
const INFLATE_FLOOR: u64 = 1024 * 1024 * 1024;
/// Most entries an archive may hold before we refuse to extract from it.
const MAX_ZIP_ENTRIES: usize = 100_000;

/// A per-archive inflation budget, threaded through every path that inflates
/// entries so the running total covers the WHOLE archive, not just one entry.
pub(crate) struct InflateBudget {
    /// Names the archive in a breach error.
    label: String,
    /// Total inflated bytes this archive may produce.
    max_bytes: u64,
    /// Running total of bytes inflated so far (across all entries).
    inflated: u64,
}

impl InflateBudget {
    /// Budget for an archive whose compressed form is `compressed_len` bytes:
    /// max(100 × compressed, 1 GiB).
    pub(crate) fn new(label: impl Into<String>, compressed_len: u64) -> Self {
        Self::with_max_bytes(label, compressed_len.saturating_mul(INFLATE_RATIO).max(INFLATE_FLOOR))
    }

    /// Budget with an explicit byte cap. Production goes through `new`; tests
    /// inject a tiny cap here instead of crafting a >1 GiB fixture.
    fn with_max_bytes(label: impl Into<String>, max_bytes: u64) -> Self {
        Self { label: label.into(), max_bytes, inflated: 0 }
    }

    /// Refuse an archive with an absurd entry count before inflating anything.
    pub(crate) fn check_entry_count(&self, entries: usize) -> std::io::Result<()> {
        if entries > MAX_ZIP_ENTRIES {
            return Err(std::io::Error::other(format!(
                "refusing to extract {}: {entries} entries exceed the {MAX_ZIP_ENTRIES}-entry limit",
                self.label
            )));
        }
        Ok(())
    }

    /// Charge `n` freshly inflated bytes against the budget; errors on breach.
    fn charge(&mut self, n: u64) -> std::io::Result<()> {
        self.inflated = self.inflated.saturating_add(n);
        if self.inflated > self.max_bytes {
            return Err(std::io::Error::other(format!(
                "refusing to extract {}: inflated output exceeds its {} byte budget (possible decompression bomb)",
                self.label, self.max_bytes
            )));
        }
        Ok(())
    }
}

/// `std::io::copy`, charging the archive's inflate budget as bytes flow.
fn copy_bounded(
    reader: &mut impl Read,
    writer: &mut impl Write,
    budget: &mut InflateBudget,
) -> std::io::Result<()> {
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            return Ok(());
        }
        budget.charge(n as u64)?;
        writer.write_all(&buf[..n])?;
    }
}

/// Inflate one archive entry to `dest_path` (creating parent dirs as needed),
/// bounded by the archive's inflate budget. A mid-entry failure (including a
/// budget breach) removes the partial file rather than leaving it half-written.
pub(crate) fn extract_zip_entry(
    archive: &mut zip::ZipArchive<fs::File>,
    idx: usize,
    dest_path: &Path,
    budget: &mut InflateBudget,
) -> std::io::Result<()> {
    let mut entry = archive
        .by_index(idx)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }
    // Serialize writes to the same library file across assets (see lock_dest).
    let _guard = lock_dest(dest_path);
    let mut out = fs::File::create(dest_path)?;
    if let Err(e) = copy_bounded(&mut entry, &mut out, budget) {
        drop(out);
        let _ = fs::remove_file(dest_path);
        return Err(e);
    }
    Ok(())
}

/// How deep to follow zip-in-zip packaging: some stores wrap the real DIM package
/// zip in an outer download zip (beside a `.dsx` manifest and PDFs) that holds no
/// content folders itself. Two levels covers even a wrapped wrapper.
pub(crate) const NESTED_ZIP_DEPTH: u32 = 2;

/// A temp file that deletes itself when dropped. Nested zips are inflated to disk
/// because an archive can't be read from a non-seekable inner entry stream.
pub(crate) struct TempFile(pub(crate) PathBuf);
impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// Inflate the nested zip entry `idx` to a unique temp file, charged against the
/// OUTER archive's budget (the inner archive's entries then charge that same
/// budget — the whole nested tree shares one allowance).
pub(crate) fn extract_nested_zip(
    archive: &mut zip::ZipArchive<fs::File>,
    idx: usize,
    budget: &mut InflateBudget,
) -> std::io::Result<TempFile> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("dth-nested-{}-{n}.zip", std::process::id()));
    let tmp = TempFile(path);
    extract_zip_entry(archive, idx, &tmp.0, budget)?;
    Ok(tmp)
}

/// Central-directory pass over an archive: each file entry's index, normalized
/// path and uncompressed size, plus how many entries could NOT be read (they are
/// omitted from the list — a non-zero count means the inventory is incomplete,
/// which quarantine decisions must refuse). Setting up `by_index` reads only the
/// local header — no decompression happens here.
pub(crate) fn zip_file_entries(
    archive: &mut zip::ZipArchive<fs::File>,
) -> (Vec<(usize, String, u64)>, u64) {
    let mut entries = Vec::new();
    let mut skipped = 0u64;
    for i in 0..archive.len() {
        let entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if entry.is_dir() {
            continue;
        }
        // enclosed_name rejects absolute / `..` paths (zip-slip). A rejected
        // name is an entry the inventory DROPPED — count it, or a malicious/
        // broken archive still reads as a complete inventory to the
        // read_errors gates (install would report the rest "already installed",
        // dedup could quarantine on partial data).
        let rel = match entry.enclosed_name() {
            Some(p) => p.to_string_lossy().replace('\\', "/"),
            None => {
                skipped += 1;
                continue;
            }
        };
        entries.push((i, rel, entry.size()));
    }
    (entries, skipped)
}

/// The per-content-entry callback of `walk_zip_content`: the archive that owns
/// the entry (so an installer can inflate it), the shared budget, the PHYSICAL
/// path of that archive (the top-level `.zip`, or the nested temp inflation the
/// entry lives in — only durable when the caller keeps the temps, see
/// `walk_zip_content`'s `keep_temps`), the entry's index, its content-root-
/// relative path, and its uncompressed size.
pub(crate) type ZipEntryEmit<'a> = dyn FnMut(
        &mut zip::ZipArchive<fs::File>,
        &mut InflateBudget,
        &Path,
        usize,
        &str,
        u64,
    ) -> Result<(), String>
    + 'a;

/// The ONE shared nested-zip descent + content-level walk (install's diff and
/// dedup's collect used to hand-roll it twice): find the archive's Daz content
/// level — real content folders first, descending into nested package zips
/// (wrapper downloads) when the archive has none of its own, `Documentation`
/// as the last resort — and call `emit` for every content entry.
///
/// The two callers keep deliberately different error postures and budgets ride
/// the whole tree (a crafted wrapper can't mint a fresh allowance per inner
/// zip) — all of that travels in {@link ZipWalkState} below.
///
/// The state a `walk_zip_content` descent threads through unchanged — one
/// struct so the walk's signature stays a walk (archive, where it lives, how
/// deep, state, emit) instead of a parameter list that grows with every
/// posture knob.
pub(crate) struct ZipWalkState<'a> {
    /// The TOP-LEVEL archive's inflate budget; nested archives share it (see
    /// `walk_zip_content`'s doc).
    pub(crate) budget: &'a mut InflateBudget,
    /// Install posture: hard-error on an unreadable nested zip. Dedup's
    /// lenient collect counts it in `read_errors` instead.
    pub(crate) strict: bool,
    /// Central-directory entries + nested zips that couldn't be read.
    pub(crate) read_errors: &'a mut u64,
    /// When `Some`, every nested temp inflation whose tree held content is
    /// handed to the caller INSTEAD of being deleted at the end of the walk —
    /// so a real install can extract from it later without inflating the
    /// nested package zip a second time. `None` keeps delete-on-drop.
    pub(crate) keep_temps: Option<&'a mut Vec<TempFile>>,
}

/// `archive_path` is the physical file `archive` was opened from — passed
/// through to `emit` (nested descents pass their temp file's path instead).
/// Returns whether a content level was found here or in a nested zip.
pub(crate) fn walk_zip_content(
    archive: &mut zip::ZipArchive<fs::File>,
    archive_path: &Path,
    depth: u32,
    state: &mut ZipWalkState,
    emit: &mut ZipEntryEmit,
) -> Result<bool, String> {
    let (entries, skipped) = zip_file_entries(archive);
    *state.read_errors += skipped;
    let paths: Vec<&str> = entries.iter().map(|(_, p, _)| p.as_str()).collect();
    let content = zip_dir_level(&paths, &CONTENT_FOLDERS);
    if content.is_none() && depth > 0 {
        let mut found = false;
        for (idx, path, _) in &entries {
            if !path.to_ascii_lowercase().ends_with(".zip") {
                continue;
            }
            let nested = (|| -> Result<(bool, TempFile), String> {
                let tmp = extract_nested_zip(archive, *idx, state.budget)
                    .map_err(|e| io_detail(&format!("unpack {path}"), &e))?;
                let file =
                    fs::File::open(&tmp.0).map_err(|e| io_detail(&format!("open {path}"), &e))?;
                let mut inner =
                    zip::ZipArchive::new(file).map_err(|e| format!("unzip {path} failed: {e}"))?;
                // The inner archive shares the OUTER budget (see the fn doc).
                state.budget.check_entry_count(inner.len()).map_err(|e| e.to_string())?;
                let f = walk_zip_content(&mut inner, &tmp.0, depth - 1, state, emit)?;
                Ok((f, tmp))
            })();
            match nested {
                Ok((f, tmp)) => {
                    found |= f;
                    if f {
                        // Hand the inflation to the caller (see `keep_temps`);
                        // otherwise `tmp` drops here and deletes itself.
                        if let Some(sink) = state.keep_temps.as_deref_mut() {
                            sink.push(tmp);
                        }
                    }
                }
                Err(e) if state.strict => return Err(e),
                Err(_) => *state.read_errors += 1,
            }
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
    for (idx, p, sz) in &entries {
        // Keep only entries under <content-root>/<one of the chosen folders>.
        let sub = match p.strip_prefix(&prefix) {
            Some(s) => s,
            None => continue,
        };
        let first = sub.split('/').next().unwrap_or("");
        if !folders.iter().any(|f| f == first) {
            continue;
        }
        emit(archive, state.budget, archive_path, *idx, sub, *sz)?;
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_formula_is_ratio_with_a_floor() {
        // 100 × 20 MiB = 2000 MiB > the 1 GiB floor → the ratio wins.
        let big = InflateBudget::new("big.zip", 20 * 1024 * 1024);
        assert_eq!(big.max_bytes, 100 * 20 * 1024 * 1024);
        // A tiny archive gets the floor, not 100 × a few bytes.
        let small = InflateBudget::new("small.zip", 10);
        assert_eq!(small.max_bytes, INFLATE_FLOOR);
    }

    #[test]
    fn entry_count_cap_refuses_absurd_archives() {
        let budget = InflateBudget::with_max_bytes("many.zip", u64::MAX);
        assert!(budget.check_entry_count(MAX_ZIP_ENTRIES).is_ok());
        let err = budget.check_entry_count(MAX_ZIP_ENTRIES + 1).unwrap_err();
        assert!(err.to_string().contains("many.zip"), "error must name the archive: {err}");
    }

    #[test]
    fn zip_slip_names_count_as_skipped_entries() {
        use crate::testutil::{unique_temp_dir, write_zip};
        // An entry whose name escapes the archive (zip-slip) is rejected by
        // enclosed_name — it must COUNT as skipped, so the archive reads as an
        // INCOMPLETE inventory to the read_errors gates instead of a clean one.
        let base = unique_temp_dir("zip_slip_skipped");
        std::fs::create_dir_all(&base).unwrap();
        let path = base.join("evil.zip");
        write_zip(
            &path,
            &[("data/ok.dsf", b"ok".as_slice()), ("../evil.dsf", b"evil".as_slice())],
        );
        let mut archive = zip::ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
        let (entries, skipped) = zip_file_entries(&mut archive);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].1, "data/ok.dsf");
        assert_eq!(skipped, 1, "the rejected zip-slip name is counted, not silently dropped");
        let _ = std::fs::remove_dir_all(&base);
    }
}
