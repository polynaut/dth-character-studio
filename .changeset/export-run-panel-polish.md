---
'@dth/web': patch
---

DTH Export run display polish, and the Unreal leg becomes re-import only

The run's task list now stacks bottom-up like a log — the first job at the
bottom, the row being worked always right above the progress bar — with one
line per row instead of two, and the whole panel is exactly as wide as the
header's button row instead of out-growing it.

The separate **Interrupt** button is gone: the **Working** button is the
interrupt now. Hover it and the spinner becomes a stop mark (*Click to
interrupt*); a click stops the run at its next safe point, exactly as before.

And the Unreal leg only ever **re-imports**: a set the target project has never
held is dropped from the send and named in the report, and a project holding
nothing the run makes goes inert in the panel. A character's first import into
an Unreal project is made in Unreal itself — from then on, runs re-import it in
place.
