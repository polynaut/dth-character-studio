---
'@dth/rom': minor
'@dth/web': minor
---

The ROM script now finds and selects the character's figure by itself (runtime v28). Forgetting to select the figure — or having something else selected — no longer aborts the run: the runtime locates the scene's figure of the character's Genesis generation by its source-asset identity, which survives any node renaming (labels and names are user-editable; the `.dsf` a figure was instantiated from is not), selects it and proceeds. With several matching figures in a scene the first one wins. Only a scene containing no figure of the character's generation still stops with an error.
