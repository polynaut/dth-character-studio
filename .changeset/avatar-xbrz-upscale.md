---
"@dth/web": patch
---

Avatars: upscale low-resolution avatar images to 512×512 with **xBRZ**, an
edge-directed magnifier that suits the flat-shaded Daz figures. A 256px Daz scene
`.tip.png` (or a small cropped upload) is magnified less harshly into the
character-header portrait now, so it reads sharper. Done in Rust (in place,
idempotent, best-effort) at avatar-write time, covering both the crop-upload and
"use this scene's image" paths.

**Licensing:** `xbrz-rs` is GPL-3.0, so the distributed desktop application
(`apps/desktop`) is now **GPL-3.0** (see `apps/desktop/LICENSE`). The libraries and
web app — `@dth/rom`, `@dth/ui`, `@dth/web` — remain MIT and compile into the
binary unchanged.
