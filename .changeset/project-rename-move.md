---
"@dth/web": minor
---

Projects can now be renamed and moved from the overview. Each project card gets
two hover actions: **Rename** (the light operation — just changes the name) and
**Move** (the heavy one — relocates the project to a different folder). A move
physically relocates all character data to the new folder and repoints every
character's in-folder references (Daz scenes / Houdini projects stored inside the
character folder) plus its stored project name/path; scenes linked in place
outside the project folder are left untouched.
