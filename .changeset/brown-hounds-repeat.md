---
'@dth/web': minor
---

Generate project: pick the scene, and Houdini writes where you meant

Two things a generated Houdini project got wrong on a character with more than
one Daz scene.

**It always imported the primary.** Every scene exports into its own folder, so
an outfit variant's project came out wired to the primary's `.dth`/FBX/Alembic/
ROM-FBX/CSV — five paths to re-pick by hand inside Houdini. The Generate dialog
now has a **Daz scene to import** picker (only when there's a choice; it defaults
to the primary), and the network is wired to that scene's export set. Generate
one project per scene.

**Its export directory pointed at `dth-exports`.** That's the Daz→Houdini
intermediate folder — large, regenerable, the one you don't back up. Houdini's
own Unreal-bound output now goes where the guide always said it would: the
character's **`export/`** folder (`$HIP/../export/`, or whatever your project's
*Final export subfolder* is called). One per character, shared by every scene's
project.

Existing projects are untouched: both the studio and the Houdini-side runner
only ever fill a **blank** export directory, so a project you already wired keeps
exactly what it has. **Utils → Fill network** uses the corrected value too.
