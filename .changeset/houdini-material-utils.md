---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

Houdini card **Utils**: copy a DazToHueMaterial node's setup between projects

A skin material is easily 4 bakers of 30 layers — each naming a texture, a group,
a blend mode and seven adjustments — on top of the slots merging fifteen Daz
surfaces into one `Skin`. Reusing it on a new character meant rebuilding all of
it by hand. The 🔧 on a Houdini project card now opens a drawer that copies that
setup from one material node onto any number of this character's nodes: source
from another studio character or any `.hip` via Browse, append or **Replace at
target**, with a dry run that writes nothing.

**What to copy** covers all three parts of a setup — material slots, UV channels
and texture bakers — because they only work together: a baker names its material
(`MI_Skin`) and its layers name UV channels (`uv_original`, `uv_geoshell`) as
plain text, so bakers alone import cleanly and bake nothing. Untick a part and
the report still names exactly what the target is then missing. On append,
material slots merge by name, so a skin setup copied onto a dressed character
keeps its clothing materials.

Material nodes are labelled by the **network box** around them when there is one
(`KiraDefault`, `KiraYoga`, `KiraNaked`) instead of `DazToHueMaterial`, `…1`,
`…2` — boxes stay optional, and an unboxed network just shows the node name.

Each written project is saved once, after a rolling `backup/<name>_dthbak.hiplc`.
