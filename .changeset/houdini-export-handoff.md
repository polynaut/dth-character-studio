---
'@dth/web': minor
---

feat: the groundwork for exporting a Houdini project from the studio — the job-file handoff and the Houdini-side runner.

`houdini-runtime/456.py` is the half that runs inside Houdini: it does nothing at all unless the studio launched the session with a job, then finds every DazToHue export node whose network imported one of the selected scenes and triggers them in turn. It matches networks to scenes by the `.dth` path the studio itself wrote, so renaming a network doesn't break it, it answers the HDA's "Continue anyway?" check itself and keeps the text for the report rather than letting it vanish, and it never saves the scene or leaves a parameter changed behind it.

Not yet wired to the DTH Export dialog — the launch, the result polling and the "Export too" toggle come next.
