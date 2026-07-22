---
"@dth/rom": patch
"@dth/web": patch
---

The Hair export (`Export_Hair_<Name>_<Genesis>.dsa`) now exports **each hair item of the open scene on its own** instead of one combined alembic. Open a character's Daz scene, run the single script, and it walks that scene's hair list and exports each item — hiding every other wearable (including the other hair items) so only that one is captured — as `<Name>_Hair_<item>_grooms.abc`. Houdini gets one alembic per hair asset. `RUNTIME_VERSION` 32 → 33; **Refresh assets** regenerates existing characters.

(Unchanged and re-verified: per-scene overrides still collapse into the ONE ROM script that selects the open scene's data by filename — even with several overrides set up — while the PoseAsset CSV stays one per ROM-override Daz scene.)
