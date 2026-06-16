---
"@dth/web": patch
---

Moving a character (via the Filepath **Move**) now repoints its linked Daz scene
when the scene lives inside the character folder — the scene travels with the
folder, so its stored path is rewritten to the new location instead of going
"Missing". Scenes linked in place outside the character folder are left
untouched (they didn't move). The editor's Daz scene field updates in step
without discarding any unsaved edits.
