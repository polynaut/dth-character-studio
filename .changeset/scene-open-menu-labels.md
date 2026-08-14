---
'@dth/web': patch
---

The scene card's open menu slims down: "Open last ROM" / "Generate new ROM"

The stale hint under the second entry ("From an earlier run — the scene or the
definition changed since") set the whole menu's width; it now lives in the
row's tooltip instead. The two ROM entries are renamed — "Open ROM Animation"
→ **Open last ROM**, "Open and Generate ROM Animation" → **Generate new ROM**
— so the menu is as wide as its labels. What each entry does, and when the
rebuild is offered, is unchanged.
