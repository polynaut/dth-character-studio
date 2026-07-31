---
'@dth/rom': patch
'@dth/web': patch
---

fix: old ROM animations are cleaned up, and the folder rename actually happens

Two problems with saved ROM animations.

**Renaming a Daz scene left its ROM animation behind forever.** The saved file is named after the scene it came from, so a rename just starts writing a new one beside the old — and Daz saves two thumbnails with each, so every rename stranded three files. They're retired on the next save now. Only files the studio itself wrote are touched, and only next to scenes the character still uses.

**The `.ROM_Animations` → `rom-animations` rename didn't run.** It renamed the folder onto itself, which did nothing at all — so anything already saved stayed in the old hidden folder while Daz started filling the new one beside it. Fixed, and the migration now moves those files across as intended.
