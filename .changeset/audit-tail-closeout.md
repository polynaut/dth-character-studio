---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Audit tail closeout: edits typed while moving the scenes folder can no longer write a dead custom-asset path back to disk, one Refresh click now repairs a corrupted runtime install even when characters are also stale, the dedup conflict marker orders tied paths exactly like the installer (component-wise, not string-wise), "Clean up now" reports files it couldn't delete instead of claiming there was nothing to do, the missing-pinned-release warning updates right after any save, and two keyboard edge cases are fixed: an IME-cancel Escape no longer closes a surrounding dialog, and Shift+Tabbing out of a pinned info popup no longer dismisses it.
