---
# patch: layout/copy tidy in the Daz Studio plugins panel — no behavior change
# to scanning or installing.
'@dth/web': patch
---

**The Daz Studio plugins panel anchors each detection under its folder.**

Each found Exporter DLL is now listed directly **under the release-folder field it came from**, instead of in one block below the whole list — and the hint drops the folder path, which only echoed the field above it. When one folder holds a subfolder per generation, the subfolder still shows (`· Daz Studio 4`), since that's what tells the two builds apart. The standing *"Runner plugin — ships with this app (…)"* line is gone too: the **Runner plugin** table header says it on hover instead.
