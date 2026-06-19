---
"@dth/web": patch
---

Remove the "Delete file on disk" option from the **Remove Houdini project**
dialog. Houdini projects are only ever linked in place (their absolute import
paths forbid copying), so that toggle pointed at the user's real `.hip` at its
original location — removing a project is now unlink-only. The Daz-scene remove
dialog keeps the toggle (scenes can be copied into the character folder).
