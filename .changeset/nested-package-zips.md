---
'@dth/desktop': minor
---

**Install/scan Daz assets** now looks inside wrapper downloads (a zip holding the real package zip). Some stores ship a product as an outer zip that holds only the license/instructions PDFs, a `.dsx` manifest and the actual DIM package zip (`IM…_Product.zip`) — since the outer archive itself has no `data`/`People`/`Runtime` folders, these downloads reported **"no Daz content"** and never installed. When an archive holds no content folders, the scan/install/dedup now descends into the zips inside it (two levels deep) and resolves the product's content there — so a wrapper download diffs, installs, and dedups exactly like a flat zip of the same content (including the "same files as …" duplicate hint against a flat copy). Content found in the archive itself still wins: a `.zip` that is *part* of a product's content is installed as a file, not descended into.
