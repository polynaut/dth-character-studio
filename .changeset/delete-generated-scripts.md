---
"@dth/web": patch
---

Deleting a character or project now also removes its generated Daz script folder
from the library (`…/Scripts/DTH-Character-Studio/<project>/<character>/` for a
character, the whole `…/<project>/` folder for a project). These are derived
artifacts that were previously orphaned on delete. The script cleanup runs
regardless of the "keep files" toggles, since the scripts are always
regenerated from the character definitions.
