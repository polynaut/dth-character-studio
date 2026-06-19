---
"@dth/web": patch
---

Cloning a character now actually lands you on the new copy. The clone already
navigated to the copy's URL, but the editor reused the same component instance
(only the route param changed), so its draft state kept showing the original.
The editor is now keyed by the character id, so it remounts on an editor→editor
navigation and re-seeds from the copy.
