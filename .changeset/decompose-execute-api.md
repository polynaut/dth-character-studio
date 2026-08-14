---
'@dth/web': patch
---

Internal: the DTH Export API is four layered modules instead of one 2,400-line file

No behaviour changes. `api/execute.ts` is now the front door — every symbol it
exported before is still exported from it — and the implementation lives in
`api/execute/`, in layers that only import downward: `primitives` (the
character, the handoff stamps, the Daz probes and launch), `run-state` (the run
sidecar, progress log, interrupt/abort), `jobs` (the handoff itself) and
`scans` (the project and scene scans riding it).

One deliberate change came with the split: the shared "which run does this
window own" slot was a module-level `let`, which cannot be assigned across a
module boundary, so it is now a holder object (`runOwner.current`). Same single
slot, same semantics.
