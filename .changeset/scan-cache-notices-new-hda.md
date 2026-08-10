---
# patch: no new capability, no new command — a cache key that was missing a
# component it always depended on, plus the docs that recorded the old measurement.
'@dth/web': patch
---

**A newly installed DazToHue no longer reads as the old one.** The Houdini project scan is cached per `.hip` so reopening the Utils drawer costs nothing, but its key was the project path, its modification time and the export root — not the DazToHue libraries the scan was speaking. So a verdict phrased in the installed version's vocabulary outlived the install that replaced it: with `DazToHuePoseAsset.hda` 2.5.1 sitting in `otls/`, the General tab kept reporting *"Your DazToHue version has no `pose_asset_csv_file_path`"* — and Rescan could not clear it, because Rescan is served by the same cache. Only re-saving the `.hip` in Houdini would have.

The key now includes a fingerprint of the operator libraries hython will load (name, size and modification time of each `.hda`/`.otl` in the paired prefs folder), so installing, updating or removing one invalidates every affected entry. Existing entries are re-scanned once, in the background, the first time each project is looked at.

**And Rescan now actually rescans.** It went through the same cache, so on a project whose entry looked fresh it returned the stored answer in a few milliseconds — no hython, no change on screen, indistinguishable from a dead button, and no way out of a wrong verdict. It now bypasses both cache layers and re-reads every project with hython, and says how many it read when it is done.

Consequence on 2.5.1 and newer: the PoseAsset CSV path stops being reported as missing and starts being offered — *Fill network* writes it like every other blank parameter, with no further change needed.
