use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::fsutil::{walk_dir, DirVisitor};

// --- Pose-asset frame counts ----------------------------------------------
// A Daz pose preset (.duf) is DSON — JSON, sometimes gzip-compressed. The ROM
// length a preset occupies on the timeline is the highest animation key time ×
// the DTH 30 fps (+1 for the 0-based count). Measuring this on the fly means we
// never hard-code frame counts and custom assets work the same as DTH ones.

const DTH_FPS: f64 = 30.0;

// Decompression-bomb bound for gzipped `.duf`s — same class of hardening as the
// zip paths (see archive.rs InflateBudget): inflated output is capped at
// max(INFLATE_RATIO × the compressed file size, a floor). A real pose preset is
// small JSON that inflates well under 100×; a crafted bomb is not.
const INFLATE_RATIO: u64 = 100;
/// Minimum inflate budget for POSE-PRESET reads (frame counting): presets are
/// small JSON, so tiny files get 32 MiB — not a quarter-gigabyte heap allowance
/// per file (the count runs across MANY presets, now in parallel).
const PRESET_INFLATE_FLOOR: u64 = 32 * 1024 * 1024;
/// Minimum inflate budget for SCENE reads: full scene `.duf`s are legitimately
/// tens of MB of DSON, so the larger 256 MiB floor stays here only.
const SCENE_INFLATE_FLOOR: u64 = 256 * 1024 * 1024;

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

/// Read a `.duf` (DSON) into JSON — plain or gzip-compressed (detected via the
/// magic bytes), with the decompression-bomb budget applied.
/// `inflate_floor` is the caller's minimum budget: preset reads use the small
/// floor, scene reads the large one (see the constants above).
fn read_duf_json(path: &Path, inflate_floor: u64) -> Result<serde_json::Value, String> {
    let raw = fs::read(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let bytes = if raw.len() >= 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let budget = (raw.len() as u64).saturating_mul(INFLATE_RATIO).max(inflate_floor);
        gunzip_bounded(&raw, path, budget)?
    } else {
        raw
    };
    serde_json::from_slice(&bytes).map_err(|e| format!("parse {}: {}", path.display(), e))
}

/// Frames a single `.duf` occupies: `round(maxKeyTime × 30) + 1`.
fn duf_frame_count(path: &Path) -> Result<u32, String> {
    let json = read_duf_json(path, PRESET_INFLATE_FLOOR)?;
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
    // The float→int cast saturates at u32::MAX for an absurd key time in a
    // corrupt/hostile .duf; `+ 1` would then overflow (debug panic / release
    // wrap to 0 frames) — saturate instead.
    Ok(((max_t * DTH_FPS).round() as u32).saturating_add(1))
}

/// Measure the frame length of each `.duf` — in parallel (each file is an
/// independent read/inflate/parse; rayon's pool bounds the fan-out and `collect`
/// preserves the input order). Each result carries its own error so the caller
/// can hard-fail on exactly the asset(s) that couldn't be read.
// `(async)`: reads (possibly many) .duf files, often on a network share — a sync
// command would do that on the main thread and freeze the UI.
#[tauri::command(async)]
pub fn pose_asset_frames(paths: Vec<String>) -> Vec<PoseAssetFrames> {
    paths
        .into_par_iter()
        .map(|path| match duf_frame_count(Path::new(&path)) {
            Ok(frames) => PoseAssetFrames { path, frames, error: String::new() },
            Err(error) => PoseAssetFrames { path, frames: 0, error },
        })
        .collect()
}

