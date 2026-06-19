---
"@dth/web": patch
---

**Refresh Assets** now also re-installs the bundled DTH runtime files (once, up
front) — so after a studio update that ships a newer runtime, one Refresh Assets
push it to the Daz library even when there are no characters to regenerate. The
result panel reports the runtime refresh (and any failure).
