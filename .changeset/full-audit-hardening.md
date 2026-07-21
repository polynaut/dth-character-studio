---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Full-codebase hardening pass: every file write is now atomic and newer-version character files are reported instead of silently stripped; dedup honors "keep this copy" across same-named duplicates, reports every failed quarantine move, and handles Windows case differences; linking scenes/Houdini projects/avatars validates and regenerates artifacts exactly like Save; dialogs, side panels and the morph autocomplete are fully keyboard-accessible; and Refresh, installs, pose measurement and heavy editor screens are significantly faster.
