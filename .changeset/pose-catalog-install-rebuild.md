---
'@dth/web': patch
---

Pose catalog is now scanned live into memory instead of cached on disk — fixing the "No pose catalog yet" errors and removing the whole class of stale/missing-cache problems.

Previously the pose list was built into a `pose-catalog.json` file only when you pressed **Save** in Settings; installing a release saved the settings (which disabled Save), so a freshly-configured release could be left with no catalog and no way to build one. Now there is no on-disk catalog at all:

- The active release's `Poses` folder is walked by a native Rust command (one call, ~4–5× faster than the old per-directory JS walk on a network share) and classified in memory.
- It's scanned on app startup (after network drives are mapped), on first use, and re-scanned automatically whenever the release selection changes (Save or Install) — no manual "rebuild" step.
- A missing/unreachable release shows a clear error that links to Settings; nothing can silently go stale.
