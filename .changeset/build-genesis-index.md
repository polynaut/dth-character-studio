---
'@dth/web': minor
'@dth/rom': minor
---

feat(web,rom): one **`Build_Genesis_Index.dsa`** replaces the four `Scan_Morphs_<Genesis>` scripts. Nothing to load or select first — it builds the stock figures itself, one generation at a time (Genesis 3/8/8.1 female **and** male, and Genesis 9 twice: it's gender-neutral, so that pair is differentiated by geograft instead — Golden Palace on one, Dicktator on the other), scans every figure root in the scene along with everything fitted to it, and writes all four `morphs_<G>.json` indexes in a single run. Each generation's female + male morphs now land in one index instead of whichever figure you happened to scan. Assets are resolved through Daz's content manager with a bounded fallback search, so a differently-named install still works and anything missing is reported instead of failing silently. With figures already in the open scene it offers to scan **those** instead — that's how third-party geografts, add-ons and fitted clothing get indexed. Runtime v38: Refresh assets reinstalls the runtime and removes the retired wrappers.
