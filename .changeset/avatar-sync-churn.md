---
"@dth/web": patch
---

Avatar auto-sync no longer rewrites the avatar on every editor open/refocus.
Sync decided "stale" by comparing the scene tip against the stored avatar — but
the stored avatar is the upscaled master since upscale-on-write, which can never
byte-equal a 256² tip, so every sync re-copied + re-upscaled + re-saved. Every
upscaled avatar now stores its pristine source as a `.src` sibling (scene tips
too, not just uploads) and sync compares against that; legacy avatars without
one rewrite once more and settle.
