---
"@dth/web": patch
"@dth/rom": patch
---

Groom (hair) exclusion is hide-only now (runtime v31). DTH Exporter Plugin 2.0.1 moved the unfit+unparent step into the plugin — it unparents any hidden child node before exporting and reparents it after — so the generated script only has to HIDE the groom items and the plugin excludes them from both the FBX and the alembic. The script's own detach path (unfit+unparent+refit) and the app-global "Solve hair assets by hiding" setting are gone; hiding is the single mechanism. Refresh assets regenerates existing characters onto the simpler export block. Because hide-only now needs Exporter Plugin 2.0.1+ (an older one would export the hidden hair into the FBX), the character editor's groom section reads the installed plugin's DLL version and warns clearly when it's too old.
