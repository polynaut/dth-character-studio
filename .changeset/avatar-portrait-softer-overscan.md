---
"@dth/web": patch
---

Character header: soften the portrait's rest-state over-scan zoom (1.55 → 1.4) so a
low-resolution avatar (e.g. a 256px Daz scene `.tip.png`) is magnified less and
reads sharper. The zoom now holds until the header starts collapsing and the pan
is nudged up (12% → 16%), so an opaque uploaded avatar still fully covers the 3:4
frame at the gentler zoom.
