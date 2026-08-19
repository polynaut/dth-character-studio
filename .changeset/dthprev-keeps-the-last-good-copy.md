---
'@dth/rom': patch
'@dth/web': patch
'@dth/desktop': patch
---

Fix: a failed export can no longer destroy the copy that survived the *previous* failed export. Before running the DTH Exporter the studio parks the existing export set aside as `<name>.dthprev`, and puts it back if the run fails. But a run that dies outright — Daz closing, the exporter aborting — never reaches that step, so the backup stays parked with a half-written file beside it. The next export then deleted that backup to make room, on the assumption that the newer file must be the good one. It isn't: measured on a real project, the "newer" files were a 0-byte `.dth` and a 29 MB fragment of an 807 MB Alembic. An existing backup is now understood as the last copy anything finished writing, and it is kept.

Also fixed: the hair Alembics were matched by a name test loose enough to match their own backups, so every export parked the previous backup again — `.dthprev.dthprev.dthprev.dthprev` files, and no live hair Alembic left. Existing stacks clear themselves on the next successful export.

Runtime v99, so **Tools → Refresh assets** reinstalls the generated scripts.
