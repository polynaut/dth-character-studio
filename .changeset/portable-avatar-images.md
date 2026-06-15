---
"@dth/web": patch
---

Store character avatars as a portable reference (a filename or an external URL) instead of a machine-specific asset URL, and resolve the loadable image at render time. Shared character JSON no longer embeds local paths, and a missing local avatar falls back to the initial-letter placeholder instead of a broken image. Legacy avatar values (old asset/Electron-route URLs) migrate to the new form on load.
