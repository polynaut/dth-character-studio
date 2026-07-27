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
low-pass anti-aliases the xBRZ'd master's hard edges. Avatars are also now
flattened onto the tile background (`#565963`, the only colour they're shown on)
BEFORE upscaling, so the tip's transparent edge is a smooth figure→bg gradient
rather than a discontinuity that magnifiers jag. Every upscaled avatar now keeps
its **pristine original as a `.src` sibling** beside the master (pruned in tandem),
so a master can always be re-derived by the current pipeline without depending on
the source scene/upload still existing. Existing masters pick all this up via
**Ctrl + Refresh assets** (Tools), which rebuilds each master from its stored
original (falling back to the scene's tip, and storing it as the `.src` from then
on) — or just re-set an avatar.
