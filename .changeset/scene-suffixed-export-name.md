---
'@dth/rom': patch
---

feat(rom): Houdini-ready export layout. Two changes to where and how the DTH export lands:

- **Scene-suffixed export names** — the figure name handed to the DTH Exporter is now scene-suffixed at run time: `Ita` exporting from the `Summertide` scene writes `Ita_Summertide.abc`/`.dth` (and matching reference-skeleton FBXs) instead of yet another `Ita.*`, so the per-scene export subfolders no longer all hold identically-named files. The PoseAsset CSV's bone-scale reference-FBX paths follow via a new `{{DTH_EXPORT_NAME}}` token resolved by the same run.
- **Houdini project folder** (schema v27) — a new field on the Export directory pane. When set, everything exports into `<export dir>/<folder>/dth-export/<scene subfolder>/` — Set-Project a Houdini project to `<export dir>/<folder>` and import via `$JOB/dth-export/primary/Ita_primary.dth`. Overridable per Daz scene (including to empty = that scene exports flat). New characters seed `<Project>_<Character>`; existing characters keep the flat layout untouched until they opt in.
- **Export-folder housekeeping** — every character records which export folders its layout generates, and on the next save after a layout change (renamed/cleared project folder, moved scene subfolder) the previous layout's folders are removed from the export directory. Only recorded folders inside the current export directory are ever touched; clearing the export directory deletes nothing.
- **`$DAZ3D_LIB` in houdini.env** — with My DAZ 3D Library and the Houdini documents folder(s) set, the studio maintains a `DAZ3D_LIB` variable in each configured `houdini.env`, so Houdini networks can reference Daz library files as `$DAZ3D_LIB/…` instead of hardcoded machine paths. Kept current on every Settings save and by Tools → Refresh assets; applies on the next Houdini start.

Runtime v40 — Tools → Refresh assets regenerates existing scripts + CSVs.
