---
"@dth/desktop": patch
---

Enlarge avatars with a Lanczos3 photo resample + a light unsharp mask instead of
xBRZ. xBRZ is a *pixel-art* magnifier — on the photo-real Daz renders it invented
blocky, hard edges; the photo resample keeps the shading smooth, and the paint-time
downscale to the display size then anti-aliases the edges. Re-set a character's
avatar (from its Daz scene) to re-enlarge an existing one with the new path.
