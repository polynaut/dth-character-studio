---
'@dth/web': patch
'@dth/rom': patch
---

Fix two per-scene override editor bugs:

- **Preserve lists no longer silently drop an edit.** Editing a preserve morph / node-transform row on an outfit scene so the list ends up with a duplicate entry (e.g. renaming one node to match another) used to read as "same as the primary" — the override disarmed, the typed row snapped back, and the scene generated with the base list. The "differs from the primary" test now compares as a multiset (order still doesn't matter), so a real divergence always arms the override and keeps its reset handle.
- **Relinking the primary Daz scene onto an already-linked outfit scene no longer duplicates it.** The scene is now dropped from the extras when it becomes the primary, so it can't appear as both a primary and an extra card (which also broke the scene footer's selection animation).

Also: the docked scene footer's rail buttons leave the tab order while it's hidden (they were focusable off-screen), and the hair panel's per-scene "overridden" mark uses the same multiset comparison.
