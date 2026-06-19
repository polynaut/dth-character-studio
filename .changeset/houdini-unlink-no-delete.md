---
"@dth/web": patch
---

Make asset removal safer so a user can never delete an original file by mistake:

- **Houdini projects** are only ever linked in place, so the *Remove Houdini
  project* dialog no longer offers "Delete file on disk" — removal is unlink-only.
- **Daz scenes** linked in place (outside the character folder) are the user's
  originals, so the *Remove Daz scene* dialog now shows the "Delete file on disk"
  toggle locked off, with a "Linked in place — your original file is kept" note.
  Scenes copied *into* the character folder keep the toggle on, as before.
