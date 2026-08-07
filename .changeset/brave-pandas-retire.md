---
'@dth/desktop': minor
'@dth/web': minor
---

**The `houdini-project` folder is retired, and the empty ones are cleaned up.**
It was created inside every character's houdini folder to be the shared
**Set Project** target — the one project folder all of a character's scenes
would share. It could never do that job: Houdini writes its own output (renders,
caches, backups) relative to **`$HIP`**, and `$HIP` is *derived* from the folder
the `.hip` sits in. Set Project sets `$JOB`, not `$HIP`. So the output always
landed beside the scenes and the folder stayed empty.

Nothing is lost, because the houdini folder was already doing it: every one of a
character's scenes lives there, so they already share one `$HIP` and their output
already collects in that single folder.

**Existing folders are removed on the next save or Refresh assets — but only
when empty.** A project made before v0.64 *did* have `$JOB` pointed at this
folder, so Houdini may have written real caches or renders into it. That is your
output, not the studio's, so a non-empty one is left exactly where it is and
named in the Refresh assets report for you to look at.

**Settings/Utils → General no longer reports `$HIP`.** It is derived from the
scene's own location and can never be anything else, so the row was a check that
could not fail beside an action that could not run. `$JOB` — the one the studio
can actually repair — is now the only row.
