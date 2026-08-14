---
'@dth/web': minor
'@dth/desktop': minor
---

Utils drawer: an Export check tab that reads a material setup against the export it imports

Every DTH Export already writes a `Materials` list into the `.dth` the HDA
imports — one entry per Daz surface, carrying the asset that owns it, the Daz
content type and every channel with its texture path. The studio never read it.
It does now, and the new tab answers two questions no other part of the pipeline
can:

**Does this setup still match the scene?** A DazToHue material slot claims Daz
surfaces by plain text (`@fbx_material_name=Body`), and so does every texture
baker LAYER. Change the scene — swap a graft out, drop an outfit — and those
claims keep pointing at surfaces that no longer exist. Measured on DazToHue 2.5,
a baker layer in that state finishes normally and bakes nothing; Houdini reports
neither half. The tab lists both: claims the export does not back, and baker
layer groups the export does not back.

**What would a setup built from this export look like?** The Daz content type
(`Actor/Character`, `Follower/Wardrobe`) is vendor-authored, so the grouping
needs no heuristic — the proposal shows the slots it implies, the surfaces each
would claim, and the bakers the textures imply, named the way real projects
already name them (`T_Skin_Colour`). Wardrobe groups either into one clothing
slot or one per garment; both shapes exist in real setups, so it is a toggle.

Read-only in this release. It runs no hython, opens no `.hip` and writes
nothing — the two inputs are the stored scan and a JSON file the studio's own
pipeline wrote. Generating a proposed setup into a node is a separate step and
is not part of this change.

Two honest limits, both surfaced in the tab rather than buried. Unclaimed
surfaces are shown grouped by content type and never flagged, because whether
they are a defect depends on intent — a "naked" variant node is supposed to
leave its wardrobe unclaimed. And a proposal derived from textures is partial by
construction: a baker built from a constant rather than a map cannot be read out
of an export.

The scan now records the geometry groups each baker layer names (`bakerGroups`);
it already read them and threw them away. `SCAN_ANSWER_VERSION` is bumped so
existing entries re-earn their verdict instead of answering the new question
with an empty list.
