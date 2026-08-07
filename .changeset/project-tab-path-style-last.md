---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Settings → Project: **Houdini path style** moves to the bottom of the tab, and
the **DAZ Install Manager manifests folder** moves up under the **Enable Daz
Products** toggle it belongs to. The manifests folder is what that scan resolves
product names from, so the two now read as one setting instead of being split by
an unrelated dropdown — and the path style, the only setting on the tab that
changes what generation *writes*, sits last behind its own rule.
