---
'@dth/rom': minor
'@dth/web': minor
---

New Export-directory toggle **"Export hair assets too"**: right after the main DTH export, each of the open scene's hair items is exported on its own (the Export_Hair per-item alembic pass) — in both modes, the combined ROM script and the split Export script. Scenes without a hair list skip the pass; the standalone Export_Hair script keeps being generated regardless.
