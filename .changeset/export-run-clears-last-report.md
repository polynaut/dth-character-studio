---
'@dth/web': patch
---

Starting a new ROM run now clears the previous run's report instead of leaving it over a live progress bar. The red "Errors in the last ROM run" button and the red ROM rows used to disappear only when Daz eventually wrote a new log, so they sat there for the whole run. A run now retires exactly the scenes it re-runs — a **DTH Export** batch its selection, **"Generate new ROM"** the one scene it rebuilds — so the findings of a scene the run never opens survive, because nothing else is going to rewrite them. An **Export only** run retires nothing at all: it rebuilds no ROM, so the report still describes the ROM it is exporting. Both halves clear together, on disk as well as on screen — which also stops old failures from being merged into the new run's report (the run log merges per scene) and from being re-raised by the character page's on-focus refetch.
