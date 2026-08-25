---
'@dth/rom': minor
'@dth/web': minor
---

The Daz product scan can now read MULTIPLE DAZ Install Manager manifests
folders. Users who organize their installs across several DIM libraries
(ManifestFiles, ManifestFiles2, …) add the extra folders in Settings —
General (Home window) or the Project tab, under the primary field, which an
activated Daz installation may still derive. The generated scan scripts bake
all folders as one '|'-joined spec (runtime v104 splits it; '|' is illegal in
Windows paths), a missing folder skips only its own manifests, and adding or
removing a folder re-flags the characters' scripts for Tools → Refresh assets
exactly like moving the single folder always has.
