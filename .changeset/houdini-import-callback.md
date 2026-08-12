---
'@dth/web': patch
'@dth/desktop': patch
---

A generated Houdini project now loads its character the way picking the file by hand does. Setting the `.dth` path from a script never ran the import node's own "a character was chosen" routine — the one that offers to fill the sibling paths and then actually reads the files — so a prefilled project could sit there with every path correct while the Alembic rested on the wrong frame, and the fix was to clear the fields and re-pick them. Generate project and Tools → Fill network now trigger that routine themselves (answering its prompt the way you would), and only fill in whatever it leaves blank, so the tool's own answers win. It runs only when the files are actually on disk: a project generated before the Daz export has produced them has nothing to load, and gets the plain paths exactly as before.
