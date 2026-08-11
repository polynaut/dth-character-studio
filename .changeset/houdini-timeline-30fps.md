---
# minor: a new capability on both sides of the Houdini leg — generation bakes a
# value it never set before, and the project checks gained a row with a repair
# behind it. The desktop crate changes too (a new request field on
# create_houdini_project, two new fields on the defaults report).
'@dth/web': minor
'@dth/desktop': minor
---

Houdini projects get the ROM's **30 fps timeline** — set at generation, checked
on the card, repaired from the Utils drawer.

A ROM is one pose per FRAME at 30, and that is what the PoseAsset CSV's frame
numbers mean; Houdini's own default is 24, which lands every imported ROM frame
between two of the scene's own. DazToHue's import node sets the scene FPS itself
*when it loads the files* — which is exactly what a headless **Generate project**
never does (hython instantiates the network and fills its parameters directly), so
the studio now sets it up front and reports the FPS the saved scene actually
carries rather than the one it asked for.

The background scan reads each project's timeline in the same pass as `$JOB`, so
a project on another rate gets a **Needs attention** badge naming it, and a new
**Timeline (FPS)** row in the Utils drawer's General tab. **Repair $JOB** is now
**Repair project settings** and fixes both, each judged on its own — a project
whose `$JOB` is fine and whose timeline is 24 gets only the timeline written, and
the report says which of the two moved. What Houdini's `setFps` does to keys in an
already-animated scene is Houdini's behaviour and is not something this studio has
measured; the run's usual rolling backup is stated alongside it. A value the scan
could not read stays *unknown* and is never repaired.
