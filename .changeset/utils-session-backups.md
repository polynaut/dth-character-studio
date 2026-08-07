---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Houdini Utils backups now last as long as the drawer. They are an undo buffer
for one sitting, not an archive — each is a full copy of the project (~8 MB for
a real `.hiplc`), one lands beside every project a run writes, and nothing else
in the studio would ever collect them.

Closing the drawer now lists the copies this session made and asks: **Remove**
clears them, **Keep them** doesn't, **Cancel** goes back. If a run failed and
hasn't been undone the prompt says so in amber — that copy is the only way back.
Only the studio's own `_dthbak` files are ever deleted; Houdini's own backups
sit in the same folder and are never touched, and a file Houdini is holding open
is reported as kept rather than silently counted as removed.
