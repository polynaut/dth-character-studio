---
'@dth/web': patch
'@dth/rom': patch
---

Kill_Animation now restores each property's raw frame-0 value, so a keyed morph that a character's master dial also drives (ERC) no longer gets the controller's share applied twice after the animation is stripped.
