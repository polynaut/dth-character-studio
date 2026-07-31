---
'@dth/web': minor
---

feat: every new character gets a final **export** folder

Alongside its Daz (`daz3d`) and Houdini (`houdini`) folders, a new character now also gets an **`export`** folder — where the files Houdini generates for Unreal land. That's the end of the pipeline, and it's yours to organise; the studio only creates it.

Not to be confused with `dth-exports`, which lives *inside* the Daz folder and holds the Daz→Houdini intermediate the DTH Exporter writes.

The name is a per-project setting like the other two — **Settings → Project → Final export subfolder** — so a project can call it something else, or nest it (`unreal/incoming`). Existing characters get theirs on the next generation, so nobody has to create it by hand.
