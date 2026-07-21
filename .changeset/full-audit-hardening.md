---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

A full-codebase hardening pass — data-safety, correctness, accessibility and performance:

- **Your data can no longer be silently lost:** every file write is atomic (a crash mid-save can't corrupt a character), a character file saved by a newer app version is reported ("update the app") instead of being silently stripped on save, unreadable character files are surfaced on the project page instead of vanishing, the note-media cleanup skips deletion entirely when any folder can't be read, and the background Refresh sweep can no longer overwrite edits you saved while it ran.
- **Dedup you can trust:** "keep this copy" is honored even when duplicates share a name, every failed or partial quarantine move is reported per asset, and Windows case differences no longer cause endless re-installs or missed duplicate conflicts.
- **Editor integrity:** linking scenes/Houdini projects/avatars/products now validates and regenerates artifacts exactly like Save (no more silently stale scripts), and pose-morph rows keep stable identity while editing.
- **Keyboard access throughout:** the morph-name autocomplete is a full combobox, unlink buttons are reachable by Tab, and all dialogs/side panels use proper focus-trapped semantics.
- **Faster:** Refresh assets no longer re-scans the library once per character, asset installs walk each source once instead of twice, pose measurement runs in parallel, and heavy editor screens re-render far less while typing.
