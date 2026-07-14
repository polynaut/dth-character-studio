---
'@dth/rom': patch
'@dth/web': patch
---

Add a **Set UE5 tear UV** toggle to a character's Advanced options (Genesis 9 only,
opt-in, off by default). When enabled, the generated ROM script switches the
Genesis 9 Tear figure's shader UV set to "UE5" during the build — so DTH's Lacrimal
Fluid material lines up without the manual Surfaces-tab step, and it can't be
forgotten. Character schema → v9 (additive `applyUE5TearUV`, no migration step).
