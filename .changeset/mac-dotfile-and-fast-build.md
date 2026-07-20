---
"@dth/desktop": patch
---

Actually fix "forbidden path" on macOS/Linux project creation. The Tauri fs plugin defaults `requireLiteralLeadingDot` to true on Unix, so the `**` scope glob refuses to match hidden dot-folders like `.dcsmeta` — creating a project's `.dcsmeta/images` failed. Set `plugins.fs.requireLiteralLeadingDot: false` in tauri.conf.json (Windows was never affected — it defaults to false there). This supersedes the 0.44.5 `/**` scope attempt, which addressed the wrong cause.

macOS release builds are now Apple Silicon (arm64) only, which roughly halves the mac build time (Intel Macs are no longer supported). The release also caches Cargo's downloaded crate sources (checksum-verified, never compiled artifacts) so the signed build stays a cold, reproducible compile.
