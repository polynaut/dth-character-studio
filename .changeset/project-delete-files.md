---
"@dth/web": minor
---

Deleting a project can now remove its files from disk. The project delete
confirm has a **"Keep project files on disk"** toggle — **off by default**, so
deleting a project now also deletes its library folder (all character data) and
its generated-scripts subfolder. Turn the toggle on to remove only the project
entry and leave every file in place (the previous behaviour). (The shared delete
dialog was generalised; the character delete keeps its "Keep the Daz files
folder" toggle, also off by default.)
