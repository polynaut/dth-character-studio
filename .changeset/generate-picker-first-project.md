---
# bump: patch is deliberate — one question restored to an existing dialog, no
# new capability and no change to what a generated project contains (the
# mirror of #782, which removed it as a patch).
'@dth/web': patch
---

**Generate Houdini project asks which Daz scene on the first project too.**

A multi-scene character's first generated project was wired to the primary scene without asking — a choice made on the user's behalf that nothing on screen admitted to, and that only surfaced as five import paths aimed at the wrong scene inside the finished network. The **Daz scene to import** picker now appears whenever more than one scene is linked, first project included. The primary is still the default, so pressing Generate straight away wires it exactly as before; a first project for an outfit scene now costs one click instead of a throwaway project or five hand edits in Houdini.
