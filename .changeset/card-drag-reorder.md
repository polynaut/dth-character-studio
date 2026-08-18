---
'@dth/web': minor
---

The Daz scene cards and the Houdini project cards can now be re-ordered by drag-and-drop: a grip appears in a card's top-left corner on hover, and dropping it persists the new order with the character (the cards render in array order, so the order survives reloads and is what every list derived from it shows). For Daz scenes the primary card keeps its place — it stays first and isn't draggable; the extra scenes re-order among themselves. A Houdini entry whose file is missing on disk still holds — and can still be moved to — its place in the order.
