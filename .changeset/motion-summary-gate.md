---
'@dth/rom': patch
'@dth/web': patch
---

A DTH export that sampled no motion is no longer reported as success
(runtime v102). The DTH Exporter (2.1.9+) can intermittently walk every ROM
frame while the scene never re-evaluates — its own motion summary then reads
"moved on 0 of N frames" — producing a statue alembic that used to land as a
successful export and even purge the backups of the last good set. The
export carrier now reads that summary: an all-zero verdict is a failed
export (the previous set is restored, the report says why), and a run whose
liveliest node moved on under 90% of frames lands with a run-log warning
telling you not to trust the set. Exports from older exporter builds
(no summary) are unaffected.
