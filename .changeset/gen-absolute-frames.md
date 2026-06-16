---
"@dth/web": patch
---

Show absolute timeline frame numbers for GEN art-direction frames (e.g. 431 for
ClitorisErect) instead of the relative offset (+103). The GP/DK block's absolute
start is derived from the base ROM + skinning via a new `genRomStartFrame`
helper.
