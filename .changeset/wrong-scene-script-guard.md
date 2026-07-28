---
'@dth/rom': minor
---

Every generated per-character Daz script (ROM, Export, Hair export, Product scan) now refuses to run when the open Daz scene isn't one of the character's linked scenes — an error dialog names the open scene and the linked ones (the ROM script also writes the run log), instead of silently applying everything to the wrong scene. Runtime v36: Tools → Refresh assets regenerates existing scripts with the guard.