// --- Scene wearables (conformed items) -------------------------------------
// A scene `.duf`'s `scene.nodes[]` carries every node's `label` and, for fitted
// wearables, a `conform_target` ref ("#Genesis9"). Reading them OUTSIDE Daz is
// what feeds the groom-item suggestions: the fitted followers of the figure are
// exactly the candidates for "keep this out of the export".

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneWearable {
    /// The node's DSON id — what other nodes' `conformTarget` refs point at
    /// (URL-encoded in refs; returned raw here).
    id: String,
    /// The label shown in Daz's Scene pane — what the groom list stores.
    label: String,
    /// Raw DSON ref of the fit target (e.g. "#Genesis9" or another wearable's id).
    conform_target: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneFigure {
    /// The figure node's DSON id — "Genesis9", "Genesis8_1Female", … The create
    /// dialog maps it to a Genesis version (+ gender for the gendered gens).
    id: String,
    /// The label shown in Daz's Scene pane (e.g. "Genesis 9").
    label: String,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
pub(crate) struct SceneWearables {
    items: Vec<SceneWearable>,
    /// The base figure node, when the scene has a recognizable one — the create
    /// dialog's Genesis/gender auto-select source. `None` (→ `null`) otherwise.
    figure: Option<SceneFigure>,
    /// Empty on success; otherwise why the scene couldn't be read.
    error: String,
}

/// A node's id/name begins (case-insensitively) with "Genesis" — how we spot the
/// base figure among the scene nodes.
fn looks_like_figure(s: &str) -> bool {
    s.get(..7).is_some_and(|p| p.eq_ignore_ascii_case("genesis"))
}

/// The conformed wearables of a scene `.duf` AND its base figure node, in one
/// parse. The figure is the first NON-conformed node whose id/name looks like a
/// Genesis figure — wearables named "Genesis…" always carry a `conform_target`,
/// so this can't mistake one for the figure, and it finds a bare figure (a scene
/// with no followers) all the same.
fn duf_scene(path: &Path) -> Result<(Vec<SceneWearable>, Option<SceneFigure>), String> {
    let json = read_duf_json(path, SCENE_INFLATE_FLOOR)?;
    let nodes = json
        .get("scene")
        .and_then(|s| s.get("nodes"))
        .and_then(|n| n.as_array())
        .ok_or_else(|| format!("{}: no scene.nodes (is it a scene file?)", path.display()))?;
    let items = nodes
        .iter()
        .filter_map(|node| {
            let conform = node.get("conform_target").and_then(|v| v.as_str())?;
            let id = node.get("id").and_then(|v| v.as_str()).unwrap_or_default();
            let label = node
                .get("label")
                .and_then(|v| v.as_str())
                .or_else(|| node.get("name").and_then(|v| v.as_str()))
                .unwrap_or(id);
            Some(SceneWearable {
                id: id.to_string(),
                label: label.to_string(),
                conform_target: conform.to_string(),
            })
        })
        .collect();
    let figure = nodes.iter().find_map(|node| {
        if node.get("conform_target").is_some() {
            return None;
        }
        let id = node.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let name = node.get("name").and_then(|v| v.as_str()).unwrap_or_default();
        if !looks_like_figure(id) && !looks_like_figure(name) {
            return None;
        }
        let label = node
            .get("label")
            .and_then(|v| v.as_str())
            .or_else(|| node.get("name").and_then(|v| v.as_str()))
            .unwrap_or(id);
        Some(SceneFigure { id: id.to_string(), label: label.to_string() })
    });
    Ok((items, figure))
}

/// The fitted (conformed) items of a scene `.duf` and its base figure node — the
/// groom-suggestion source (items) and the create dialog's Genesis auto-select
/// source (figure). Never throws: an unreadable scene returns an empty list +
/// no figure with the reason in `error`, so callers degrade instead of breaking.
#[tauri::command(async)]
pub fn scene_wearables(path: String) -> SceneWearables {
    match duf_scene(Path::new(&path)) {
        Ok((items, figure)) => SceneWearables { items, figure, error: String::new() },
        Err(error) => SceneWearables { items: Vec::new(), figure: None, error },
    }
}

/// Recursively collect every `.duf` under `folder`, as paths relative to it
/// ('/'-separated), via the ONE shared walker (`fsutil::walk_dir`) — so this
/// scan carries the same dir-link policy as every other walk (a junction/
/// symlink is a leaf, never followed). The frontend classifies these into pose
/// assets on each open / release change — there's no on-disk catalog to build
/// or go stale. One native walk replaces the old per-directory JS round-trips
/// (much faster on a network share). Lenient visitor: unreadable subfolders
/// (locked / permission / network) are skipped so one bad directory can't fail
/// the whole scan.
#[tauri::command(async)]
pub fn scan_duf_files(folder: String) -> Vec<String> {
    struct DufCollect(Vec<String>);
    impl DirVisitor for DufCollect {
        fn file(&mut self, _entry: &fs::DirEntry, rel: &Path) -> std::io::Result<()> {
            if rel.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("duf")) {
                self.0.push(rel.to_string_lossy().replace('\\', "/"));
            }
            Ok(())
        }
        fn unreadable(&mut self, _path: &Path, _e: std::io::Error) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut v = DufCollect(Vec::new());
    let _ = walk_dir(Path::new(&folder), &mut v); // visitor never errors
    v.0
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
    fn scene_wearables_lists_conformed_items_and_fails_soft() {
        let dir = unique_temp_dir("scene_duf");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("scene.duf");
        let json = br##"{"scene":{"nodes":[
            {"id":"Genesis9","label":"Genesis 9"},
            {"id":"Black Tie Cap_1529","label":"dForce Black Tie Cap","conform_target":"#Genesis9"},
            {"id":"Black Tie Hair_3297440","label":"dForce Black Tie Hair Base","conform_target":"#Black%20Tie%20Cap_1529"}
        ]}}"##;
        fs::write(&path, gzip(json)).unwrap();
        let result = scene_wearables(path.to_string_lossy().to_string());
        assert_eq!(result.error, "");
        // Only the conformed items — the figure itself is not a wearable.
        assert_eq!(result.items.len(), 2);
        assert_eq!(result.items[0].label, "dForce Black Tie Cap");
        assert_eq!(result.items[0].conform_target, "#Genesis9");
        assert_eq!(result.items[1].conform_target, "#Black%20Tie%20Cap_1529");
        // The base figure is surfaced separately (it has no conform_target).
        let figure = result.figure.expect("figure detected");
        assert_eq!(figure.id, "Genesis9");
        assert_eq!(figure.label, "Genesis 9");
        // An unreadable path degrades to an empty list + no figure + error.
        let missing = scene_wearables(dir.join("nope.duf").to_string_lossy().to_string());
        assert!(missing.items.is_empty());
        assert!(missing.figure.is_none());
        assert!(missing.error.contains("nope.duf"), "error: {}", missing.error);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scene_wearables_finds_a_bare_figure_with_no_wearables() {
        // The common case for this tool: a scene that is just the figure — no
        // hair/clothes, so no wearables to infer from. The figure must still
        // surface (id names the generation + gender for the gendered gens).
        let dir = unique_temp_dir("scene_bare");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("bare.duf");
        let json = br##"{"scene":{"nodes":[
            {"id":"Genesis8Male","name":"Genesis8Male","label":"Genesis 8 Male"}
        ]}}"##;
        fs::write(&path, gzip(json)).unwrap();
        let result = scene_wearables(path.to_string_lossy().to_string());
        assert_eq!(result.error, "");
        assert!(result.items.is_empty());
        assert_eq!(result.figure.expect("bare figure detected").id, "Genesis8Male");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_duf_files_collects_recursively_with_forward_slashes() {
        let dir = unique_temp_dir("scan_duf");
        fs::create_dir_all(dir.join("sub").join("deep")).unwrap();
        fs::write(dir.join("a.duf"), b"x").unwrap();
        fs::write(dir.join("sub").join("deep").join("B.DUF"), b"x").unwrap();
        fs::write(dir.join("sub").join("note.txt"), b"x").unwrap();
        let mut out = scan_duf_files(dir.to_string_lossy().to_string());
        out.sort();
        assert_eq!(out, vec!["a.duf".to_string(), "sub/deep/B.DUF".to_string()]);
        // A missing folder degrades to an empty list, never a panic.
        assert!(scan_duf_files(dir.join("nope").to_string_lossy().to_string()).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duf_frame_count_still_reads_a_gzipped_preset() {
        // End-to-end through the production budget formula: a normal gzipped
        // preset stays far below max(100 × compressed, the 32 MiB preset floor).
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
