---
"@dth/web": patch
"@dth/desktop": patch
---

Notes integrity: autosave failures surface as a toast, and concurrent edits from a second window are detected instead of silently overwritten (reload option offered). Note media is garbage-collected — unreferenced files are removed after an hour on save, with a 7-day housekeeping backstop — and `.duf` preset decompression is bounded.
