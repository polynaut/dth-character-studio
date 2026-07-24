---
'@dth/web': patch
'@dth/rom': patch
---

feat(web): autocomplete the JCM bone field from the scanned scene

The bone field in "Modify JCM frames" now suggests the figure's bones as you
type — matching either the Daz UI label ("Left Thigh Bend") or the internal name
("lThighBend"), and inserting the label. Free typing still works for a bone that
wasn't scanned.

The bones come from the existing `Scan_Morphs_<Genesis>` run: the scanner
(`DthScanMorphs`) now also collects every bone into a `bones` array in the same
per-generation index (`morphs_<G>.json`, index version 2), read alongside the
morph index. Re-run Scan_Morphs in Daz (or Tools → Refresh assets, then scan) to
populate the bone list. RUNTIME_VERSION 33 → 34 so the updated scanner reinstalls
— no generated script changes.
