---
'@dth/web': patch
---

Starting a new ROM run now clears the previous run's report instead of leaving it over a live progress bar. The red "Errors in the last ROM run" button and the red ROM rows used to disappear only when Daz eventually wrote a new log, so they sat there for the whole run. A **DTH Export** run retires the whole report; **"Generate new ROM"** on a scene card retires only the scene it rebuilds, leaving the other scenes' findings alone. Both clear the report on disk as well as on screen — which also stops old failures from being merged into the new run's report (the run log merges per scene, so a scene the new run doesn't touch used to stay failed forever) and from being re-raised by the character page's on-focus refetch.
