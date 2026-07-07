use std::fs;
use std::path::{Path, PathBuf};

use crate::fsutil::lock_dest;

/// Inflate one archive entry to `dest_path` (creating parent dirs as needed).
pub(crate) fn extract_zip_entry(
    archive: &mut zip::ZipArchive<fs::File>,
    idx: usize,
    dest_path: &Path,
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
    std::io::copy(&mut entry, &mut out)?;
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

/// Inflate the nested zip entry `idx` to a unique temp file.
pub(crate) fn extract_nested_zip(
    archive: &mut zip::ZipArchive<fs::File>,
    idx: usize,
) -> std::io::Result<TempFile> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!("dth-nested-{}-{n}.zip", std::process::id()));
    let tmp = TempFile(path);
    extract_zip_entry(archive, idx, &tmp.0)?;
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

/// Extract every file entry of `archive` into `dest`, preserving its tree. Skips
/// zip-slip paths (`enclosed_name`); directory entries are created lazily.
pub(crate) fn extract_archive<R: std::io::Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    dest: &Path,
) -> std::io::Result<()> {
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        let rel = match entry.enclosed_name() {
            Some(p) => p,
            None => continue,
        };
        let out = dest.join(&rel);
        if entry.is_dir() {
            fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut f = fs::File::create(&out)?;
        std::io::copy(&mut entry, &mut f)?;
    }
    Ok(())
}
