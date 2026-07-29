---
'@dth/web': minor
'@dth/desktop': minor
---

feat(web,desktop): project **Operations** tab with a danger zone. Its one action, **Delete**, permanently removes the whole project after a confirm: the project folder (characters, scenes, generated files, notes), the project's generated Daz-script folder in the Daz library, its app-data product scans, and its Recents entry. A file open in Daz Studio / Houdini aborts the delete before anything is touched. Afterwards the window continues as a Home window (new `release_project_window` command unpins it).
