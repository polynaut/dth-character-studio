---
"@dth/desktop": patch
---

**Fix "fs.copy_file not allowed" when copying a Daz scene into a character** — the whole-file scene copy moved onto the fs plugin's `copyFile` (audit PR #435) but the desktop capability that authorizes it was never added, so every copy/move of an external scene (and the one-time projects migration, which also copies) failed at runtime with a permissions error. Grants `fs:allow-copy-file` with the same `**` scope as the sibling fs write permissions in `capabilities/default.json`.
