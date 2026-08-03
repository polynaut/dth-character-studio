---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

The DTH Export dialog gains a fourth run: **Houdini only**. It skips Daz
entirely — the studio opens a linked Houdini project and runs its DazToHue
exports off each selected scene's last Daz export as it stands on disk, the
standalone version of the "Export too" leg. For when the Daz side hasn't
changed and only Houdini needs a fresh pass: no ROM rebuild, no Runner, no
waiting on Daz. Scenes that never delivered an export are named and kept out
of the run, and the header button tracks the Houdini session's progress as
usual.
