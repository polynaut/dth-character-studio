---
"@dth/web": minor
---

Support multiple game projects, each with its own character library. The first-run prompt now asks for your **"My DAZ 3D Library"** path; the home screen is a **projects** list (each project is a name + folder, persisted in the app folder), and opening a project shows its characters scoped to that folder, with the project name and path shown. Characters from the previous single-library version are carried over to a backup and can be **restored** into a project. Character storage is re-scoped per project; routes are nested under `/projects/$projectId`.
