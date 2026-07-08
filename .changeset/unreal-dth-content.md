---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
---

Unreal project cards grew up: bigger cards (name + folder) in the footer bar,
each with a tiny install button that bootstraps the Unreal project with DTH —
one click copies the linked DTH release's Unreal Engine content into the
project's `Content/DazToHue`, making a fresh Unreal project DTH-ready in an
instant. The button dims once the content exists; Ctrl+click always installs
(overwrite from the currently selected release — files are copied over, never
deleted first). Unreal linking + content syncing is now in the getting-started
guide.
