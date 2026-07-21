---
'@dth/web': patch
---

Custom avatar images are now always square. When you upload an image (drop or pick), it's checked for size — at least 256×256 and at most 1024×1024, any aspect ratio — and then opened in a small crop editor where you drag to reposition and scroll or use the slider to zoom. Only the cropped 1:1 result is stored (256×256, or 512×512 when the cropped region is large enough), so every avatar preview looks consistent. Images that are too small or too large are rejected with a clear message instead of being stored at odd sizes.
