---
'@dth/web': patch
'@dth/desktop': patch
'@dth/rom': patch
---

Fix: a DazToHue export that fails inside Houdini is no longer reported as a success. Houdini runs an HDA's button callback through a wrapper that catches the script's exception, prints it, and returns normally — so the studio saw a clean return and counted the node as exported. A run whose project could not load its PoseAsset CSV therefore finished in 17 seconds, wrote nothing, and toasted "2 exported". Failures are now read from what Houdini actually printed: 456.py marks the individual node failed, and the studio additionally checks the run's console log, which is the only channel carrying errors Houdini raises before or outside the in-process capture (a project that fails while *loading* now says so instead of finishing quietly).
