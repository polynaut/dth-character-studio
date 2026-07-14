---
'@dth/web': patch
---

Fix "Open in Daz" not loading the scene when Daz already has one open. The bridge
called `openFile(path)` without the `merge` argument, which merges the character
into the current scene instead of replacing it — so opening a new card looked like
nothing happened (into an empty Daz there was nothing to merge with, so it seemed
fine). It now calls `openFile(path, false)`, which clears the scene and opens the
file fresh.
