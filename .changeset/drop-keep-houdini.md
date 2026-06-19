---
"@dth/web": patch
---

Remove the "Keep Houdini files" option from the character delete dialog. Houdini
projects are only ever linked in place (never copied into the character folder),
so there was no Houdini subfolder to preserve — the toggle was misleading. The
delete dialog now offers just "Keep the Daz files folder".
