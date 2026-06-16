---
"@dth/web": minor
---

Rework the DTH release settings. The folder now accepts exactly two shapes: a
single DTH release (detected by its `copyright.txt`), or a folder of versioned
release folders. A multi-release folder shows a **version dropdown**; the chosen
version is stored as `currentDthVersion` (`CURRENT_DTH_VERSION`) and, once set,
newer releases dropped in later don't switch it automatically — you pick and
save. When unset it pre-selects the latest extracted release and flags the form
so you save once to record it.

Saving now (re)builds the pose catalog for the active release — the separate
"Scan DTH release" button is gone. Zipped releases are listed in the dropdown so
you can see they exist, but they can't be used directly (Daz can't load poses
from inside an archive); selecting one shows an "extract the release zip first"
warning. The "point directly at a Poses folder" option was dropped — we always
work with a full DTH release.
