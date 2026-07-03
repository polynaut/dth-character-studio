---
'@dth/web': minor
---

**Install Daz assets** report: each source folder is now a collapsible section. The folder header row (with an asset count) toggles its group of asset rows, so long multi-folder scan reports can be skimmed folder by folder. Folders that need attention (files to copy, or a scan error) start expanded; all-skipped folders ("already installed") start collapsed. The per-asset "files to copy" expansion works as before, and reports without folder headers (DTH release/plugin installs, morphs, Houdini presets) render unchanged.
