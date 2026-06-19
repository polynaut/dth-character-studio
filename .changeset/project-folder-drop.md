---
"@dth/web": minor
---

The "Create project" pane now accepts a **dragged-in folder** — drop a folder
onto the pane to set it as the project's location (the name is suggested from the
folder, editable), the same way the choose-folder button works. Dropping a file
uses its containing folder. `FileDropZone` gained an `acceptFolders` mode, since
folders can't be matched by file extension.
