---
'@dth/web': minor
'@dth/rom': minor
---

The Daz product scan now recognises **hand-installed content the old matchers could never see** (runtime v93), so far fewer used assets land in "unmatched". The gaps closed — each verified against a real library's scan diagnostics:

- **Morphs installed under the figure's own data root** — the standard `data/DAZ 3D/Genesis 8/Female/Morphs/<Vendor>/<Product>/` layout — were written off wholesale as base DAZ content. The scan now synthesises a content-folder product for each such folder, and because a morph often exposes **no source file at all** to the scan APIs, it also matches a morph to the morph *file* named like it — searching real products' DIM manifests, real products' installed Morphs folders, and the synthesised folders, preferring the scene's own Genesis generation when vendors ship the same filename for several.
- **Flat texture folders** (`Runtime/textures/<Product>/<file>.jpg`, common for freebie outfits) produced garbage folder keys — the filename was mistaken for the product segment. The folder alone is now the key, and an unmatched item's own texture folder becomes a product **on demand**, grouping sibling parts (Backpack, Boots, Gloves…) under the one folder product they share. Nested unowned texture folders (`Textures/<Vendor>/<Product>/`) work the same way, with the vendor as artist.
- **Every content directory Daz has mapped** is scanned, not just the one library configured in Settings — network drives and split libraries included. Local-install metadata and artist/version enrichment read all of them too.
- A new **Folder Match** places an asset whose own source file lives under a real product's `<Vendor>/<Product>` folder — catching morphs from big packs whose exact file fell off the DIM manifest's capped file index. The basename matcher keeps **every** morph filename from a manifest (Shape Shift lists 166 — the old cap dropped the one that mattered).
- **Morphs dialed on fitted items** (clothing, hair, geografts) are no longer matched independently — they're the item's own fit morphs or auto-follow projections, always part of the product that brought the item, and matching them produced false positives on generic names like `Expand_All`.
- A **Content Folder Match** now shows the folder it was identified from in the product's expanded row — and the concrete files that identified it (the `.dsf` a morph was matched by, the texture map that keyed an outfit), so you can see exactly which installed content brought it in.

Re-scan a scene (or just run the next export) to see previously unmatched assets resolve; Tools → Refresh assets regenerates the scan scripts on the new runtime.
