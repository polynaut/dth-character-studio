---
'@dth/rom': patch
'@dth/web': patch
---

Running a character's visible `ROM_…` script by hand no longer saves the
scene as `rom-animations/<stem>_ROM.duf` (runtime v103). That save is the
DTH-Export flow's job — the hidden carriers still write it — but the manual
script did it too, silently overwriting the flow-built ROM on disk and
repointing the open scene's filename to the `_ROM.duf`. A manual run now
builds the ROM on the timeline and stops. Run Tools → Refresh assets to
regenerate installed scripts.
