---
"@dth/web": patch
---

Per-scene override toggles now show the selected scene as the same green pill —
mini scene render + name — the header tag uses, instead of a plain "for <scene>"
text label. The pill is factored into a shared `SceneLabel` used by both the header
and every override toggle (ROM, Genesis-9 identity, hair, preserve lists), so the
selected scene reads identically everywhere.
