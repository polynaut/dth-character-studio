---
'@dth/web': minor
---

Houdini Utils: run DazToHue's own **Refresh Assets** from the General tab

A `.hip` keeps the DazToHue asset definitions it was built with, so switching
your installed DazToHue release leaves every project you already have on the old
ones. The General tab now runs DazToHue's own **Refresh Assets** shelf tool
against every project the scan could open, instead of you opening each one in
Houdini by hand. It is an action rather than a check — nothing records which
release a project's assets came from, so nothing can tell you one needs it — and
the report says only what was observed: the tool that ran, and whether the scene
came back modified. A project reporting no change is left alone rather than
re-saved, and a run takes the same rolling backup as the tab's other actions.
