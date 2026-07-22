---
"@dth/web": patch
---

ROM editor on a non-primary (outfit) scene: the per-frame **Override** column now
stays visible but disabled while that scene's ROM override is off — instead of
disappearing — so it's clear the control is there and just needs arming. The eight
section titles are also muted on any override scene: the section structure
(enable / mode / groups) is locked whether the override is armed or not, so the
titles now read as disabled to match their already-locked toggles.
