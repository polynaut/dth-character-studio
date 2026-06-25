---
'@dth/web': minor
'@dth/desktop': minor
---

Tools: add a **DazToHue-Scripts** tab that downloads the companion
[soltude/DazToHue-Scripts](https://github.com/soltude/DazToHue-Scripts) repo — the
Daz Studio scripts behind DTH Character Studio — straight from GitHub and installs
it into `<My DAZ 3D Library>/Scripts/DazToHue-Scripts`. It delivers
`DthScanFrames.dsa`, which exports the full morph list of an open Daz scene as a CSV
you can pull into a character's ROM section via a section's **Import from CSV**.

The download + unpack run natively (the webview can't fetch the archive — codeload's
CORS only allows render.githubusercontent.com); GitHub's top-level wrapper folder is
stripped, the zip is unpacked beside the destination and swapped in (so a failed
download never leaves a half-written install), and re-installing replaces the folder
with the latest version. Reuses the reqwest/rustls (ring) stack already in the build
via the updater, so no new dependencies.
