---
'@dth/web': minor
'@dth/rom': minor
---

The export folder moved into the Houdini folder, as `daz-export`

A character's Daz→Houdini exports now land in
`<character>/houdini/daz-export/` instead of `<character>/daz3d/dth-exports/`.

Nothing in Daz ever opens these files again — the `.dth`, `.fbx` and `.abc` exist
to be imported by Houdini — so they belong beside the `.hip` that reads them, not
beside the scenes that produced them. Hence the name too: `daz-export` is *the
Daz export*, read from the Houdini folder it now sits in. A generated project
reaches it as `$JOB/houdini/daz-export/…`, one folder down instead of one up.

**Your existing exports come with it.** Each character carries its files across
the next time it is saved, and the emptied old folder is removed — **Tools →
Refresh assets** does the whole project in one go. Only the folders the studio
wrote are moved; anything else you kept in there stays put.

**A Houdini project generated before this still names the old folder**, so its
imports report as broken on the character page. **Utils → Make paths portable**
now repairs that case: where every import broke at once — which is what a folder
move does — there is no surviving sibling path to follow, so it rebuilds them
from the character's current export directory instead. As before, a path is only
written when the file it points at actually exists.

Two smaller consequences: **Settings → Project → Houdini projects subfolder** is
no longer greyed out when *Create the Houdini subfolder in new characters* is
off, because the export root lives in that folder whatever the toggle says; and
deleting a character with **keep the Houdini files folder** still removes
`daz-export`, since keeping your `.hip` files should not quietly keep gigabytes
of regenerable output with them.
