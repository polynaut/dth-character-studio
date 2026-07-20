---
'@dth/web': patch
---

Notes editor: serialize autosaves so a debounced save and an immediate blur save can no longer run at once. Previously the two could fire concurrently with the same stale expected-mtime, making the second spuriously report "Notes changed on disk" (whose Reload discarded the newest keystrokes). Saves now single-flight — the latest value is queued and flushed once the in-flight save finishes with the updated mtime — and a no-op save (nothing changed) is skipped so it can't churn the file against another open window.
