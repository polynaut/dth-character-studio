---
'@dth/web': minor
'@dth/rom': minor
---

feat(web,rom): one **`Build_Genesis_Index.dsa`** replaces the four `Scan_Morphs_<Genesis>` scripts. Nothing to load or select first — it builds the stock figures itself, one generation at a time (Genesis 3/8/8.1 female **and** male, and Genesis 9 twice: it's gender-neutral, so that pair is differentiated by geograft instead — Golden Palace on one, Dicktator on the other), scans every figure root in the scene along with everything fitted to it, and writes all four `morphs_<G>.json` indexes in a single run. Each generation's female + male morphs now land in one index instead of whichever figure you happened to scan.

The geografts load via their **Smart** preset, so the geoshells come along and get indexed with the graft. Because those products reship under new names and folders, they're found by globbing the library for the product name and **ranking** the hits — generation first (the same glob also finds the Genesis 8 versions, which must never be fitted to a G9 figure), then how complete a setup the file is; shells, UV fixes and material/pose presets are rejected outright, and the file it settled on is named in the run summary. Nothing plausible means "not installed", never the wrong graft.

Everything resolves **before** the scene is touched, so the confirm dialog lists exactly what will be built and what will be skipped: a generation you don't have installed is skipped (its existing index left alone), a missing geograft is skipped, and if no Genesis figure is installed at all it says so and leaves the open scene untouched instead of clearing it for nothing. With neither G9 geograft installed the Genesis 9 pair collapses to one plain figure; with one installed the redundant plain figure is dropped.

With figures already in the open scene it offers to scan **those** instead — that's how third-party geografts, add-ons and fitted clothing get indexed. Runtime v38: Refresh assets reinstalls the runtime and removes the retired wrappers.
