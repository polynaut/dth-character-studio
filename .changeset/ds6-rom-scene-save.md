---
'@dth/rom': patch
---

fix(rom): the ROM-scene auto-save (`.ROM_Animations/<stem>_ROM.duf`) never worked in Daz Studio 6 — DS6 removed `DzContentMgr.saveScene`, so the save threw into the best-effort guard: folder created, scene never written. The generated scripts now feature-detect and use DS6's `Scene.saveScene` when the content-manager call is gone (runtime v42; re-save a character or Tools → Refresh assets to regenerate the scripts).
