---
'@dth/web': patch
---

Every scene card shows where its scene lives as a path chip under the title — relative like `.\daz3d\Outfit_B` (the scenes-root part dimmed), full path on copy, Alt+click reveals. In-folder chips are edit-to-move via a floating one-line panel: the scenes root is a fixed prefix, only the subfolder beyond it is editable (empty = directly in the root, vacated subfolders are pruned), and the primary moves exactly like any other scene. The scenes root itself still moves via the section chip, which now correctly moves the root even when the primary sits in a subfolder of it. Scene card titles inline-rename like the character name in the header — the `.duf` and both thumbnail sidecars follow the new name, every stored path repoints, and the generated scripts refresh (linked-in-place scenes keep their name). The Houdini projects section shows its folder chip before any project is linked. Chip pencils are ghosts with a solid hover box matching the 20×20 copy hint.
