---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Houdini Utils → Defaults gains **Fill network**: the wiring Generate project
gives a new project, offered to the projects you already have. It fills the
DazToHue import file paths and export directory — and the PoseAsset CSV path
once your DazToHue version has one — with the same values, `$HIP`-relative per
the project's path style. Only **blank** parameters are written, so anything you
set by hand is listed as already-set and left alone, and a parameter your
installed DazToHue doesn't carry is **named** rather than silently skipped: the
row tells you why the CSV path isn't offered yet, and the same action starts
filling it the day a release adds it. Dry run and rolling backup as usual.
