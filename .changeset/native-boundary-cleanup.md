---
'@dth/web': patch
---

Follow-up cleanup (no user-facing change): route native app-menu actions through
a new `desktop.onMenu()` helper so the last raw `@tauri-apps/api/event` import
leaves the routes (`__root.tsx`, `index.tsx`) — the native boundary is now fully
concentrated in `lib/desktop.ts`. Also consolidate the reinvented path-normalize
lambdas into `normalizePath` / `normalizePathLower` in `lib/path.ts`.
