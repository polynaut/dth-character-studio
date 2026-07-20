---
'@dth/rom': patch
'@dth/web': patch
---

Fix the "Modify JCM frames" grid swapping the row you're editing when you Mirror or remove a rule/drive above it. Each rule and drive now carries a stable id used as its React key (instead of the list position), so a mid-list insert no longer re-binds a focused input to a different row. The ids are editor-only — they never reach the generated Daz/Houdini output.
