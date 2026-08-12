---
'@dth/web': minor
---

**The Utils drawer can copy an occlusion setup now — two new tabs, one per node.**

**Occlusion** carries the `DazToHueOcclusion` node: **Occlusion Culling** (the
manual occlusion attributes and the Auto-Occlusion operation list) and
**Visualise**. **Groom occlusion** carries `DazToHueGroomOcclusion` with its own
**Options**, **Skin**, **Occlusion Mask**, **Texture Stamp** and **Visualise**.
They are separate tabs because they are separate nodes with different setups —
one tab whose section list changed under you would be worse than two.

They work exactly like the Skeleton tab: pick a source node (a project of your
own, a Houdini template, or the **Recently used** row), tick the targets, tick
the sections, **Dry run** to see what would change, **Run** to do it. Each
section is a folder copied **wholesale** — its settings and any lists inside it
replace the target's — so there is no *Replace at target* toggle, and the count
beside a section is how much is actually set there. The same silent backup as
every other transfer is taken before anything is saved.

The node's own **Linking** folder is deliberately not offered: it holds
parameter references, and DTH node names are identical in every project, so a
copied reference would rebind to the target project's own node and read the
wrong values without erroring — the same rule the material transfer has always
followed for a linked parameter.

A folder transfer that cannot find one of its folders now **says so and copies
nothing**, instead of quietly skipping that section and reporting *Transfer
complete* — if a DazToHue release renames a folder, the run fails with the name
it looked for rather than leaving you to notice the setup never arrived. This
applies to the Skeleton tab too.

Also fixes a stale tooltip: the **What to copy** info popup explained the
material node's baker/UV interdependency on *every* transfer tab, including
Skeleton, where none of it applied.
