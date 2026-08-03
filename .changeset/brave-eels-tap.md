---
'@dth/web': patch
---

**DTH Export right after closing Daz Studio no longer strands the batch.** The wait dialog would appear, then vanish without Daz ever starting: the Daz that was still shutting down had claimed the batch on a final poll tick and exited before running anything, and the Runner only ever looks for an *unclaimed* job file — so it sat there forever, invisible. The studio now takes such a batch back and starts Daz with it, as the dialog always promised. Only a batch on which nothing has run yet is reclaimed; one that got partway through is still reported as a run that died, rather than re-exporting scenes that already finished.
