---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Houdini Utils: **Defaults** is now **General**, and it leads. It is the tab the
drawer opens on — the one that answers "are these projects healthy?" without
needing a second project picked — and its checks were rebuilt as one row shape:
name on the left, verdict on the right, the value beneath. The `$JOB` essay
moved into the section's info popup, the three actions carry their own icons in
the order they must be run, and the footer states the whole tab's verdict rather
than only the `$JOB` repair's. Three stacked result panels are now one slot, so
a fresh run replaces the last answer instead of piling another report under it.

**Backups became a safety net instead of a status line.** Every run that writes
still takes one rolling `backup/<name>_dthbak.hiplc` first, but no report says
so any more — "· backup written" on every success only taught the eye to skip
the line. It surfaces exactly once, where it is worth something: a failed entry
now offers **Undo this run**, which puts that project back the way it was before
the run (a plain file copy — no Houdini round trip). A failed save carries its
backup into the report so the offer is there when it matters.
