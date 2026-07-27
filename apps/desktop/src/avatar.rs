//! Avatar image upscaling.
//!
//! Daz scene thumbnails (`.tip.png`) are only 256×256, and a small cropped upload
//! lands at 256×256 too — magnified into the character-header portrait they look
//! soft. We upscale anything below 768² to 768² with **xBRZ**, an edge-directed
//! magnifier that suits the flat-shaded Daz figures far better than a plain
//! resample (which adds no real detail — see the investigation in the PR).
//!
//! xBRZ (the `xbrz-rs` crate) is **GPL-3.0-only** — linking it makes this crate,
//! and therefore the distributed desktop application, GPL-3.0. The pure-TypeScript
//! libraries (`@dth/rom`, `@dth/ui`) and the web app remain MIT. See
//! `apps/desktop/LICENSE`.

use std::io::Cursor;
use std::path::Path;

use image::{ImageFormat, Rgba, RgbaImage};
use tauri::ipc::Response;

/// The square side length small avatars are upscaled up to. 768 (not 512) so a
/// 256px tip becomes an exact xBRZ ×3, and the source comfortably exceeds the
/// header portrait's painted size on HiDPI displays.
const TARGET: u32 = 768;

/// The avatar tile's background — `#262626`, used by BOTH the header wrapper and
/// the shared `Portrait` (list cards, dialog, …). Daz renders the `.tip.png`
/// previews against a dark viewport, so a dark tile matches what the thumbnail
/// was lit for (the old `#565963` washed them out). The avatar is only ever
/// shown on this colour, so baking it in is invisible. Changing it requires a
/// master rebuild (Ctrl+Refresh assets) — stored masters are flattened onto it.
const TILE_BG: [u8; 3] = [0x26, 0x26, 0x26];

/// Composite `src` over {@link TILE_BG} into an opaque image. A tip's hard
/// transparent edge is a discontinuity every magnifier turns into jaggies;
/// flattening onto the exact background it'll be shown on FIRST makes that edge a
/// smooth figure→bg gradient the magnifier handles cleanly. Alpha is dropped (set
/// opaque) — fine, since the avatar always sits on the tile.
fn flatten_on_tile_bg(src: &RgbaImage) -> RgbaImage {
    let [br, bg, bb] = TILE_BG;
    let mut out = RgbaImage::new(src.width(), src.height());
    for (x, y, px) in src.enumerate_pixels() {
        let [r, g, b, a] = px.0;
        let a = a as u16;
        let mix = |c: u8, k: u8| ((c as u16 * a + k as u16 * (255 - a)) / 255) as u8;
        out.put_pixel(x, y, Rgba([mix(r, br), mix(g, bg), mix(b, bb), 255]));
    }
    out
}

/// Upscale the avatar PNG at `path` IN PLACE to a {@link TARGET}px square when it's
/// smaller: xBRZ (an integer magnification) overshooting ~2×, then a Lanczos3
/// down-step onto TARGET — a supersample, so xBRZ's hard stair-step edges land
/// anti-aliased (the common 256px tip runs ×6 → 1536 → 768). A no-op returning
/// `false` when the image is already at least TARGET on both sides, so it's safe
/// (and cheap) to call after every avatar write.
///
/// Failures return an error string; the caller (writeAvatarBytes) treats any
/// failure as "keep the original image", so a bad upscale never blocks setting an
/// avatar.
#[tauri::command]
pub fn upscale_avatar_file(path: String) -> Result<bool, String> {
    upscale_png_to_square(Path::new(&path), TARGET)
}

/// The testable core of {@link upscale_avatar_file}: decode the PNG at `p`, and if
/// either side is below `target`, xBRZ-magnify past ~2× `target`,
/// Lanczos-downscale to exactly `target`², and overwrite the file. Returns
/// whether it upscaled.
fn upscale_png_to_square(p: &Path, target: u32) -> Result<bool, String> {
    let decoded = image::open(p).map_err(|e| format!("decode {}: {e}", p.display()))?;
    let rgba = decoded.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    if w >= target && h >= target {
        return Ok(false);
    }
    // Flatten onto the tile bg BEFORE magnifying — the tip's transparent edge is a
    // discontinuity magnifiers jag (see flatten_on_tile_bg). Marginal for xBRZ (it's
    // edge-directed) but the right base for the alpha-blind AI path.
    let flat = flatten_on_tile_bg(&rgba);
    let min_side = w.min(h).max(1);
    // xBRZ magnifies by an INTEGER factor only (2..=6). Take the factor that
    // OVERSHOOTS `target` by ~2× (capped at xBRZ's max), so the Lanczos
    // down-step below is a real ~2× supersample instead of an identity — xBRZ
    // draws its curves at finer granularity and the downscale averages its hard
    // stair-step edges into proper anti-aliasing. For the 256px tip: ×6 → 1536 →
    // 768 (measured clearly smoother than the old exact ×3, at ~4× one-time
    // cost; see the PR).
    let factor = (target * 2).div_ceil(min_side).clamp(2, 6);
    let up = xbrz::scale_rgba(flat.as_raw(), w as usize, h as usize, factor as usize);
    let upscaled = RgbaImage::from_raw(w * factor, h * factor, up)
        .ok_or_else(|| "xbrz returned an unexpected buffer size".to_string())?;
    let out = image::imageops::resize(
        &upscaled,
        target,
        target,
        image::imageops::FilterType::Lanczos3,
    );
    out.save_with_format(p, ImageFormat::Png)
        .map_err(|e| format!("write {}: {e}", p.display()))?;
    Ok(true)
}

