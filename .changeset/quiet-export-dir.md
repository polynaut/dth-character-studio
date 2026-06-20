---
'@dth/web': patch
---

Export directory fixes:

- Changing the export folder (set/clear) or the "Generate subfolders based on Daz scenes" toggle now regenerates the character script immediately, so the generated `.dsa` actually picks up the DTH Exporter auto-export block instead of silently lagging behind the saved setting.
- The generated script now **moves** the PoseAsset CSV into the resolved export dir at run time — next to the exporter's `<name>.abc`/`.dth`, and inside the scene subfolder when that option is on. Previously the studio dropped the CSV in the export root at generation time, where it couldn't account for the run-time scene subfolder (so it landed in the wrong place and was duplicated).
- Dropped the false "this folder is inside the project" warning — exporting into a folder inside the project (e.g. a Perforce-tracked `characters/<Name>/houdini`) is a valid setup; the exporter's own character subfolder nests there fine.
