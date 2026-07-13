---
'@dth/web': patch
---

Self-host the Manrope font instead of loading it from Google Fonts. The packaged
app's CSP (`style-src 'self'`) blocked the external `@import`, so installed builds
silently fell back to a system font — and it added a network dependency to an
offline-capable desktop tool. Manrope is now bundled via `@fontsource-variable/manrope`,
so it renders correctly, works offline, and passes the CSP with no policy changes.
