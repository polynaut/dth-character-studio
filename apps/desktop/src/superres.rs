//! AI avatar super-resolution via **Real-ESRGAN** (the ncnn-vulkan build).
//!
//! Daz tips are only 256², so the header portrait magnifies a tiny source. xBRZ
//! (see `avatar`) smooths edges but invents no real detail; Real-ESRGAN
//! reconstructs plausible detail (face, hair, fabric) far better on the photo-real
//! renders — see the investigation. It's alpha-blind, so we FLATTEN the tip onto
//! the tile bg first (the avatar is only ever shown on that colour), run the x4
//! model, then Lanczos-downscale to the stored master size.
//!
//! Self-contained on purpose: it carries its own `flatten_on_tile_bg` rather than
//! sharing `avatar`'s, so this feature lands as one independent module.
//!
//! The tool + model are NOT bundled — they download once on first use and cache in
//! app-data (checksum-verified), so nothing ships in the installer. Every step is
//! best-effort: any failure returns `Err` and the caller falls back to xBRZ.

use std::path::Path;
use std::process::Command;

use image::{imageops::FilterType, ImageFormat, Rgba, RgbaImage};

/// The Real-ESRGAN model to run — the general/photo x4 model (best on the Daz
/// renders; the `-anime` model over-smooths them).
const MODEL: &str = "realesrgan-x4plus";

/// The avatar tile background (`#565963`) — the ONE colour an avatar is ever shown
/// on (the header portrait + every avatar tile). Baking it in before the upscale
/// gives the alpha-blind AI an opaque edge instead of a transparent one, which is
/// what makes the silhouette come out clean.
const TILE_BG: [u8; 3] = [0x56, 0x59, 0x63];

/// AI-upscale the tip PNG at `tip` to a `master`² PNG at `out`, using the
/// `realesrgan-ncnn-vulkan` tool installed under `tool_dir` (with its `models/`).
/// Flattens onto the tile bg first (the AI is alpha-blind), runs the x4 model, then
/// Lanczos-downscales the result to `master`. Returns `Err` on ANY failure (no
/// tool, no Vulkan GPU, a bad run) so the caller can fall back to xBRZ.
pub fn ai_upscale_tip(tip: &Path, tool_dir: &Path, out: &Path, master: u32) -> Result<(), String> {
    let exe = tool_dir.join(REALESRGAN_EXE);
    if !exe.exists() {
        return Err(format!("realesrgan tool missing at {}", exe.display()));
    }

    // 1. Flatten the tip onto the tile bg → an opaque temp PNG the AI can eat.
    let flat = flatten_on_tile_bg(&image::open(tip).map_err(|e| e.to_string())?.to_rgba8());
    let tmp_in = std::env::temp_dir().join("dth-avatar-in.png");
    let tmp_out = std::env::temp_dir().join("dth-avatar-ai.png");
    flat.save_with_format(&tmp_in, ImageFormat::Png)
        .map_err(|e| format!("write temp: {e}"))?;

    // 2. Run Real-ESRGAN x4 (256 → 1024). GPU unset = auto; fails w/o Vulkan.
    let status = Command::new(&exe)
        .args(["-n", MODEL])
        .arg("-m")
        .arg(tool_dir.join("models"))
        .arg("-i")
        .arg(&tmp_in)
        .arg("-o")
        .arg(&tmp_out)
        .status()
        .map_err(|e| format!("spawn realesrgan: {e}"))?;
    if !status.success() {
        return Err(format!("realesrgan exited with {status}"));
    }

    // 3. Lanczos-downscale the AI result to the stored master size.
    image::open(&tmp_out)
        .map_err(|e| format!("read ai output: {e}"))?
        .resize(master, master, FilterType::Lanczos3)
        .save_with_format(out, ImageFormat::Png)
        .map_err(|e| format!("write {}: {e}", out.display()))?;
    let _ = std::fs::remove_file(&tmp_in);
    let _ = std::fs::remove_file(&tmp_out);
    Ok(())
}

/// Alpha-composite `src` over the opaque tile bg, returning an opaque RGBA image.
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

#[cfg(windows)]
const REALESRGAN_EXE: &str = "realesrgan-ncnn-vulkan.exe";
#[cfg(not(windows))]
const REALESRGAN_EXE: &str = "realesrgan-ncnn-vulkan";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flatten_bakes_the_tile_bg_into_transparent_pixels() {
        let mut img = RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([255, 255, 255, 0])); // fully transparent → pure bg
        img.put_pixel(1, 0, Rgba([255, 255, 255, 255])); // opaque → unchanged
        let out = flatten_on_tile_bg(&img);
        assert_eq!(out.get_pixel(0, 0).0, [TILE_BG[0], TILE_BG[1], TILE_BG[2], 255]);
        assert_eq!(out.get_pixel(1, 0).0, [255, 255, 255, 255]);
    }

    #[test]
    fn missing_tool_is_a_clean_error_not_a_panic() {
        let err = ai_upscale_tip(
            Path::new("nope.png"),
            Path::new("no-such-tool-dir"),
            Path::new("out.png"),
            768,
        )
        .unwrap_err();
        assert!(err.contains("realesrgan tool missing"), "got: {err}");
    }
}
