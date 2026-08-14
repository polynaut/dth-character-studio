---
'@dth/web': patch
'@dth/rom': patch
---

Internal: the three largest source files are split into focused modules

No behaviour changes — this is pure code motion, verified line by line. The
Houdini utils drawer and the DTH Export panel each became a small set of
modules along the seams they already had (the drawer's reports and rows hold no
drawer state; the export button owns the run while the panel owns what is
shown), and the character schema's append-only version log moved out of
`packages/rom/src/types.ts` into `.ai/schema-history.md`, where a version-number
lookup belongs. Working on any one of these no longer means loading all of it.
