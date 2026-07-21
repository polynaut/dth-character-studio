---
"@dth/web": patch
---

**Refresh assets** now upscales existing low-resolution avatars. A character saved
before the xBRZ upscale-on-write feature keeps its 256px avatar until it's re-set;
Tools → Refresh assets now xBRZ-upscales every stored avatar still under 512² to
512² in place, so one click upgrades the whole library. Idempotent (avatars already
≥512² are untouched) and best-effort (a failed upscale never aborts the refresh).
