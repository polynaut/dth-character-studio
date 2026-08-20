---
'@dth/web': minor
'@dth/desktop': minor
---

**Renaming a character now takes its exports with it.** The exporter names every file it writes after the character — and, measured on a real export, writes the name *inside* them too: a `.dth` carries `"Character Name"` and absolute paths to its own `.fbx`/`.abc` siblings. So a rename used to leave a full export set on disk that nothing would ever write to again, while the Houdini projects went on importing it by the old name — silently, because those files still exist and still load.

Renaming a character that has **no** exports yet is unchanged: it just renames. Renaming one that **does** now opens a dialog first, itemizing both export folders (the Daz→Houdini `daz-export` set and the final `export/` tree) with their file counts and sizes — one scene's set is routinely a gigabyte — and saying plainly that they are deleted, not renamed, and that a **DTH Export** run rebuilds them. Cancel and nothing happens at all. Your Daz scenes, saved ROM animations and Houdini project files are never touched.

Confirming clears both folders and then **follows the rename into every linked Houdini project**: each DazToHue import path is rewritten to the new export names (and to the new character folder, whose `$JOB` is repointed in the same pass), and each import node's **character name** is moved to the new name — unless you had typed your own there, which is reported and left alone. Paths on your *own* nodes are reported too, never rewritten. Each project is backed up before it is saved, and if Houdini isn't paired in Settings the dialog says so *before* you commit to anything.

Under the hood this is a new `retarget` operation on the Houdini utilities. It is deliberately not the existing **Make paths portable**: that one only ever writes a path it has verified on disk, and after a rename there is nothing to verify — the old set is gone and the new one doesn't exist until you re-export. Which is exactly the point: the projects are pointed at what the *next* export will produce.
