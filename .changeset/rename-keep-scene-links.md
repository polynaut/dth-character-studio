---
"@dth/web": patch
---

Fix Daz scenes becoming "unlinked" after renaming a character. Renaming renames
the character's folder, but the stored scene/Houdini paths still pointed at the
old folder name, breaking any scene stored inside the character folder. Renaming
now repoints those in-folder paths to the new folder (scenes linked in place
outside the folder are left untouched).
