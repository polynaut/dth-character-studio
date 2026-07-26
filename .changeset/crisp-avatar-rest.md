---
"@dth/web": patch
"@dth/desktop": patch
---

The character header portrait no longer softens or aliases at rest. Two fixes: it
rested at `scale: 1.55`, so the browser rasterised it at its small layout size and
GPU-upscaled that texture — it's now laid out at the painted size and rests at
`scale: 1` (the zoom-on-scroll rescaled to match, so both framings are unchanged);
and the 768px master is now served **pre-downscaled** to the exact painted size ×
the screen DPR via a Rust `image`-crate **Lanczos3** pass (`downscale_avatar_png`),
so the webview paints it 1:1 with no aliasing-prone GPU resampling — the Lanczos
low-pass anti-aliases the xBRZ'd master's hard edges.
