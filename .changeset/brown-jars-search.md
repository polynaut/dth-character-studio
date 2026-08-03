---
'@dth/web': minor
'@dth/rom': minor
---

Bone-scale **reference-skeleton paths** in the delivered PoseAsset CSV are now written relative to **`$HIP`** — `$HIP/dth-exports/primary/Kira_frame_432.fbx` instead of a baked-in absolute path. They resolve through a `dth-exports` shortcut kept next to each generated `.hip`: **Generate project** creates it, and every generation checks and repairs it, so projects generated before this release pick theirs up on the next save.

The studio never writes a `$HIP` path it can't back: a character with **no Houdini project inside its folder**, or one whose shortcut can't be created (a network export root, a real folder in the way), keeps absolute paths — per character, whatever the setting says. The new **Settings → Houdini path style** switches everything back to absolute if you prefer.
