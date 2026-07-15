---
'@dth/rom': patch
'@dth/web': patch
---

Bone scale is now limited to GEN and FBM poses — a reference-FBX path on a MIS row breaks the DazToHue HDA's CSV import (verified in Houdini), so the toggle is hidden in MISC and generation never emits reference paths or exporter reference frames there. Refresh assets regenerates any CSV that carried one.
