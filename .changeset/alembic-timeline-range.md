---
'@dth/web': minor
'@dth/desktop': minor
---

Generated Houdini projects now get their **timeline range set from the Alembic file itself** — the same routine DazToHue's Import node runs when it loads a character (read the Alembic's own start/end frames, set the playbar, re-cook the import, back to frame 0). The generation re-runs it deliberately at the end, because the HDA's own trigger is best-effort and never fires when the Daz export hasn't produced the file yet — and the confirmation now names the frames the saved scene actually plays.

The project health check learned the same fact: the scan reads the playbar next to what the project's own Alembic says it should be, and a scene still on Houdini's default 1–240 over a longer ROM gets a "Needs attention" badge — part of the ROM would sit outside the timeline. **Utils → Repair project settings** repairs it in the same run as `$JOB` and the FPS (one file open, one backup, one save), writing whatever the Alembic answers at 30 fps. A project with no Alembic to read yet — generated before its Daz export — is reported as such and left alone, never guessed at.
