---
'@dth/web': minor
'@dth/rom': minor
---

The Daz product scan now recognises **hand-installed morphs and content in every mapped library** (runtime v88), so far fewer used assets land in "unmatched". Three matching gaps closed:

- **Morphs installed under the figure's own data root** — the standard `data/DAZ 3D/Genesis 8/Female/Morphs/<Vendor>/<Product>/` layout — were written off wholesale as base DAZ content. The scan now reads the vendor/product pair after `Morphs/` and synthesises a content-folder product for it, so a manually-installed morph with no DIM manifest (e.g. a freebie body morph) matches its folder product instead of sitting unmatched.
- **Every content directory Daz has mapped** is scanned, not just the one library configured in Settings. The scan runs inside Daz, and Daz knows where content actually lives — network drives and split libraries included. Local-install metadata and artist/version enrichment read all of them too.
- A new **Folder Match** places an asset whose own source file lives under a real product's `<Vendor>/<Product>` folder — catching morphs from big packs whose exact file fell off the DIM manifest's capped file index.

Re-scan a scene (or just run the next export) to see previously unmatched assets resolve; Tools → Refresh assets regenerates the scan scripts on the new runtime.
