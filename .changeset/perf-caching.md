---
"@dth/web": patch
---

Performance: morph index / character lookup / product scans are cached with cheap staleness checks (no more full re-reads per navigation or window focus); the cross-project prefill list loads lazily instead of stalling the project page on cold network shares; morph autocomplete is indexed and deferred; large product reports skip offscreen rendering; the update dialog's markdown renderer no longer ships in the startup chunk; removed the unused TanStack Query dependency.
