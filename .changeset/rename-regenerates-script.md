---
"@dth/web": patch
---

Renaming a character now regenerates its files and cleans up the old script.

A character's generated script is named `<Name>_<Genesis>.dsa`, so renaming
changed the filename and left the old-named script orphaned in the shared
`Scripts/DTH-Character-Studio` folder (while the new one wasn't written until the
next save). Renaming now regenerates at the new name and removes the stale
previous-named script — and likewise drops the old-named `<Name>_PoseAsset.csv`
in the character's folder. (The folder itself moves with the rename.)
