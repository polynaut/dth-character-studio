---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Houdini Utils gains a **Defaults** tab: per-project Houdini settings shown with
their current value beside what the studio expects. `$JOB` is saved inside each
`.hip`, so v0.64's fix reached only newly generated projects — every project
that already existed still points it at `houdini/houdini-project`, which sits
below the exports, so picking an export by hand keeps writing an absolute path.
**Repair $JOB** is that migration: it repoints only the projects that differ, at
the character folder, with a dry run and the same rolling
`backup/<name>_dthbak.hiplc` the transfer takes. It fixes paths you pick from
now on — references already stored absolute are untouched. `$HIP` is reported
rather than rewritten, since that would mean moving your scene file.
