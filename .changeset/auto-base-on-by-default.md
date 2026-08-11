---
# bump: minor — a behaviour DEFAULT changes for every existing character, and the
# generated Daz script changes with it (schema v31 + runtime v70). Nothing is
# removed and no artifact layout moves, so it is not a major.
'@dth/rom': minor
'@dth/web': minor
---

Auto base is on by default for morphs.

A ROM morph is keyed to its value on its own frame and pulled back down on the
frames around it. Until now it was pulled back to zero unless you said
otherwise — which is right for a morph the character doesn't otherwise use, and
wrong for one it does. Reusing a few of the ROM's FBM morphs to build a "shaped"
variant of a character is a perfectly ordinary thing to do, and it left the ROM
flattening part of the base shape on every frame next to those poses.

**Auto** on a morph row fixes exactly that: instead of a fixed **Base**, the
script reads the morph's own value out of the open scene and returns it there.
It is now on for every new morph, however the morph is added — typed in, picked
from the autocomplete, added to a multi-morph row, or imported from a DAZ morph
CSV — and it is turned on for the morphs of every character you already have.

For the morphs a scene doesn't dial, this changes nothing: they read zero at
frame 0 and behave exactly as before. Turn **Auto** off on a row to go back to a
fixed **Base** (or a hard reset to zero) whatever the scene is doing; the
**Base** field is only read when Auto is off.

Existing characters pick the new default up when they are read, and **Tools →
Refresh assets** writes it into their definitions and regenerates their Daz
scripts and PoseAsset CSVs. Run it once after updating; Refresh from the Home
window covers every project in the recents list, and a project window covers the
project it is open on.
