//! Standalone spike: high-quality **anti-aliased vector rendering** with
//! [`tiny-skia`](https://crates.io/crates/tiny-skia).
//!
//! This is an evaluation spike, NOT wired into the app — tiny-skia is a
//! dev-dependency, so it links only into this example binary, never the shipped
//! desktop app. It answers one question: how good is tiny-skia's anti-aliasing on
//! custom vector paths (curves + strokes), and how clean is a production-shaped
//! render → PNG pipeline (real errors, no `unwrap`)?
//!
//! It renders a gradient-filled flower (cubic/quadratic curves) and a stroked sine
//! wave (round-capped polyline) onto the app's avatar-tile background, then writes
//! a PNG.
//!
//! Run: `cargo run --example tiny_skia_demo [OUTPUT.png]` (defaults to
//! `tiny_skia_demo.png` in the current dir).

use std::fmt;
use std::path::PathBuf;

use tiny_skia::{
    Color, FillRule, GradientStop, LineCap, LineJoin, LinearGradient, Paint, PathBuilder, Pixmap,
    Point, Shader, SpreadMode, Stroke, Transform,
};

/// The avatar tile background (`#565963`) — rendering onto an opaque, realistic
/// backdrop is the honest way to judge anti-aliased edges (transparent checkerboard
/// hides them).
fn tile_bg() -> Color {
    Color::from_rgba8(0x56, 0x59, 0x63, 0xff)
}

/// Everything that can go wrong while rendering — so the whole pipeline is `?`-able
/// and nothing in the demo path calls `unwrap()`.
#[derive(Debug)]
enum RenderError {
    /// `Pixmap::new` rejected the canvas size (zero, or too large to allocate).
    Canvas { width: u32, height: u32 },
    /// A `PathBuilder` produced no usable path (empty or degenerate).
    EmptyPath(&'static str),
    /// A gradient could not be built (needs ≥2 stops and finite points).
    Gradient(&'static str),
    /// Encoding or writing the PNG failed.
    Save { path: PathBuf, source: String },
}

impl fmt::Display for RenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RenderError::Canvas { width, height } => {
                write!(f, "invalid canvas size {width}×{height}")
            }
            RenderError::EmptyPath(what) => write!(f, "the {what} path was empty"),
            RenderError::Gradient(what) => write!(f, "could not build the {what} gradient"),
            RenderError::Save { path, source } => write!(f, "saving {}: {source}", path.display()),
        }
    }
}

impl std::error::Error for RenderError {}

/// Render the whole scene into an owned `Pixmap`. Every paint sets
/// `anti_alias = true`.
fn render(width: u32, height: u32) -> Result<Pixmap, RenderError> {
    let mut pixmap = Pixmap::new(width, height).ok_or(RenderError::Canvas { width, height })?;
    pixmap.fill(tile_bg());
    draw_gradient_flower(&mut pixmap, width, height)?;
    draw_stroked_wave(&mut pixmap, width, height)?;
    Ok(pixmap)
}

/// A symmetric flower whose petals are quadratic Béziers, filled with a vertical
/// linear gradient — the curved fill edge is where anti-aliasing shows most.
fn draw_gradient_flower(pixmap: &mut Pixmap, w: u32, h: u32) -> Result<(), RenderError> {
    let (w, h) = (w as f32, h as f32);
    let (cx, cy) = (w * 0.5, h * 0.5);
    let r = w.min(h) * 0.32;
    let inner = r * 0.55;
    let petals = 8u32;

    let mut pb = PathBuilder::new();
    for i in 0..petals {
        let a_start = i as f32 / petals as f32 * std::f32::consts::TAU;
        let a_mid = (i as f32 + 0.5) / petals as f32 * std::f32::consts::TAU;
        let a_end = (i as f32 + 1.0) / petals as f32 * std::f32::consts::TAU;
        let (sx, sy) = (cx + inner * a_start.cos(), cy + inner * a_start.sin());
        // Control point pushed out to the petal tip so the quad bulges into a petal.
        let (mx, my) = (cx + r * a_mid.cos(), cy + r * a_mid.sin());
        let (ex, ey) = (cx + inner * a_end.cos(), cy + inner * a_end.sin());
        if i == 0 {
            pb.move_to(sx, sy);
        }
        pb.quad_to(mx, my, ex, ey);
    }
    pb.close();
    let path = pb.finish().ok_or(RenderError::EmptyPath("flower"))?;

    let shader = LinearGradient::new(
        Point::from_xy(cx, cy - r),
        Point::from_xy(cx, cy + r),
        vec![
            GradientStop::new(0.0, Color::from_rgba8(0x9c, 0xc4, 0xff, 0xff)),
            GradientStop::new(1.0, Color::from_rgba8(0x33, 0x54, 0xc4, 0xff)),
        ],
        SpreadMode::Pad,
        Transform::identity(),
    )
    .ok_or(RenderError::Gradient("flower fill"))?;

    let paint = Paint {
        shader,
        anti_alias: true,
        ..Default::default()
    };
    pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
    Ok(())
}

/// A round-capped sine wave stroked across the canvas — near-horizontal edges are
/// the worst case for aliasing, so this is a good stroke-AA test.
fn draw_stroked_wave(pixmap: &mut Pixmap, w: u32, h: u32) -> Result<(), RenderError> {
    let (wf, hf) = (w as f32, h as f32);
    let samples = 96u32;

    let mut pb = PathBuilder::new();
    for i in 0..=samples {
        let t = i as f32 / samples as f32;
        let x = t * wf;
        let y = hf * 0.5 + (t * std::f32::consts::TAU * 2.0).sin() * hf * 0.12;
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    let path = pb.finish().ok_or(RenderError::EmptyPath("wave"))?;

    let paint = Paint {
        shader: Shader::SolidColor(Color::from_rgba8(0xff, 0xd5, 0x66, 0xff)),
        anti_alias: true,
        ..Default::default()
    };
    let stroke = Stroke {
        width: 6.0,
        line_cap: LineCap::Round,
        line_join: LineJoin::Round,
        ..Default::default()
    };
    pixmap.stroke_path(&path, &paint, &stroke, Transform::identity(), None);
    Ok(())
}

fn main() -> Result<(), RenderError> {
    let out = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("tiny_skia_demo.png"));

    let pixmap = render(512, 512)?;
    pixmap.save_png(&out).map_err(|e| RenderError::Save {
        path: out.clone(),
        source: e.to_string(),
    })?;
    println!("wrote {}", out.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_and_encodes_a_png() {
        let pixmap = render(128, 128).expect("render should succeed");
        let png = pixmap.encode_png().expect("encode should succeed");
        assert!(png.starts_with(b"\x89PNG"), "output must be a PNG");
    }

    #[test]
    fn a_zero_canvas_is_a_clean_error() {
        assert!(matches!(render(0, 0), Err(RenderError::Canvas { .. })));
    }
}
