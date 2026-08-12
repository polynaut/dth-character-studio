---
'@dth/web': minor
'@dth/desktop': minor
---

The DTH Export dialog's Houdini list now follows the scene selection. Tick a Daz scene off and the projects that only import that scene leave the run with it; tick it back on and they return. The match is the same one Houdini itself makes at export time — a project belongs in the run when one of its networks imports a selected scene's `.dth` file — so what the dialog shows and what the run exports can't disagree. Network and project NAMES are deliberately not consulted: they get renamed and copied around, the import path doesn't.

That knowledge comes from the background project scan, which now records each project's imported `.dth` files alongside its nodes, `$JOB` and fps (no extra Houdini launch — it reads them in the same pass). A project the scan hasn't reached yet — outside the character folder, or saved in Houdini since the last sweep — is never un-ticked on that ignorance: the studio can't know what it imports, and quietly dropping it would skip the Houdini half of a run you asked for.
