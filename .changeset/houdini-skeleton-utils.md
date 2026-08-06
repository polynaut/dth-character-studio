---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Utils drawer: a **Skeleton** tab that transfers a DazToHueSkeleton setup

The skeleton node carries as much hand-work as the material one — measured on a
real project: 22 bone renames, 10 reparents, 3 deletes, breast/glute physics-bone
offsets and two skin-weight operations — and because Daz bone names are fixed per
generation, the whole block transfers between characters of that generation.

Sections are the node's own three tabs (General, Skeleton, Skin Weights), so they
read here the way they read in Houdini. Each is copied **wholesale**: a
configuration block is not a list you append to, since adding 22 renames onto 22
existing ones would make 44 rules rather than a merged setup — so the skeleton
tab has no append mode, and no texture paths to make portable.

One scan serves both tabs. Opening a `.hip` costs tens of seconds, so switching
tab must not pay it again.
