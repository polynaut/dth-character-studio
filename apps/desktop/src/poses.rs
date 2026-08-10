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

#[derive(Serialize, Clone)]
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
    /// EVERY figure-like root node (see `looks_like_figure`, non-conformed) —
    /// the add-scene dialog's "exactly one character" check. `figure` above
    /// stays its first entry for the create dialog.
    figures: Vec<SceneFigure>,
    /// Timeline frames occupied by REAL animation — value-CHANGING keys on the
    /// character's own (non-wearable) nodes; the stray keys products leave on
    /// their wearables' bones don't count (see duf_scene). Max counted key
    /// time × 30 fps, plus 1; 0 when nothing qualifies. Anything above 1 means
    /// the timeline is genuinely filled — the add-scene/create dialogs flag
    /// it, since the generated ROM script fills the timeline itself.
    animation_frames: u32,
    /// Empty on success; otherwise why the scene couldn't be read.
    error: String,
}

/// A node's id/name begins (case-insensitively) with "Genesis" — how we spot the
/// base figure among the scene nodes.
fn looks_like_figure(s: &str) -> bool {
    s.get(..7).is_some_and(|p| p.eq_ignore_ascii_case("genesis"))
}

/// Percent-decode a DSON ref ("#Left%20Nipple%201" → "Left Nipple 1"), leading
/// '#' stripped. DSON node/parent refs and animation-url node prefixes are
/// URL-encoded; scene node `id`s are not.
fn decode_ref(s: &str) -> String {
    let s = s.strip_prefix('#').unwrap_or(s);
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        // Hex-validate BOTH bytes BEFORE slicing the str: `%` followed by a
        // multi-byte UTF-8 char would land `&s[i+1..i+3]` mid-char and panic
        // ("byte index is not a char boundary") — reachable from any
        // user-supplied `.duf`. Two ASCII hex digits guarantee the boundaries
        // (and make the parse infallible); anything else is a literal `%`.
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && bytes[i + 1].is_ascii_hexdigit()
            && bytes[i + 2].is_ascii_hexdigit()
        {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Is the node (or ANY ancestor on its parent chain) a conformed wearable?
/// Products routinely leave stray animation keys on their wearables' bones —
/// e.g. nipple-graft bones keyed at frames 0 and 7 in an otherwise untouched
/// scene — and a wearable's bones chain up THROUGH the wearable root before
/// reaching the figure it's fitted to. An unknown id resolves to false at the
/// call site's discretion (the caller counts it — fail-loud).
fn wearable_owned(
    id: &str,
    nodes: &std::collections::HashMap<String, (Option<String>, bool)>,
) -> bool {
    let mut cur = id.to_string();
    // Guarded walk: a corrupt file could carry a parent cycle.
    for _ in 0..100 {
        match nodes.get(&cur) {
            Some((_, true)) => return true,
            Some((Some(parent), false)) => cur = parent.clone(),
            _ => return false,
        }
    }
    false
}

/// Everything one scene parse yields — see `scene_wearables` for the fields'
/// consumers.
struct SceneRead {
    items: Vec<SceneWearable>,
    figures: Vec<SceneFigure>,
    animation_frames: u32,
}

/// The conformed wearables of a scene `.duf`, its figure root nodes AND its
/// timeline occupancy, in one parse. A figure is a NON-conformed node whose
/// id/name looks like a Genesis figure — wearables named "Genesis…" always
/// carry a `conform_target`, so this can't mistake one for a figure, and it
/// finds a bare figure (a scene with no followers) all the same.
fn duf_scene(path: &Path) -> Result<SceneRead, String> {
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
    let figures = nodes
        .iter()
        .filter_map(|node| {
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
        })
        .collect();
    // Timeline occupancy — same frame math as `duf_frame_count`, but tolerant
    // (no animations is simply 0, never an error) and filtered down to REAL
    // animation. Two kinds of stray keys are the norm in untouched scenes and
    // must not count (measured on real scenes — a "clean" scene carried nipple-
    // graft keys at frames 0+7 from its wearable product):
    //   1. a channel whose keys never change value (keys, but no animation),
    //   2. a channel on a fitted wearable's node chain (product leftovers —
    //      the character's own timeline is what the check is about).
    // Unresolvable node refs COUNT (fail-loud): only a positively identified
    // wearable channel is excused.
    let node_map: std::collections::HashMap<String, (Option<String>, bool)> = nodes
        .iter()
        .filter_map(|node| {
            let id = node.get("id").and_then(|v| v.as_str())?;
            let parent = node.get("parent").and_then(|v| v.as_str()).map(decode_ref);
            let conformed = node.get("conform_target").is_some();
            Some((id.to_string(), (parent, conformed)))
        })
        .collect();
    let mut max_t = f64::NEG_INFINITY;
    if let Some(animations) = json
        .get("scene")
        .and_then(|s| s.get("animations"))
        .and_then(|a| a.as_array())
    {
        for anim in animations {
            let Some(keys) = anim.get("keys").and_then(|k| k.as_array()) else {
                continue;
            };
            // (1) Value-flat channels aren't animation.
            let first = keys.first().and_then(|k| k.get(1));
            if !keys.iter().skip(1).any(|k| k.get(1) != first) {
                continue;
            }
            // (2) The animation url's node prefix ("Left%20Nipple%201:/data/…")
            // names the keyed node — skip channels owned by a fitted wearable.
            let on_wearable = anim
                .get("url")
                .and_then(|v| v.as_str())
                .and_then(|u| u.split_once(':'))
                .is_some_and(|(prefix, _)| wearable_owned(&decode_ref(prefix), &node_map));
            if on_wearable {
                continue;
            }
            for key in keys {
                if let Some(t) = key.get(0).and_then(|v| v.as_f64()) {
                    if t > max_t {
                        max_t = t;
                    }
                }
            }
        }
    }
    let animation_frames = if max_t.is_finite() {
        // Saturate like duf_frame_count: a corrupt/hostile key time must not
        // overflow the `+ 1`.
        ((max_t * DTH_FPS).round() as u32).saturating_add(1)
    } else {
        0
    };
    Ok(SceneRead { items, figures, animation_frames })
}

/// The fitted (conformed) items of a scene `.duf`, its figure roots and its
/// timeline occupancy — the groom-suggestion source (items), the create dialog's
/// Genesis auto-select source (figure) and the add-scene dialog's validation
/// source (figures / animationFrames / the geograft-bearing items). Never
/// throws: an unreadable scene returns empty with the reason in `error`, so
/// callers degrade instead of breaking.
#[tauri::command(async)]
pub fn scene_wearables(path: String) -> SceneWearables {
    match duf_scene(Path::new(&path)) {
        Ok(read) => SceneWearables {
            items: read.items,
            figure: read.figures.first().cloned(),
            figures: read.figures,
            animation_frames: read.animation_frames,
            error: String::new(),
        },
        Err(error) => SceneWearables {
            items: Vec::new(),
            figure: None,
            figures: Vec::new(),
            animation_frames: 0,
            error,
        },
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
    fn decode_ref_never_panics_on_a_percent_before_a_multibyte_char() {
        // The old code sliced `&s[i+1..i+3]` before checking the two bytes were
        // hex — "%€" put the slice end mid-€ (a 3-byte char) and panicked on the
        // char boundary, through scene_wearables (documented "never throws")
        // from any user-supplied scene `.duf`. Non-hex after `%` is a literal.
        assert_eq!(decode_ref("%€"), "%€");
        assert_eq!(decode_ref("%2€"), "%2€");
        // The normal encoded path still decodes, `#`-stripped.
        assert_eq!(decode_ref("#Left%20Nipple%201"), "Left Nipple 1");
        // A trailing `%` (nothing left to decode) stays literal too.
        assert_eq!(decode_ref("100%"), "100%");
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
        // Exactly one figure root, and no animation keys at all.
        assert_eq!(result.figures.len(), 1);
        assert_eq!(result.animation_frames, 0);
        // An unreadable path degrades to an empty list + no figure + error.
        let missing = scene_wearables(dir.join("nope.duf").to_string_lossy().to_string());
        assert!(missing.items.is_empty());
        assert!(missing.figure.is_none());
        assert!(missing.figures.is_empty());
        assert_eq!(missing.animation_frames, 0);
        assert!(missing.error.contains("nope.duf"), "error: {}", missing.error);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scene_wearables_counts_figures_and_measures_the_timeline() {
        // The add-scene validation source: TWO Genesis roots (a second character
        // in the scene) and animation keys past t = 0 (a filled timeline). The
        // conformed eyelashes must NOT count as a figure despite the Genesis id.
        let dir = unique_temp_dir("scene_multi");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("two.duf");
        let json = br##"{"scene":{
            "nodes":[
                {"id":"Genesis9","label":"Genesis 9"},
                {"id":"Genesis9Eyelashes","label":"Genesis 9 Eyelashes","conform_target":"#Genesis9"},
                {"id":"Genesis9-1","label":"Genesis 9 (2)"}
            ],
            "animations":[{"keys":[[0,0],[0.5,1]]}]
        }}"##;
        fs::write(&path, gzip(json)).unwrap();
        let result = scene_wearables(path.to_string_lossy().to_string());
        assert_eq!(result.error, "");
        let ids: Vec<_> = result.figures.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["Genesis9", "Genesis9-1"]);
        // `figure` stays the FIRST root (the create dialog's contract).
        assert_eq!(result.figure.expect("first figure").id, "Genesis9");
        // Highest key at 0.5 s × 30 fps + 1 = 16 frames — a filled timeline.
        assert_eq!(result.animation_frames, 16);
        // A single rest-pose key (t = 0) never changes value → not animation.
        let rest = dir.join("rest.duf");
        let rest_json = br##"{"scene":{
            "nodes":[{"id":"Genesis9","label":"Genesis 9"}],
            "animations":[{"keys":[[0,0.2]]}]
        }}"##;
        fs::write(&rest, gzip(rest_json)).unwrap();
        assert_eq!(scene_wearables(rest.to_string_lossy().to_string()).animation_frames, 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stray_product_keys_do_not_count_as_a_filled_timeline() {
        // Modeled on a real "clean" scene (JM Nipple): the wearable's bones carry
        // keys at frames 0+7 — one channel even changes value — and one figure
        // channel holds a value-flat key pair. NONE of that is user animation:
        //   - value-flat channels are keys, not animation,
        //   - a value-changing channel on a fitted wearable's bone chain (bone →
        //     … → wearable root [conform_target] → figure) is product junk.
        // A value-changing key on the FIGURE's own bone still counts.
        let dir = unique_temp_dir("scene_stray");
        fs::create_dir_all(&dir).unwrap();
        let junk = dir.join("junk.duf");
        let junk_json = br##"{"scene":{
            "nodes":[
                {"id":"Genesis9","label":"Genesis 9"},
                {"id":"hip","label":"Hip","parent":"#Genesis9"},
                {"id":"Nippi_504","label":"JM Nipple","parent":"#Genesis9","conform_target":"#Genesis9"},
                {"id":"l_pectoral-3","label":"Left Pectoral","parent":"#Nippi_504"},
                {"id":"Left Nipple 1","label":"Left Nipple 1","parent":"#l_pectoral-3"}
            ],
            "animations":[
                {"url":"Left%20Nipple%201:/data/JM/Nippi.dsf#Left%20Nipple%201?rotation/y/value","keys":[[0,0],[0.2333333,-20.47903]]},
                {"url":"Genesis9:/data/DAZ%203D/G9.dsf#Genesis9?translation/y/value","keys":[[0,0],[0.2333333,0]]}
            ]
        }}"##;
        fs::write(&junk, gzip(junk_json)).unwrap();
        let result = scene_wearables(junk.to_string_lossy().to_string());
        assert_eq!(result.error, "");
        assert_eq!(result.animation_frames, 0, "stray wearable/flat keys must not count");
        // The SAME value-changing keys on the figure's own bone DO count.
        let real = dir.join("real.duf");
        let real_json = br##"{"scene":{
            "nodes":[
                {"id":"Genesis9","label":"Genesis 9"},
                {"id":"hip","label":"Hip","parent":"#Genesis9"}
            ],
            "animations":[
                {"url":"hip:/data/DAZ%203D/G9.dsf#hip?rotation/y/value","keys":[[0,0],[0.2333333,-20.5]]}
            ]
        }}"##;
        fs::write(&real, gzip(real_json)).unwrap();
        // 0.2333 s × 30 fps ≈ frame 7, +1 → 8 frames.
        assert_eq!(scene_wearables(real.to_string_lossy().to_string()).animation_frames, 8);
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
