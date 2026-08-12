---
'@dth/web': patch
'@dth/desktop': patch
---

A generated Houdini project now opens with its character already loaded, on the rest pose. Setting the import paths from a script never ran the import node's own "a character was chosen" routine — the one that offers to fill the sibling paths and then actually reads the files, which is what sets the Alembic's frame range and puts the scene on frame 0. So a freshly generated project could hold every path correctly and still sit on the wrong frame, and the fix was to clear the fields and re-pick them by hand. Generate project and Tools → Fill network now run that routine themselves (answering its prompt the way you would), and the studio puts its own `$HIP/…` paths back afterwards, so the project stays movable. It runs only when the files are really on disk: a project generated before the Daz export has produced them has nothing to load, and comes out exactly as before.
