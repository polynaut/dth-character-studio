---
"@dth/web": minor
"@dth/rom": minor
---

Character JSONs now carry their owning project's **name and library path**
(`projectName` / `projectPath`), stamped on every save. Being a shape change,
this bumps `CHARACTER_SCHEMA_VERSION` to **2** — characters last written before
this (read as version 1) gain the fields on their next save.
