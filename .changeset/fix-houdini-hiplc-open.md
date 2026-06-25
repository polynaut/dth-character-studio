---
'@dth/desktop': patch
---

Fix: opening a linked Houdini project failed for `.hiplc` / `.hipnc` files with
"Scoped command argument … failed regex validation". The shell `open` scope only
matched `.hip` (anchored at the end), so the indie/non-commercial Houdini
extensions were rejected. It now accepts `.hip`, `.hipnc`, and `.hiplc` (alongside
`.duf` and http/https links).
