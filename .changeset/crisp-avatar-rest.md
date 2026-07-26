---
"@dth/web": patch
---

The character header portrait no longer softens/aliases at rest. It rested at
`scale: 1.55`, so the browser rasterised it at its small layout size and then
GPU-upscaled that texture; it's now laid out at the painted size and rests at
`scale: 1`, resampling the full-resolution source directly. The zoom-on-scroll is
rescaled to match, so both the resting and collapsed framings are unchanged.
