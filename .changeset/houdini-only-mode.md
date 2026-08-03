---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

The DTH Export dialog is **one page** now — and it drives Houdini on its own.
**Daz scenes** and **Houdini projects** are two card lists with checkboxes,
each with its own **Mode**. The Daz modes are the familiar three plus **Skip
Daz — use last exports**: nothing runs in Daz, the selected projects work off
each scene's last delivered export (scenes without one are named and kept out
of the run). The Houdini modes are **Open only** (exactly one project),
**Export selected scenes** (the default) and **Export all**; several selected
projects export one after another, and the projects come pre-selected
whenever scenes do — a plain Start does the whole round trip, Daz through
Houdini. ROM only is the exception: it builds no fresh export, so nothing
pre-selects there and a hand-picked project can only be opened. The "Export
too" switch and the mode cards are gone; their jobs moved into the lists.

Houdini also opens **fully before the batch starts** now — for "Export too"
runs as well. The exports used to grind inside Houdini's startup, holding the
window back until the last node finished; the batch now waits for the UI plus
a few seconds for the viewport to finish its first cook, so you watch the
export against a rendered character instead of staring at nothing.

And the run reporting keeps up with runs that outlast your attention span:
the progress buttons carry a **live clock** and the app's mark for whichever
side is working ("Exporting 1/3 · 4m 12s" with the Daz logo, the Houdini one
for its leg), and the finish report is **one summary at the very end** of the
whole process — the Daz leg, every Houdini project's result and the total
time — sticky on screen until you close it (or a new run supersedes it, or
you leave the page) instead of vanishing on a timer while you're away.
