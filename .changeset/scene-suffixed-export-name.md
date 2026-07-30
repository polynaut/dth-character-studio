---
'@dth/rom': patch
---

feat(rom): export files carry their scene in the name. The figure name handed to the DTH Exporter is now scene-suffixed at run time — `Ita` exporting from the `Summertide` scene writes `Ita_Summertide.abc`/`.dth` (and matching reference-skeleton FBXs) instead of yet another `Ita.*` — so the per-scene export subfolders no longer all hold identically-named files. The PoseAsset CSV's bone-scale reference-FBX paths follow via a new `{{DTH_EXPORT_NAME}}` token resolved by the same run: exporter output and CSV pointers stay in lockstep (runtime v40 — Tools → Refresh assets regenerates existing scripts).
