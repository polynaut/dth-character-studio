---
'@dth/web': patch
---

Failed-morph red rows are now scoped to the scene whose run reported them: selecting another Daz scene no longer shows the primary scene's failures as red rows in its grid. A failure is a per-scene fact — the dialed-walked gate reads the dial values of the scene the row ran in. An untagged run (unsaved scene, or a pre-v54 log) still marks every scene's grid, since it cannot be pinned on one. Clicking a failure in the run report now actually switches to the scene that reported it: the log's path spelling (Daz's forward slashes) is resolved to the linked scene's stored spelling first — the raw path silently fell back to the primary scene.
