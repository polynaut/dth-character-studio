---
"@dth/web": patch
"@dth/desktop": patch
"@dth/rom": patch
"@dth/ui": patch
---

Refresh assets can now reset character files saved by a newer build. If a definition was written by a newer version of the app (its schema is ahead of yours), this build refuses to open it. Refresh assets now lists those files separately and offers a one-click "Reset to v<current>" that re-saves them at this build's schema — dropping any fields the newer version added. The read-error notice on the project page links straight to it.
