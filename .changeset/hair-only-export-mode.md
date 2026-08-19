---
'@dth/rom': minor
'@dth/web': minor
'@dth/desktop': minor
'@dth/ui': minor
---

DTH Export gains a "Hair items only" Daz mode: it exports each selected scene's hair items on their own (one Alembic per item) and nothing else — no ROM build, no skeleton/mesh export, no CSV. The scene list shows only the scenes whose "Export hair items" switch is on, all pre-checked; like ROM only, the run stops after Daz. Generation now emits a fourth hidden Runner carrier, `.Bulk_Hair_Export.dsa` (runtime v97) — the standalone Export_Hair pass run unattended — and the script sweep also retires the export-only carrier when the export dir is cleared (it used to linger).
