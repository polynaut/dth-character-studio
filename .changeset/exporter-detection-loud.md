---
'@dth/rom': patch
---

fix: a missing DTH Exporter no longer fails silently, and the ROM save stops lying

Two problems found on a live Daz Studio 4.24 run.

**The export could be skipped without telling you.** If the ROM script couldn't reach the DazToHue Exporter, it wrote one line to Daz's log and finished — so the ROM completed "successfully" and nothing anywhere said the export never ran. It now raises a dialog. (The standalone hair-export script was already loud; this brings the ROM script in line.)

**And it can now tell two very different causes apart.** Daz Studio 6's exporter registers under one class name, Daz Studio 4's under another, so the old class-based lookup reported "not installed" for a plugin sitting right there. It finds both now — but finding it isn't the same as being able to use it. Being callable from Daz script is a **Daz Studio 6** exporter-plugin feature; the Daz Studio 4 build registers its action and exposes no scripted export at all, only its own dialog. Run the ROM script there and you're now told exactly that — run it from Daz Studio 6, or export by hand — instead of being told the plugin isn't installed when it plainly is.

**"Could not save the ROM scene" when the save worked.** The script judged the save by `saveScene`'s return value, and every Daz build disagrees about what that is — a bool, a `DzError` where `0` means success (Daz 6, fixed in runtime v45), and nothing at all in Daz 4. So a perfectly good save was logged as a failure while Daz's own log said "Saved Scene". It now checks whether the file is actually on disk, which no Daz version can disagree about.

One exception, deliberately: the hidden scripts the **Runner** executes raise no dialog. A modal there doesn't warn anyone — it stops an unattended batch on a click nobody is present to make, with every remaining scene queued behind it. (That applies to the "hair item not found" alert too, which had that problem already.)

Instead — and for interactive runs as well — **the problem is recorded in the character's run log**, so it shows up in the studio's run report the moment you come back. Without that, a bulk export against a Daz that can't export would complete every scene, export nothing, and tell you nothing. It appends rather than overwrites, so a successful ROM keeps its result; an export-only run that had no ROM gets a log of its own.

Runtime v49 — Refresh assets regenerates the scripts.
