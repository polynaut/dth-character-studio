---
'@dth/rom': minor
'@dth/web': minor
---

feat: DTH Export asks what the run should do first — three modes:

- **ROM + Export** (the default): build a fresh ROM, save the ROM animation scene, export everything (skeletal mesh + hair). Unchanged behaviour.
- **ROM only**: build the ROM and save the `.ROM_Animations` scene, skipping the export. Needs no export directory.
- **Export only**: export the saved ROM animations as they stand, hair included, without rebuilding — for a ROM you edited by hand in Daz. It pre-selects the scenes whose ROM animation is newer than their last delivered export, and skips scenes that have no ROM animation yet.

Export-only rows open the saved ROM animation instead of the source scene, so every generated script now resolves such a file back to the scene it was built from (the wrong-scene guard included) — running any generated script on a ROM animation by hand works now instead of being refused. Only the full ROM + Export run marks scenes as exported. Runtime v46; Refresh assets regenerates the scripts and adds the new hidden `.Bulk_Export_Only.dsa`.
