---
'@dth/rom': patch
---

Runtime v57: the version bump the junction removal should have shipped with —
generated scripts now read as stale, so **Tools → Refresh assets pulses** and
one refresh regenerates every character with the new relative reference paths
while sweeping leftover junctions. (On v0.63.0 the same migration is one
manual click: Refresh assets with nothing stale runs the forced full refresh.)
