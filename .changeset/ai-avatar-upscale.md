---
'@dth/desktop': minor
'@dth/web': minor
---

AI avatar super-resolution: when a scene's 256px tip is set as the avatar, upscale
it with Real-ESRGAN (flatten onto the tile bg → x4 → downscale to the master),
reconstructing real face/hair/fabric detail the xBRZ magnifier can't. The tool +
model download once on first use (checksum-verified, cached in app-data); falls
back to xBRZ when there's no GPU or the download is unavailable.
