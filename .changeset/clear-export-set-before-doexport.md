---
# patch: a fix to what the generated export scripts do before running the
# exporter — no new capability, no schema change.
'@dth/rom': patch
---

**The export clears the scene's previous export set before the exporter runs — which un-breaks Daz Studio 4 exports (runtime v69).**

Measured 2026-08-11: the Daz Studio 4 exporter plugin (2.0.2) **skips the per-frame ROM walk when its output files already exist** — the run finishes in seconds instead of minutes, the viewport never plays through the ROM, and the Alembic is rewritten with the full time range but every frame identical to the rest pose. Fresh timestamps, clean run log, no error on any channel: the export *looks* refreshed and imports as a motionless character in Houdini. Into an empty folder the same build exports correctly, and Daz Studio 6 never skipped.

The generated scripts (ROM + export, the bulk carriers and the standalone Export script) now delete the scene's own export set — `<Name>.dth/.abc/.fbx`, `_base`/`_experimental_rom.fbx`, the delivered `_pose_asset.csv`, the `_Hair_*_grooms.abc` files and the `Reference Skeletons/<Name>_frame_*.fbx` — right before `doExport`, so the exporter always sees an empty target. Two smaller wins ride along: grooms of a renamed hair item and reference skeletons of an outdated frame layout no longer linger beside a fresh set. Anything else in the folder (your zips, other scenes' sets) is not touched.

**Run Tools → Refresh assets once** (or re-save each character) so the scripts on disk pick the change up — and if you exported through Daz Studio 4 since **Aug 9**, re-run those exports: their Alembics are static.
