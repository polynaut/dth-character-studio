---
'@dth/ui': patch
'@dth/web': patch
---

Make input validation errors clearer. Invalid fields now show a **more visible red
border** (a 2px destructive ring instead of a faint 1px border — both the ROM cell
inputs and the shared `Input` primitive), and a field whose error lived in a `title`
attribute (the ROM name/morph cells) now shows it in a proper **alert-style tooltip**
(red background, light text) via a new `data-tooltip-variant="error"` on the global
tooltip.
