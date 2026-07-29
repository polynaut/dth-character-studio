---
'@dth/desktop': patch
---

fix(release): the Runner-DLL fetch step broke the release build — `beforeBuildCommand` runs from `apps/desktop`, where the root `fetch:runner` script isn't visible (`pnpm -w` now), and the fetch script's skip path crashed Node on Windows via `process.exit()` with undici handles still open. No user-facing change; this re-cuts the release that v0.51.0 failed to build.
