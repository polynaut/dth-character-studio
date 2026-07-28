---
'@dth/web': patch
---

Creating a character now pre-selects the primary scene's detected hair items (the same heuristic as the editor's "Select all detected hair items" wand), so the export excludes them from day one — trim the list in the editor if the guess overshoots.
