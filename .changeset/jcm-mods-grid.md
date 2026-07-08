---
'@dth/web': minor
'@dth/rom': minor
'@dth/desktop': minor
---

"Modify JCM frames" — a proper grid UI in the JCM section for bone-rotation
morph drives (formerly a raw JSON array buried in Advanced Options). Add rules
(bone + rotation axis) and per-rule morph drives with angle→value ranges split
by rotation direction; the Morph name field autocompletes from the scanned
morph index. The old JSON textarea is gone.
