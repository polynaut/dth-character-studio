---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Generated Houdini projects set `$JOB` to the character folder, so picked paths stay relative

Houdini only collapses a chosen path to a variable when it sits under `$HIP` or
`$JOB`. `$JOB` was the shared `houdini/houdini-project` folder — *below* the
exports — so picking an export through its real location wrote an **absolute**
path and the project stopped being movable. The retired `dth-exports` junctions
had been hiding that by making exports look like they were below `$HIP`.

`$JOB` is now the character folder, which contains both `houdini/` and the Daz
export root, so the same pick yields `$JOB/daz3d/dth-exports/…`. Paths inside the
houdini folder still collapse to `$HIP`. New projects only — existing ones keep
the old value baked into the `.hip`.
