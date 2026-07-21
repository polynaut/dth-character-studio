---
"@dth/web": patch
---

Character editor header + settings polish:

- The avatar corner badge always uses the scene-thumbnail "zoom in + lift up" framing, so uploaded and legacy-named avatars read as thumbnails instead of rendering flat.
- The header avatar drifts a touch less as you scroll (pan `-12%` → `-9%`).
- The "Daz scripts generated" path chip matches the Export directory chip's height.
- New `outline-destructive` button style (a light-red-bordered destructive button): the export directory's Clear (now an icon-only X) and the folder-move dialogs' Cancel use it, so they read as real bordered buttons that match their neighbours instead of a filled block or a bare link.
