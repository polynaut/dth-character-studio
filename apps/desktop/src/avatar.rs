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

use std::path::Path;

use image::{ImageFormat, RgbaImage};

/// The square side length small avatars are upscaled up to. 768 (not 512) so a
/// 256px tip becomes an exact xBRZ ×3, and the source comfortably exceeds the
/// header portrait's painted size on HiDPI displays.
const TARGET: u32 = 768;

/// Upscale the avatar PNG at `path` IN PLACE to a {@link TARGET}px square when it's
/// smaller, using xBRZ (an integer magnification) followed by a Lanczos3 down-step
/// to land exactly on TARGET. A no-op returning `false` when the image is already
/// at least TARGET on both sides, so it's safe (and cheap) to call after every
/// avatar write. Avatars are square, so the common case is an exact 256→768 (×3);
/// a non-square or oddly-sized source is handled by the same integer-then-downscale
/// path.
///
/// Failures return an error string; the caller (writeAvatarBytes) treats any
/// failure as "keep the original image", so a bad upscale never blocks setting an
/// avatar.
#[tauri::command]
pub fn upscale_avatar_file(path: String) -> Result<bool, String> {
    upscale_png_to_square(Path::new(&path), TARGET)
}

/// The testable core of {@link upscale_avatar_file}: decode the PNG at `p`, and if
/// either side is below `target`, xBRZ-magnify by the smallest integer factor that
/// reaches `target`, Lanczos-downscale to exactly `target`², and overwrite the
/// file. Returns whether it upscaled.
fn upscale_png_to_square(p: &Path, target: u32) -> Result<bool, String> {
    let decoded = image::open(p).map_err(|e| format!("decode {}: {e}", p.display()))?;
    let rgba = decoded.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    if w >= target && h >= target {
        return Ok(false);
    }
    let min_side = w.min(h).max(1);
    // xBRZ magnifies by an INTEGER factor only (2..=6). Take the smallest that
    // reaches `target`, then Lanczos-downscale the (possibly larger) result to
    // exactly target². For the 256px tip this is an exact ×3 (→768), so the
    // resize below is an identity.
    let factor = target.div_ceil(min_side).clamp(2, 6);
    let up = xbrz::scale_rgba(rgba.as_raw(), w as usize, h as usize, factor as usize);
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
