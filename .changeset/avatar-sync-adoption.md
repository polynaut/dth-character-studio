---
'@dth/web': patch
---

The header avatar re-syncs again after the primary scene is re-saved in Daz: a separator/case difference between the stored avatar provenance and the scene list no longer kills the sync silently, and a scene-snapshot avatar without provenance now adopts the primary scene when no linked scene's current tip byte-matches (its source tip was simply overwritten before provenance existed).
