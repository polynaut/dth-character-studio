//! Avatar image upscaling.
//!
//! Daz scene thumbnails (`.tip.png`) are only 256×256, and a small cropped upload
//! lands at 256×256 too — magnified into the character-header portrait they look
//! soft. We upscale anything below the target to that target with **xBRZ**, an
//! edge-directed magnifier that suits the flat-shaded Daz figures far better than a
//! plain resample (which adds no real detail — see the investigation in the PR).
//!
//! xBRZ (the `xbrz-rs` crate) is **GPL-3.0-only** — linking it makes this crate,
//! and therefore the distributed desktop application, GPL-3.0. The pure-TypeScript
//! libraries (`@dth/rom`, `@dth/ui`) and the web app remain MIT. See
//! `apps/desktop/LICENSE`.

use std::io::Cursor;
use std::path::Path;

use image::{ImageFormat, RgbaImage};

/// The square side STORED avatars (the header portrait, HiDPI) are upscaled to. 768
/// (not 512) so a 256px source becomes an exact xBRZ ×3 and comfortably exceeds the
/// header's painted size on HiDPI displays.
const TARGET: u32 = 768;

/// The square side small SCENE-TIP mini avatars (the green pills, scene/asset cards)
/// are upscaled to — a cheaper exact ×2 from the 256px tip, plenty for their tiny
/// painted size.
const TIP_TARGET: u32 = 512;

/// Upscale the avatar PNG at `path` IN PLACE to {@link TARGET}px² when it's smaller,
/// using xBRZ. A no-op returning `false` when the image is already at least TARGET on
/// both sides, so it's safe (and cheap) to call after every avatar write. Failures
/// return an error string; the caller (writeAvatarBytes) treats any failure as "keep
/// the original image", so a bad upscale never blocks setting an avatar.
#[tauri::command]
pub fn upscale_avatar_file(path: String) -> Result<bool, String> {
    upscale_png_to_square(Path::new(&path), TARGET)
}

/// Upscale a Daz scene tip's PNG BYTES to {@link TIP_TARGET}px² (when it's smaller)
/// and return the re-encoded PNG — WITHOUT touching any file, since the tip lives in
/// the user's Daz library and we never rewrite downloaded assets. Returns the input
/// bytes unchanged when the tip is already at least TIP_TARGET. Powers the small
/// scene-tip mini avatars (resolveScenePreview).
#[tauri::command]
pub fn upscale_png_bytes(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    Ok(upscale_png_square_bytes(&bytes, TIP_TARGET)?.unwrap_or(bytes))
}

/// The testable core: decode `png`, and if either side is below `target`, xBRZ-magnify
/// by the smallest integer factor that reaches `target`, Lanczos3-downscale to exactly
/// `target`², and re-encode to PNG bytes. Returns `None` (no re-encode) when the image
/// is already at least `target` on both sides.
fn upscale_png_square_bytes(png: &[u8], target: u32) -> Result<Option<Vec<u8>>, String> {
    let decoded = image::load_from_memory(png).map_err(|e| format!("decode: {e}"))?;
    let rgba = decoded.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    if w >= target && h >= target {
        return Ok(None);
    }
    let min_side = w.min(h).max(1);
    // xBRZ magnifies by an INTEGER factor only (2..=6). Take the smallest that reaches
    // `target`, then Lanczos-downscale the (possibly larger) result to exactly target².
    // For the 256px tip this is an exact ×2 (→512) or ×3 (→768), so the resize below
    // is an identity.
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
    let mut buf = Vec::new();
    image::DynamicImage::ImageRgba8(out)
        .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
        .map_err(|e| format!("encode: {e}"))?;
    Ok(Some(buf))
}

/// File wrapper over {@link upscale_png_square_bytes}: read `p`, and if it's below
/// `target`, upscale and overwrite it in place. Returns whether it upscaled. Used by
/// {@link upscale_avatar_file} and the tests.
fn upscale_png_to_square(p: &Path, target: u32) -> Result<bool, String> {
    let bytes = std::fs::read(p).map_err(|e| format!("read {}: {e}", p.display()))?;
    match upscale_png_square_bytes(&bytes, target)? {
        Some(out) => {
            std::fs::write(p, out).map_err(|e| format!("write {}: {e}", p.display()))?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn checkerboard(side: u32) -> RgbaImage {
        let mut img = RgbaImage::new(side, side);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = if (x / 8 + y / 8) % 2 == 0 {
                Rgba([220, 90, 40, 255])
            } else {
                Rgba([30, 60, 200, 255])
            };
        }
        img
    }

    fn encode_png(img: RgbaImage) -> Vec<u8> {
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut Cursor::new(&mut buf), ImageFormat::Png)
            .unwrap();
        buf
    }

    /// A tiny checkerboard PNG written to a temp path, so the file tests exercise the
    /// real decode → xBRZ → downscale → encode round-trip.
    fn write_png(dir: &Path, name: &str, side: u32) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, encode_png(checkerboard(side))).unwrap();
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

    #[test]
    fn upscales_tip_bytes_to_512() {
        let png = encode_png(checkerboard(256));
        let out = upscale_png_square_bytes(&png, 512)
            .unwrap()
            .expect("a 256px tip should upscale");
        let decoded = image::load_from_memory(&out).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (512, 512));
    }

    #[test]
    fn leaves_large_tip_bytes_uncoded() {
        // Already >= 512 → the bytes core returns None (no re-encode), and the command
        // hands back the original bytes.
        let png = encode_png(checkerboard(512));
        assert!(upscale_png_square_bytes(&png, 512).unwrap().is_none());
        assert_eq!(upscale_png_bytes(png.clone()).unwrap(), png);
    }
}
