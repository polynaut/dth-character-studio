---
"@dth/web": minor
"@dth/rom": minor
---

Add a **"Generate subfolders based on Daz scenes"** toggle to the character
editor's Export directory panel. When on, the generated Daz script resolves the
open scene at run time via `Scene.getFilename()` and nests the export under a
subfolder named after it (the exporter's own `<characterName>` subfolder is
created inside that) — so a character's scene/outfit variants export side by
side. Falls back to the export root when no scene is saved. Adds
`exportSceneSubfolders` to the character schema (→ `CHARACTER_SCHEMA_VERSION` 4).
