---
---

Docs/CI-only: the guide's interaction clips are animated **WebP** now instead of GIF. sharp encodes the recorded frames to a lossless animated WebP (per-frame delays preserved) — crisp UI text with no 256-colour banding, and ~6× smaller (path-chip-copy: 61 KB → 10 KB). Renamed the tooling gifs → clips (`webp-recorder.ts`, `guide.clips.ts`, `playwright.clips.config.ts`, `pnpm clips`, `docs/guide/clips/`); dropped `gifenc`. No product changes.
