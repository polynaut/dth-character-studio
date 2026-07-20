---
"@dth/web": patch
"@dth/rom": patch
---

Groom (hair) exclusion is hide-only now (runtime v31). mrpdean moved the unfit+unparent step into the DTH Exporter Plugin — it unparents any hidden child node before exporting and reparents it after — so the generated script only has to HIDE the groom items and the plugin excludes them from both the FBX and the alembic. The script's own detach path (unfit+unparent+refit) and the app-global "Solve hair assets by hiding" setting are gone; hiding is the single mechanism. Refresh assets regenerates existing characters onto the simpler export block. Requires the Exporter Plugin build that does the hidden-node unparent — an older plugin would leak hair back into the FBX.
