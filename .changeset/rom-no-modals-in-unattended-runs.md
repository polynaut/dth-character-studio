---
'@dth/web': patch
'@dth/rom': patch
---

A failed unattended run no longer freezes Daz Studio.

Measured on DS 4.24: a `MessageBox` in a script the Runner executes waits
forever for a click nobody is there to make. What that looks like from outside
is not a dialog — it is Daz's log stopping dead at `Loading script` with nothing
after it, no "Script executed successfully", CPU flat, and the batch row never
completing. It is indistinguishable from a hung `include()`, which is exactly
where the hunt goes; the runtime being blamed is working perfectly. The tell is
that the script's own side effects already happened (the failure log is written,
with the right content) and Daz's main window is *disabled* rather than visibly
modal.

Every hidden (dot-prefixed) carrier — the ones the Runner executes — now reports
its failures to the log and the run report instead of opening a dialog, and a
test pins that. The visible Content Library scripts keep their dialogs: a human
double-clicks those, and there the dialog is the point.

Two of the three carriers were reachable in ways the existing guard missed.
`.Build_ROM_Animation.dsa` is generated with `bulk = false` (it wants the
interactive script's shape) yet is executed by the Runner, so gating dialogs on
"is this the bulk variant" left precisely that carrier able to hang a run —
"unattended" is now its own flag. And the export carrier's existing `unattended`
switch only reached the export block, so the two guards that fire *first* — the
wrong scene, and no figure in the scene — could still stop everything.

Also fixed: when the runtime genuinely cannot be loaded, the error named a path
the script had never looked in (Daz's own `resources` folder), because the
runtime files reassign the `dir_self` the message was built from. The script now
captures its own folder before the first include and reports that, so the
message stops accusing a healthy install of being broken.
