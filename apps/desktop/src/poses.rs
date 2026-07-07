use serde::Serialize;
use std::fs;
use std::path::Path;

// --- Pose-asset frame counts ----------------------------------------------
// A Daz pose preset (.duf) is DSON — JSON, sometimes gzip-compressed. The ROM
// length a preset occupies on the timeline is the highest animation key time ×
// the DTH 30 fps (+1 for the 0-based count). Measuring this on the fly means we
// never hard-code frame counts and custom assets work the same as DTH ones.

const DTH_FPS: f64 = 30.0;

#[derive(Serialize)]
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
