---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Second full-codebase audit pass: the asset dedup now refuses duplicate-listed or nested source folders (previously it could quarantine the only real copy), quarantining a folder junction moves the link instead of copying its target, and zip installs refuse partial inventories; saves that persist but fail to regenerate scripts no longer report unsaved changes or roll back your edits, renaming inline can no longer race a running save, edits typed during a slow scene copy survive, case-only renames of character folders work on Windows, and notes autosave no longer rescans the whole library per pause; clearing a number field reverts instead of committing 0, the Tools page reconciles settings across windows like Settings does, mirrored pose groups now flip stock Daz `_L`/`l_` side markers, and the physics block length is validated against the PoseAsset template.
