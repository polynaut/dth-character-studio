---
'@dth/web': patch
---

Every **Browse** button now opens the native dialog **where the field already points** — the Daz library, the Houdini documents folder, a linked scene, a Houdini or Unreal project — instead of wherever the OS last happened to be. A field that is still empty starts at the closest folder that makes sense for it: an additional Houdini documents folder opens beside the primary one, the DTH release and Exporter folders open at each other's parent, a second asset or uninstall folder opens beside the first, "Open project" opens at your most recent one, and a character's scene pickers open in the folder its primary scene lives in. File pickers preselect the file that is already set.
