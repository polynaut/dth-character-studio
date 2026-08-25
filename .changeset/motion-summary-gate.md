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
liveliest node barely moved lands with a run-log warning telling you not to
trust the set. Only a summary written by the export that just ran can judge
it, and every export now says in Daz's log what the audit concluded — so an
un-audited export (older exporter, no summary) reads as un-audited rather
than as clean. Exports from older exporter builds are otherwise unaffected.
