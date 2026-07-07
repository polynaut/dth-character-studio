---
'@dth/web': patch
---

**Fix: a JCM base ROM without FAC no longer aborts the run.** The Daz runtime's
base-ROM loader only reported success when the FAC/mouth ROM also loaded — so a
character with JCM enabled but FAC disabled (e.g. a custom JCM base asset) loaded
its base ROM, then silently aborted the rest of the workflow (custom frames never
applied) and marked the run failed. The base ROM alone now counts as success; FAC
stays optional. (Pre-existing bug surfaced by the runtime-v16 validation.)
