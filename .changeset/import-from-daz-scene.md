---
# minor: a new way to produce the import (the studio drives Daz), plus a
# runtime bump — not a rename.
'@dth/web': minor
---

**"Import from CSV" is now "Import from Daz scene" — the studio makes the scan for you.**

Producing a ROM import used to be a trip through Daz: select the figure's root node, find `Scan_Frames` in the content library, run it, read the dialog, come back. Now you pick the scene and the studio does that: it opens the `.duf` in Daz Studio through the job runner, runs `Scan_Frames` there with no dialogs, waits for the CSV and takes you straight to the frame-range picker.

Before it offers to scan, it checks the scene: **exactly one figure**, **the character's own Genesis generation**, and **animation on the timeline** — the inverse of the add-scene check, since a scan with nothing keyed has nothing to read. A failed check blocks the scan and says why, with the usual "anyway" escape.

**Scans you already made are still listed**, and that is deliberate: one scan of a scene feeds several ROM sections, so importing FBM after RET should not re-run Daz. Browsing to a hand-curated CSV still works too.

The wait has a way out. A Daz Studio that is already open but has no **Runner plugin** never picks the scan up, so the studio takes the job back after a few seconds and says so instead of waiting on it; a scan it started itself can be dropped with **Cancel scan**, or by closing the dialog. Either way the handoff is released — a job left waiting would block your next export batch.

Needs the Runner plugin installed (the same one DTH Export uses) and the DTH runtime in your Daz library.
