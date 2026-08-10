---
# patch: a fix to what an import produces — no new field, no new switch, but
# every Scan_Frames CSV that lands from now on lands differently.
'@dth/rom': patch
---

**A Scan_Frames import lands with names Houdini accepts.**

Daz property labels are prose — `Torso Muscular`, `5 Belly Shape Muscular`, `!Breast Large`, `Shape NAVEL FOR PEAR` — and Houdini takes letters, numbers and underscores only. Imported verbatim, a scanned FBM section arrived as a grid of rows the editor immediately flagged red, and the only way forward was retyping dozens of names by hand.

The import now strips what Houdini rejects: `Torso Muscular` becomes `TorsoMuscular`, which reads the same to a human and passes. Nothing is lost — the raw Daz property stays on the morph and is still what the Parameter-name column shows, so each row says exactly which morph it drives.

This applies to what the studio *derives* on import, not to what you type: the editor still flags an illegal name you enter yourself rather than silently rewriting it.
