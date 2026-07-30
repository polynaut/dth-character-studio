---
'@dth/web': patch
---

fix(web): the header avatar follows a replaced primary scene again. A scene-snapshot avatar whose source scene left the linked list (a replaced primary whose tip copy failed at relink time, a renamed extra) made the focus-driven avatar sync bail forever — the scene card showed the new look while the header kept the old one. The sync now adopts the primary and re-derives (the same self-heal as lost provenance; uploads stay untouched), and a scene rename repoints the avatar's provenance for extra scenes too, not just the primary.
