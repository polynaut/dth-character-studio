---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Internal: the 36 event handlers that handed a promise to a prop typed
`() => void` now say `void` out loud. Every sink was checked first — React's
`onClick`, `BulkDeleteDialog.onConfirm`, `useFileDrop.onDrop`, the Tools section
props, `setTimeout` — and none of them awaits, so each edit is runtime-identical
and the discard is now visible instead of implied. No behaviour change.
