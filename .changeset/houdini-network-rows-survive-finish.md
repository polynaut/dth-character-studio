---
'@dth/web': patch
'@dth/desktop': patch
'@dth/rom': patch
---

Fix: a finished Houdini project no longer collapses its task rows back to one. The run's list is one row per DazToHue **network**, but only the project being exported right now could name its networks — so the rows went 1 → N → 1, and a two-project run that really exported four networks showed two rows for the whole thing. Each project's rows now survive its turn, keeping the status the run gave them: a failed network stays failed, and one an interrupted queue never reached stays unstarted rather than being ticked off.
