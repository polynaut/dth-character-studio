---
'@dth/web': patch
'@dth/rom': patch
---

Bone-scale **reference-skeleton paths** in the PoseAsset CSV are now written relative to **`$HIP`** — `$HIP/dth-exports/primary/Kira_frame_432.fbx` instead of a baked-in absolute path — so a Houdini project keeps resolving after you move, rename or copy the character tree, or open it on another machine. **Generate project** now also puts a `dth-exports` shortcut next to the `.hip` itself, which is what those paths resolve through; regenerate an existing project once to get it.

A character with **no generated Houdini project** has nothing to anchor to and keeps absolute paths, whatever the setting says. The new **Settings → Houdini path style** switches everything back to absolute if you prefer.
