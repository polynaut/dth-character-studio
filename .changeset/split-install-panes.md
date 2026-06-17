---
"@dth/web": minor
"@dth/desktop": minor
---

Split the DTH install into two independent panes: "Install DTH Release" (copies the release into "My DAZ 3D Library" + optionally the Houdini documents folder — My DAZ 3D Library moved here as the required field) and "Install DTH Exporter Plugin" (copies the plugin DLLs into the Daz Studio install folder). Each has its own dry-run, gating, and report, and the admin-sensitive plugin step now fails with a clear "close all apps and restart as administrator" message.
