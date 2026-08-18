---
'@dth/web': patch
---

The read-only Export directory info now lives at the bottom of the "Daz scripts generated" panel instead of its own panel. The three places that pointed at the old panel now say what to actually do: a character with no folder of its own has no export directory and nothing can be "set" there — move it into a folder (the DTH Export button's hint, the Generate project button's hint, and the DTH Export precondition error).
