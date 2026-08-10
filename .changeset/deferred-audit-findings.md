---
'@dth/web': patch
---

The audit's deferred findings (#755), fixed:

- **Orphaned Daz-library script folders are swept.** A character deleted or renamed outside the app stranded `Scripts/DTH-Character-Studio/<project>/<character>/` forever (a mid-rename generation failure leaked the old-name folder the same way). Housekeeping now removes them — under strict gates: only folders of characters provably gone from a fully readable library, only inside projects the app knows, never the shared runtime, never unknown project folders.
- **A byte-copied project no longer shares its product-scan store with the original.** First open of the copy's new path mints it a fresh project id, so the two stores separate; the original keeps its data, and a *moved* project keeps its id.
- **Two windows can no longer drop each other's recents entries.** The registry write goes through a native compare-and-swap under one process-wide lock — a conflicting write retries instead of clobbering.
- **Two spellings of a missing `.dcsp` path** (`\` vs `/`, trailing separator) now open ONE window instead of two.
