---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Generate Houdini project asks which Daz scene on the FIRST project too

A multi-scene character's first generated project was wired to the primary scene
without asking — a choice made on the user's behalf that nothing on screen
admitted to, and that only surfaced as five import paths aimed at the wrong scene
inside the finished network. The **Daz scene to import** picker now appears
whenever there is more than one linked scene, first project included.

The primary is still the default, so pressing Generate straight away wires it
exactly as before; a first project for an outfit scene now costs one click
instead of a throwaway project or five hand edits in Houdini.
