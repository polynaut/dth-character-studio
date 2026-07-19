---
"@dth/web": patch
"@dth/rom": patch
---

Fix a ROM-build regression (runtime v30): the base-ROM tail close-out no longer double-applies character-owned morphs. Since v26 it ran a whole-figure re-key at the FAC→GEN boundary using each morph's post-ROM value; for a morph the character or a GP/character preset drives (e.g. ProportionHeight), that stacked the value on top of the ERC-driven contribution, so a -10% dialed height showed as -20% by frame 327. The runtime now snapshots the morph baseline before the ROM loads and leaves any character-dialed (non-zero base) morph untouched — only pure ROM poses (the final FAC neck pose that v26 was added to fix) still close their dangling tail. Re-run the ROM script in Daz (Tools → Refresh assets) to rebuild affected timelines. Found by Soltude80's testing.
