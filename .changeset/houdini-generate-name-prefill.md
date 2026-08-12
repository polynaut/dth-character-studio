---
'@dth/web': patch
---

**Generate Houdini project prefills the character's name, not the project's.**

The name field opened on `<Project>_<Character>` — `3d-workflow_LaraCroft_G81`.
A generated scene already lives inside its project, under
`<project>/…/<character>/houdini/`, so repeating the project in the filename
only made every scene longer without telling you anything the path doesn't.
What tells one `.hiplc` from another in the folder it sits in is the character,
and after that whatever you type.

Existing projects keep their names — this is the suggestion the dialog opens
with, nothing is renamed.
