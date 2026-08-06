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

The unit you pick is a **material** — the drawer lists the source's slots with
what each costs by hand (`MI_Skin` 15 surfaces · 4 bakers · 30 layers) and copies
the slot together with the bakers naming it. A Genesis 9 skin merges the same
surfaces on every character of that generation, so it transfers as-is; clothing
transfers when the target wears the same asset.

**What to copy** then picks which parts travel — material slots, UV channels,
texture bakers — all on by default, because a baker names its material
(`MI_Skin`) and its layers name UV sources as plain text, so bakers alone import
cleanly and bake nothing. Untick a part and the report names exactly what is then
missing. A material is flagged **needs UV channels** when its bakers read a UV
only a channel produces (a skin reads `uv_geoshell`; clothing reads only
`uv_original`, which every DTH import has) — so the answer to "do I need the UV
channels too?" is shown rather than guessed. On append, material slots merge by
name, so a skin setup copied onto a dressed character keeps its clothing
materials.

Material nodes are labelled by the **network box** around them when there is one
(`KiraDefault`, `KiraYoga`, `KiraNaked`) instead of `DazToHueMaterial`, `…1`,
`…2` — boxes stay optional, and an unboxed network just shows the node name.

Each written project is saved once, after a rolling `backup/<name>_dthbak.hiplc`.
