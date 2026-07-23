---
"@dth/web": patch
"@dth/ui": patch
---

Character-editor identity block + scene-footer polish:

- **Genesis-9 dials on one row** — FACS detail / flexion strengths and the UE5 tear-UV switch drop their fieldset border and legend and sit on a single row.
- **Genesis is creation-only** — it can't change after a character is made, so its selector is removed from the editor. **Gender** moves to its own row at the bottom of the identity block.
- **"Daz scenes" title** now matches the other section titles (ROM, Advanced options, …).
- **Override toggle** reads muted grey-green with a white knob when off, so an inactive override is clearly distinct from an armed one.
- **Scene footer** appears the moment the Daz-scene cards scroll off (keyed to the cards grid) instead of waiting for the whole panel — the "Add scene" button and all — to leave.
