//! Avatar image enlargement.
//!
//! Daz scene thumbnails (`.tip.png`) are only 256×256, and a small cropped upload
//! lands at 256×256 too — magnified into the character-header portrait they look
//! soft. We enlarge anything below 768² to 768² with a **Lanczos3 photo
//! enlargement + a light unsharp mask**.
//!
//! Previously this used **xBRZ**, but that's a *pixel-art* magnifier — on the
//! photo-real Daz renders it invented blocky, hard edges. A photo-oriented
//! resample keeps the shading smooth, and the paint-time downscale to the display
//! size (see {@link downscale_avatar_png}) then anti-aliases the edges cleanly.
//!
//! NOTE: `xbrz-rs` (GPL-3.0-only) is no longer CALLED but is still a Cargo
//! dependency, so the desktop app stays GPL for now — dropping it would relicense
//! it back to MIT (a separate decision; see `apps/desktop/LICENSE`).

use std::io::Cursor;
use std::path::Path;

use image::ImageFormat;
use tauri::ipc::Response;

/// The square side length small avatars are enlarged up to. 768 gives the
/// paint-time downscale (see {@link downscale_avatar_png}) plenty of source to
/// resample from at any HiDPI display size.
const TARGET: u32 = 768;

/// Enlarge the avatar PNG at `path` IN PLACE to a {@link TARGET}px square when it's
/// smaller. A no-op returning `false` when the image is already at least TARGET on
/// both sides, so it's safe (and cheap) to call after every avatar write.
///
/// Failures return an error string; the caller (writeAvatarBytes) treats any
/// failure as "keep the original image", so a bad enlargement never blocks setting
/// an avatar.
#[tauri::command]
pub fn upscale_avatar_file(path: String) -> Result<bool, String> {
    upscale_png_to_square(Path::new(&path), TARGET)
}

/// The testable core of {@link upscale_avatar_file}: decode the PNG at `p`, and if
/// either side is below `target`, Lanczos3-enlarge to `target`², sharpen lightly,
/// and overwrite the file. Returns whether it enlarged.
fn upscale_png_to_square(p: &Path, target: u32) -> Result<bool, String> {
    let decoded = image::open(p).map_err(|e| format!("decode {}: {e}", p.display()))?;
    let rgba = decoded.to_rgba8();
    if rgba.width() >= target && rgba.height() >= target {
        return Ok(false);
    }
    // Photo enlargement: Lanczos3 keeps the Daz render's smooth shading (no xBRZ
    // pixel-art blocking), then a LIGHT unsharp mask restores the edge definition a
    // plain enlargement loses — without inventing hard edges. Both tunable; the
    // unsharp `sigma`/`threshold` are the knobs if it reads too soft or too crunchy.
    let up = image::imageops::resize(&rgba, target, target, image::imageops::FilterType::Lanczos3);
    let out = image::imageops::unsharpen(&up, 1.5, 3);
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
