---
'@dth/web': minor
'@dth/rom': minor
'@dth/desktop': minor
---

Project & character notes — a markdown editor (Write/Preview) on a new Notes
tab of both the project page and the character page. Autosaves while you type,
and dropped images/media files are stored with the project (like avatar
images, under `.dcsmeta/media`) with the right markdown tag inserted at the
cursor — images render inline in the preview, other media opens with its
default app. Notes live as plain `notes.md` / `<Name>.notes.md` files next to
what they describe, so they back up (and read) like everything else.
