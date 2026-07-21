---
'@dth/web': patch
---

Custom avatar images are now always square. When you upload an image (drop or pick), it's checked for size — at least 256×256 and at most 2048×2048, any aspect ratio — and then opened in a small crop editor where you drag to reposition and scroll or use the slider to zoom. Only the cropped 1:1 result is stored (at most 512×512), so every avatar preview looks consistent and the project metadata stays small. Images that are too small or too large are rejected with a clear message instead of being stored at odd sizes. Your recent uploads are now kept and shown in the image dialog, so switching to a Daz scene avatar (or a different upload) no longer discards the last one — click any recent image to switch back.
