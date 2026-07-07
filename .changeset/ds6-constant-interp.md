---
'@dth/rom': minor
---

**Daz Studio 6: ROM keyframes no longer drift.** DS6's animation engine drifts
LINEAR-interpolated ROM keys across the timeline (poses creeping over frames —
mrpdean's June 2026 warning, e.g. the G9 DQS JCM FAC cheek poses). The runtime
now detects Daz Studio 6 and stamps every ROM morph key **Constant** instead of
Linear (his validated workaround), leaving Daz Studio 4 on the proven Linear
behavior. The final interpolation pass also covers the FAC mouth node, whose
keys a root-only pass never touched. Runtime bumped to **v17** — Tools →
Refresh assets regenerates existing characters' scripts.