/// Return the avatar PNG at `path` Lanczos3-downscaled to `size`² PNG bytes — the
/// exact size the header paints it (its CSS px × the screen DPR), so the webview
/// can paint it 1:1 with NO resampling of a bigger texture (the source of the
/// aliased/soft edges). Lanczos3 is a proper low-pass, so the xBRZ'd master's hard
/// edges come out anti-aliased. A source already ≤ `size` on both sides is
/// returned unchanged (never upscaled — xBRZ did any upscaling on write). Raw
/// bytes (an ArrayBuffer to the webview), not a JSON number array.
#[tauri::command]
pub fn downscale_avatar_png(path: String, size: u32) -> Result<Response, String> {
    Ok(Response::new(downscale_png_bytes(Path::new(&path), size)?))
}

/// The testable core of {@link downscale_avatar_png}.
fn downscale_png_bytes(p: &Path, size: u32) -> Result<Vec<u8>, String> {
    let decoded = image::open(p).map_err(|e| format!("decode {}: {e}", p.display()))?;
    if size == 0 || (decoded.width() <= size && decoded.height() <= size) {
        return std::fs::read(p).map_err(|e| format!("read {}: {e}", p.display()));
    }
    let out = image::imageops::resize(
        &decoded.to_rgba8(),
        size,
        size,
        image::imageops::FilterType::Lanczos3,
    );
    let mut buf = Vec::new();
    image::DynamicImage::ImageRgba8(out)
        .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| format!("encode {}: {e}", p.display()))?;
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    /// A tiny checkerboard PNG written to a temp path, so the test exercises the
    /// real decode → xBRZ → downscale → encode round-trip.
    fn write_png(dir: &Path, name: &str, side: u32) -> std::path::PathBuf {
        let mut img = RgbaImage::new(side, side);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = if (x / 8 + y / 8) % 2 == 0 {
                Rgba([220, 90, 40, 255])
            } else {
                Rgba([30, 60, 200, 255])
            };
        }
        let path = dir.join(name);
        img.save_with_format(&path, ImageFormat::Png).unwrap();
        path
    }

    #[test]
    fn upscales_a_small_square_to_target() {
        let dir = std::env::temp_dir().join("dth-avatar-upscale-small");
        std::fs::create_dir_all(&dir).unwrap();
        let path = write_png(&dir, "small.png", 256);

        let changed = upscale_png_to_square(&path, 768).unwrap();
        assert!(changed, "a 256px source should be upscaled");

        let out = image::open(&path).unwrap();
        assert_eq!((out.width(), out.height()), (768, 768));
    }

    #[test]
    fn downscale_lanczos_hits_the_target_size_and_leaves_small_sources_untouched() {
        let dir = std::env::temp_dir().join("dth-avatar-downscale");
        std::fs::create_dir_all(&dir).unwrap();
        let path = write_png(&dir, "master.png", 768);

        // 768 → 632 (the @2× of a 316px header) yields a valid 632² PNG.
        let bytes = downscale_png_bytes(&path, 632).unwrap();
        let out = image::load_from_memory(&bytes).unwrap();
        assert_eq!((out.width(), out.height()), (632, 632));

        // A source already ≤ target is returned byte-identical (never upscaled).
        let raw = std::fs::read(&path).unwrap();
        assert_eq!(downscale_png_bytes(&path, 1024).unwrap(), raw);
    }

    #[test]
    fn leaves_a_large_enough_image_untouched() {
        let dir = std::env::temp_dir().join("dth-avatar-upscale-large");
        std::fs::create_dir_all(&dir).unwrap();
        let path = write_png(&dir, "large.png", 768);
        let before = std::fs::read(&path).unwrap();

        let changed = upscale_png_to_square(&path, 768).unwrap();
        assert!(!changed, "an image already >= target must be a no-op");
        assert_eq!(std::fs::read(&path).unwrap(), before, "the file must be byte-identical");
    }
}
