---
'@dth/rom': patch
'@dth/web': patch
'@dth/desktop': patch
---

Fixes from a full codebase audit — mostly data-loss and correctness bugs in the character editor and project handling:

- **Moving a character folder** now keeps every linked path intact. Previously only the primary Daz scene followed the move — extra outfit scenes, grooms, ROM scene-overrides and the avatar-source scene were orphaned, and the next save wrote those dead paths permanently.
- **Moving the Daz scenes folder** no longer silently discards unsaved ROM edits (and no longer slips past the "unsaved changes" prompt).
- **Edits typed while a save is in progress** are preserved instead of being reverted when the save finishes.
- **Inline rename** now runs the same validation as Save, so it can't persist or regenerate an invalid character.
- **Case-only renames** (e.g. `kira` → `Kira`) no longer fork the folder to `Kira (2)` or delete the freshly generated scripts.
- **Importing a morph CSV** into an empty FBM/MISC section no longer drops that section's scene-override frames.
- A **corrupt project file** (`.dcsp`) now surfaces an error instead of silently resetting the project's settings on the next save.
- **Dedup** never destroys a downloaded asset: when quarantining across drives, a copy that succeeds is kept even if clearing the original partly fails.
- Projects **opened by double-clicking a `.dcsp`** now appear in Recents.
- Note attachments: only safe media/document types open from the app (a `.dsa` attachment can no longer run in Daz).
- Assorted UI fixes: the Tools "Refresh assets" menu item switches tabs reliably, the Settings release/exporter spinner no longer sticks, bulk-delete refreshes the list on a partial failure, discarding edits asks first, and duplicate scene/Houdini/Unreal links are de-duplicated case-insensitively.
- Performance: measured `.duf` frame counts and avatars are cached, and the character-library scan skips the app's own large media folders — noticeably faster on projects with many characters or on a network share.
