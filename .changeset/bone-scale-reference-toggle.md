---
"@dth/rom": patch
"@dth/web": patch
---

Reference-skeleton FBX is now a **Bone scale** toggle instead of a free-text path. Turn it on for a morph that scales bones (e.g. Torso Length, Proportion Height) and the studio does the rest: the DTH Exporter already generates the per-frame reference-skeleton FBX, and the PoseAsset CSV's `file` column is now auto-filled with that FBX's absolute path — no more typing or drift.

The path is resolved bulletproof at run time: the studio writes a `{{DTH_EXPORT_DIR}}` token into the CSV, and the generated Daz script substitutes the real export dir (scene subfolder included) when it copies the CSV next to the exporter output — so Houdini gets the exact absolute path it wants. A warning appears if bone-scale frames are set without an export directory (the exporter needs one to produce the FBX). Existing `referenceFbx` paths migrate to the toggle automatically.
