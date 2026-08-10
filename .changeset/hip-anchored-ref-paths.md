---
# minor: changes what generation EMITS (runtime v66) and adds a behaviour to
# Make paths portable — not a fix to something that was broken.
'@dth/web': minor
---

**Generated Houdini paths are shorter again: `$HIP/daz-export/…` instead of `$JOB/houdini/daz-export/…`.**

Since the export folder moved inside the character's `houdini/` folder (v0.68), every import, PoseAsset CSV and reference-skeleton path sits directly below the `.hip` that reads it — so `$HIP`, the project's own folder, reaches all of them without climbing out. That is also what Houdini itself writes: its file picker collapses a chosen export to `$HIP/…` (measured with `hou.text.collapseCommonVars`), so a path you pick by hand and one the studio generates now read identically inside the same node.

`$HIP` has a second advantage over `$JOB`: it is derived from where the file sits, so it cannot be wrong. A project whose `$JOB` still points at another character keeps resolving its own imports.

`$JOB` is still used where `$HIP` cannot reach — Houdini's own output folder (`<character>/export/`, which sits beside the houdini folder, not under it), layouts from before the export move, and characters whose projects are spread across several folders, where there is no single `$HIP`. Houdini's picker falls back the same way.

**Existing projects keep working and are not nagged about.** Projects generated under v63–v65 hold the `$JOB` form; it resolves, so no card flags it — **Utils → Make paths portable** shortens it when you ask, and only on DazToHue nodes (a `$JOB` path on your own cache or render nodes is your choice of anchor and is left alone). The older `$HIP/../…` form is still flagged, because its `..` breaks if the project ever moves a folder deeper. Characters regenerate into the new form on the next save or via Tools → Refresh assets.
