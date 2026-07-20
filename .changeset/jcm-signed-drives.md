---
'@dth/web': patch
---

Modify JCM frames: dropped the redundant per-drive positive/negative selector — a drive's direction is now read from its angle range's sign (e.g. `Angle to` −115 = the negative bend), so a rule holds one signed drive list. Existing characters migrate automatically (the two lists merge) and the generated Daz script is byte-for-byte unchanged.
