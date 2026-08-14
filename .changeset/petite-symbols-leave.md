---
---

Pure code motion, no behaviour change: the two largest components and the
character schema's version log were split so that working on any one of them
stops loading all of it. `houdini-utils-panel.tsx` (3,421 lines) and
`dth-export.tsx` (3,029) became five focused modules, and the append-only
version History left `packages/rom/src/types.ts` for `.ai/schema-history.md`.
