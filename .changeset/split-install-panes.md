---
"@dth/web": minor
"@dth/desktop": minor
---

Reorganized the DazToHue settings into two self-contained panes: **Setup DTH Release** (DTH release selection + My DAZ 3D Library + Houdini documents folder + install) and **Setup DTH Exporter Plugin Release** (Exporter Plugin selection + Daz Studio install folder + install). Each has its own dry-run, gating, and report, and the admin-sensitive plugin step fails with a clear "close all Daz and Houdini apps and restart as administrator" message. The DazToHue-Scripts folder moved to General settings.
