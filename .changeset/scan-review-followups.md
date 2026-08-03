---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Two review follow-ups on the v0.61 features. The scene morph scan now skips
cameras and lights **anywhere** in the scene, not only at the root — one
parented into a figure or prop (a light rig, a camera mount) slipped past the
old guard and offered its focal length and intensity dials as morph
suggestions (runtime v56; Tools → Refresh assets or the next export picks it
up). And the first-Generate-project intro seeds its **$HIP paths** choice from
the old app-wide "Houdini path style" setting: anyone who had deliberately
switched it to absolute finds the intro pre-set that way instead of silently
flipped back to $HIP.
