---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Guide: document the Utils drawer properly, and split Custom morphs onto its own page

The drawer shipped with 120 lines of prose and no images — including a
hand-typed ASCII stand-in for the material list. It now carries two generated
screenshots (the whole drawer, and the Materials list with its per-slot cost),
which the smoke fake can produce because it answers `run_houdini_material_util`
from seeded scan data.

Three prose corrections against what the code actually does now: scans are
served from an mtime cache, so "opening a `.hip` takes a few seconds per file"
only holds for the first read (and for a file a transfer just rewrote); a
parameter linked to another node arrives as its **value**, since a
`ch("…/DazToHueMaterial/…")` reference would silently rebind to the target
project's own node; and the Source row accepts a dropped `.hip` and lists the
project's Houdini templates.

`04-first-character.md` had grown to 581 lines. Custom morphs (pose rows,
combining morphs, bone scale, section/group tools, finding an internal Daz name)
moves to `custom-morphs.md` — 04 drops to 370 lines and keeps a pointer. The
in-app "Open guide" link beside **Parameter name** follows the section to its
new page, so it lands on the anchor instead of a page that no longer has it.
