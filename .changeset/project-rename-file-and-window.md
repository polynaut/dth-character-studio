---
'@dth/web': patch
'@dth/desktop': patch
---

Renaming a project now renames its `.dcsp` file to match (it previously kept the old filename), and any open window for that project is live-re-titled to the new name — so the native title bar, the `.dcsp` filename, and the in-app name all stay in sync without closing and reopening the window.
