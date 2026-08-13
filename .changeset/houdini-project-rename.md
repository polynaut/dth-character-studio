---
'@dth/web': minor
---

**Houdini project names are editable.** Click a project card's name and type a
new one — the file on disk is renamed with it and the link follows, so a
generated `3d-workflow_LaraCroft_G81` can just become `Lara`. The same inline
edit the character title and the Daz scene cards already had.

The extension is carried over rather than assumed: `.hip`, `.hiplc` and `.hipnc`
encode the licence tier, and rewriting a commercial `.hip` to `.hiplc` would
tell Houdini the file is licence-limited.

Renaming is offered where *moving* a project still isn't, and that is not an
inconsistency: everything the studio bakes into a project is anchored on `$JOB`
(the character folder) and `$HIP` (the folder the file sits in) — both
**folders**, so the file's own name is the one part of its location nothing
points at. Moving it would change both.

Only projects inside the character folder are renamable. One you linked in place
from your own tree is your file, in a tree the studio can't see the rest of, so
its name has no pencil — the same rule the Daz scenes already apply.
