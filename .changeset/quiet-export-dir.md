---
'@dth/web': patch
---

Export directory fixes:

- Changing the export folder (set/clear) or the "Generate subfolders based on Daz scenes" toggle now regenerates the character script immediately, so the generated `.dsa` actually picks up the DTH Exporter auto-export block instead of silently lagging behind the saved setting.
- Dropped the false "this folder is inside the project" warning — exporting into a folder inside the project (e.g. a Perforce-tracked `characters/<Name>/houdini`) is a valid setup; the exporter's own character subfolder nests there fine.
