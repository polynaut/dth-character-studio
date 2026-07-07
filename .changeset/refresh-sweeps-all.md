---
'@dth/web': patch
---

**Refresh assets now always covers every known project.** Running it from a
project window used to scope the sweep to that project only — the same button
meant different things in different windows. It now behaves identically
everywhere: every known (recent) project is detected and refreshed, plus the
current window's project even if it isn't in recents yet.
