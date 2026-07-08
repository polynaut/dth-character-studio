---
'@dth/rom': minor
'@dth/web': minor
'@dth/desktop': minor
---

"Run the export with the ROM script" no longer exports when the ROM build had
ANY problem. Runtime v20: failed morphs count as failure too (not just hard
aborts), so a ROM with broken frames can never ship a PoseAsset CSV/FBX as if
it were good — fix the problem and re-run. Regenerate scripts via Tools →
Refresh assets (or any character save).
