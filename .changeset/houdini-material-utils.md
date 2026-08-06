---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Houdini card **Utils**: copy a DazToHueMaterial node's texture-baker setup between projects

A skin material is easily 4 bakers of 30 layers — each naming a texture, a group,
a blend mode and seven adjustments — and reusing it on a new character meant
rebuilding all of it by hand. The 🔧 on a Houdini project card now opens a drawer
that copies the whole baking definition from one material node onto any number of
this character's nodes: source from another studio character or any `.hip` via
Browse, append or **Replace at target**, with a dry run that writes nothing.

Material nodes are labelled by the **network box** around them when there is one
(`KiraDefault`, `KiraYoga`, `KiraNaked`) instead of `DazToHueMaterial`, `…1`,
`…2` — boxes stay optional, and an unboxed network just shows the node name.

Bakers reference their material and geometry groups by name, so the report names
every material a target is missing — a baker with no matching material slot
imports cleanly and then bakes nothing. Each written project is saved once, after
a rolling `backup/<name>_dthbak.hiplc`.
