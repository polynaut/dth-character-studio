---
'@dth/ui': patch
'@dth/web': patch
---

The Houdini card's rescan indicator is the orange bar itself, not a spinner

While hython re-reads a project, the card's Houdini-orange left accent bar now
lights up — a brighter glint sweeps down the stripe — instead of a small
spinner appearing over the thumbnail. Same meaning ("this project is being
re-read", cache hits never show it) and the same announcement to assistive
tech; reduced-motion setups get a steadily lit bar instead of the sweep. The
card stays fully usable throughout, exactly as before.
