---
'@dth/web': minor
'@dth/desktop': minor
---

The DTH Export dialog's Houdini list now follows the scene selection. Tick a Daz scene off and the projects that only import that scene leave the run with it; tick it back on and they return. The match is the same one Houdini itself makes at export time — a project belongs in the run when one of its networks imports a selected scene's `.dth` file — so what the dialog shows and what the run exports can't disagree. Network and project NAMES are deliberately not consulted: they get renamed and copied around, the import path doesn't.

That knowledge comes from the background project scan, which now records each project's imported `.dth` files alongside its nodes, `$JOB` and fps (no extra Houdini launch — it reads them in the same pass). A project only ever leaves the run when its imports actually name a scene you unticked. Everything short of that keeps whatever you have: a project the scan hasn't reached yet — outside the character folder, or saved in Houdini since the last sweep — and one whose imports match none of this character's scenes either way, which is what a path spelled differently on the two sides (a mapped drive, an old junction path) looks like from here. The studio can't know in those cases, and quietly dropping a project would skip the Houdini half of a run you asked for.
