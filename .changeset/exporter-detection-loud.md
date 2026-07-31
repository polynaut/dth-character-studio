---
'@dth/rom': patch
---

fix: a missing DTH Exporter no longer fails silently, and the ROM save stops lying

Two problems found on a live Daz Studio 4.24 run.

**The export could be skipped without telling you.** If the DazToHue Exporter action isn't registered, the ROM script used to write one line to Daz's log and finish — so the ROM completed "successfully" and nothing anywhere said the export never ran. It now raises a dialog, and names the actual cause: the Exporter Plugin has **separate builds for Daz Studio 4 and 6**, so having it installed isn't enough — it has to be the build matching the Daz you're running. (The standalone hair-export script was already loud; this brings the ROM script in line.)

**"Could not save the ROM scene" when the save worked.** The script judged the save by `saveScene`'s return value, and every Daz build disagrees about what that is — a bool, a `DzError` where `0` means success (Daz 6, fixed in runtime v45), and nothing at all in Daz 4. So a perfectly good save was logged as a failure while Daz's own log said "Saved Scene". It now checks whether the file is actually on disk, which no Daz version can disagree about.

Runtime v49 — Refresh assets regenerates the scripts.
