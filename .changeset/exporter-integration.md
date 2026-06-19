---
"@dth/web": minor
"@dth/rom": minor
---

Integrate the DTH Exporter Plugin's new scripting hook (v1.8.1+). A character now
has an **export directory** (editor → Export section); when set, the generated
Daz script runs the exporter automatically after building the ROM —
`dthExportAction.doExport(exportDir, characterName, referenceFrames, false)` — so
one script builds *and* exports, no dialog. The reference frames are derived from
the ROM's reference-skeleton poses (the poses carrying a `referenceFbx`), passed
space-separated. The exporter creates its own `<characterName>` subfolder, so the
export directory should sit outside the project (the editor warns otherwise).
Adds `exportPath` to the character schema (→ `CHARACTER_SCHEMA_VERSION` 3).
