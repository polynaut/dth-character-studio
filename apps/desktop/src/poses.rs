use serde::Serialize;
use std::fs;
use std::path::Path;

// --- Pose-asset frame counts ----------------------------------------------
// A Daz pose preset (.duf) is DSON — JSON, sometimes gzip-compressed. The ROM
// length a preset occupies on the timeline is the highest animation key time ×
// the DTH 30 fps (+1 for the 0-based count). Measuring this on the fly means we
// never hard-code frame counts and custom assets work the same as DTH ones.

const DTH_FPS: f64 = 30.0;

// Decompression-bomb bound for gzipped presets — same class of hardening as the
// zip paths (see archive.rs InflateBudget): inflated output is capped at
// max(INFLATE_RATIO × the compressed file size, INFLATE_FLOOR). A real pose
// preset is small JSON that inflates well under 100×; a crafted bomb is not.
const INFLATE_RATIO: u64 = 100;
/// Minimum byte budget, so tiny presets still get a sane allowance: 256 MiB.
const INFLATE_FLOOR: u64 = 256 * 1024 * 1024;

/// Gunzip a compressed `.duf`'s bytes, refusing inflated output beyond
/// `max_bytes`. The error names the offending file.
fn gunzip_bounded(raw: &[u8], path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut out = Vec::new();
    // Read at most one byte past the budget: landing there means the stream
    // would inflate beyond it (reading to the true end could allocate without
    // bound — the whole point of the cap).
    flate2::read::GzDecoder::new(raw)
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut out)
        .map_err(|e| format!("decompress {}: {}", path.display(), e))?;
    if out.len() as u64 > max_bytes {
        return Err(format!(
            "refusing to decompress {}: inflated output exceeds its {max_bytes}-byte budget (possible decompression bomb)",
            path.display()
        ));
    }
    Ok(out)
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
pub(crate) struct PoseAssetFrames {
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
        let budget = (raw.len() as u64).saturating_mul(INFLATE_RATIO).max(INFLATE_FLOOR);
        gunzip_bounded(&raw, path, budget)?
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
pub fn pose_asset_frames(paths: Vec<String>) -> Vec<PoseAssetFrames> {
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
pub fn scan_duf_files(folder: String) -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::unique_temp_dir;
    use std::io::Write;

    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(data).unwrap();
        enc.finish().unwrap()
    }

    #[test]
    fn gunzip_bounded_fails_loud_when_the_budget_is_breached() {
        // 4 KiB of zeros compresses to a few dozen bytes — against a 64-byte
        // injected cap (a bomb in miniature) the inflate must refuse.
        let compressed = gzip(&[0u8; 4096]);
        let err = gunzip_bounded(&compressed, Path::new("X:/poses/bomb.duf"), 64).unwrap_err();
        assert!(err.contains("bomb.duf"), "error must name the file: {err}");
        assert!(err.contains("decompression bomb"), "error: {err}");
    }

    #[test]
    fn gunzip_bounded_within_budget_round_trips() {
        let data = br#"{"scene":{"animations":[]}}"#;
        let out = gunzip_bounded(&gzip(data), Path::new("ok.duf"), 1024).unwrap();
        assert_eq!(out, data);
    }

    #[test]
    fn duf_frame_count_still_reads_a_gzipped_preset() {
        // End-to-end through the production budget formula: a normal gzipped
        // preset stays far below max(100 × compressed, 256 MiB).
        let dir = unique_temp_dir("gz_duf");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pose.duf");
        let json = br#"{"scene":{"animations":[{"keys":[[0,0],[1.0,1]]}]}}"#;
        fs::write(&path, gzip(json)).unwrap();
        // Highest key at 1.0 s × 30 fps + 1 (0-based count) = 31 frames.
        assert_eq!(duf_frame_count(&path).unwrap(), 31);
        let _ = fs::remove_dir_all(&dir);
    }
}
