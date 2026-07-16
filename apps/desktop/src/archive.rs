use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::fsutil::lock_dest;

// --- Decompression-bomb bounds ----------------------------------------------
// Users share Daz asset zips with each other, so a hostile archive is in scope.
// Wherever entries are actually INFLATED, the output is bounded per archive: a
// byte budget of max(INFLATE_RATIO × the archive's compressed file size,
// INFLATE_FLOOR) plus an entry-count cap. Central-directory-only scans
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

    /// Budget for a NESTED archive found inside this one — same formula, keyed
    /// to the inner zip's compressed size, labelled through the outer archive.
    pub(crate) fn nested(&self, entry_path: &str, compressed_len: u64) -> Self {
        Self::new(format!("{} → {entry_path}", self.label), compressed_len)
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
/// OUTER archive's budget (the inner archive then gets its own via `nested`).
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
/// path and uncompressed size. Setting up `by_index` reads only the local header —
/// no decompression happens here.
pub(crate) fn zip_file_entries(archive: &mut zip::ZipArchive<fs::File>) -> Vec<(usize, String, u64)> {
    let mut entries = Vec::new();
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
    entries
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
}
