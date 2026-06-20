---
'@dth/web': patch
---

PoseAsset CSV export now **copies** the CSV into the resolved export dir instead of moving it. A move consumed the source after the first scene, so exporting a second Daz scene from the same character (e.g. `KiraDefault` then `KiraSummertide`) left that scene without a CSV. With a copy, every scene's subfolder gets its own CSV and the character folder keeps the canonical one.
