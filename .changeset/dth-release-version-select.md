---
"@dth/web": minor
---

Rework the DTH release settings. The folder now accepts exactly two shapes: a
single DTH release (detected by its `copyright.txt`), or a folder of versioned
releases — release folders and/or `.zip` archives. A multi-release folder shows
a **version dropdown**; the chosen version is stored as `currentDthVersion`
(`CURRENT_DTH_VERSION`) and, once set, newer releases dropped in later don't
switch it automatically — you pick and save. When the version is unset it
pre-selects the latest and flags the form so you save once to record it.

Saving now (re)builds the pose catalog for the active release — the separate
"Scan DTH release" button is gone. Zip releases are scanned in place by reading
the archive's entry list (no extraction); since their poses aren't on disk,
generated scripts fall back to the DthOptions runtime resolution for a
zip-sourced catalog. The "point at a Poses folder directly" option was dropped —
we always work with a full DTH release.
