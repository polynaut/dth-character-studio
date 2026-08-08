---
'@dth/web': minor
'@dth/rom': minor
---

Houdini paths are anchored on `$JOB` instead of `$HIP`

A generated project wrote its import, CSV and export paths as
`$HIP/../…`. They now read `$JOB/…` (the export folder itself moves in the same
release — see *The export folder moved into the Houdini folder* below).

`$JOB` **is** the character folder — Generate project bakes it in — so the whole
Daz side is one hop away, and it is what Houdini itself writes: pick an export by
hand and its file picker collapses the path to `$JOB/…`, so a hand-picked path
and a generated one finally match inside the same node. The old form was never a
preference; before v0.64 `$JOB` pointed *below* the exports and could not
express them at all.

It is also sturdier. `$HIP/../` encodes how deep the `.hip` sits, so a project
moved one folder down silently broke every path, and every project of a
character had to live in the same folder for one prefix to be right. Neither
limit remains — projects at different depths, or in different folders, now share
one prefix.

**Projects made before this keep their old paths and still work.** Their card
flags them (*“…still anchored on $HIP instead of $JOB”*) and **Utils → Make
paths portable** rewrites them. Only paths that *leave* the houdini folder
(`$HIP/../…`) count: a `$HIP` path that stays inside it is where Houdini itself
writes — render output, caches — and is meant to follow the scene file, so it is
neither flagged nor rewritten. **Fill network** now waits for a correct `$JOB`
the way the repath already did: the values it writes are `$JOB`-relative, so
filling a project whose `$JOB` still points elsewhere would store paths aimed at
the wrong folder. Repair `$JOB` first — the tab says so.
