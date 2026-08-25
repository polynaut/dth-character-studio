---
'@dth/web': patch
---

A scene card's open menu now always offers **Generate new ROM**. It used to
disappear whenever the saved ROM animation looked *current* — newer than both
the scene file and the character's generated ROM script — with **Ctrl** as an
undiscoverable way to force it back. That test assumes a file's mtime is an edit
time, which stops being true in a Perforce or otherwise synced project: a sync
that writes `rom-animations/` after the scenes marks every animation "current",
and the rebuild quietly vanishes from every scene with nothing on screen to
explain it. The menu's two ROM rows now say what they mean — **Open last ROM**
whenever the file is on disk, **Generate new ROM** always — and an animation
older than the current definition keeps its "saved by an earlier run" tooltip,
informing the choice instead of removing it.
