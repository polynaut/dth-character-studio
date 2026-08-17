# The Utils drawer

Every Houdini project card on the character page carries a **Utils** button (the 🔧
that appears on hover). It opens a drawer with a tab per job, and it works on **that
one project** — to work on another, open its own card's Utils.

- **Material**, **Skeleton**, **Occlusion** and **Groom occlusion** — copy a node's
  **complete setup** from one project into another. **This page.**
- **General** reads *this* project instead of copying into it:
  [Project checks and repairs](./houdini-project-checks.md).

## Copy a texture-baker setup between projects

Setting up a **DazToHueMaterial** node is the most tedious part of the whole
workflow: one skin material easily runs to four bakers of thirty layers, on top of
the material slots that merge fifteen Daz surfaces into one `Skin`.

<p align="center">
  <img width="900" alt="the Utils drawer: this project's target nodes, the source project and what to copy" src="screenshots/houdini-utils-drawer.png" />
  <br>
  <sub><em>The Utils drawer: this project's nodes as targets, a browsed project as the source, and what travels.</em></sub>
</p>

- **Target** — the DazToHue material nodes in **this** project. Tick the ones that
  should receive the copy; nothing is ticked for you, because this writes to the
  project. **Network boxes are picked up if you use them**: with several DTH
  networks the nodes are all called `DazToHueMaterial`, `DazToHueMaterial1`, … so
  the scan reads each box's title and lists them as `KiraDefault`, `KiraYoga`,
  keeping the node name beside it.
- **Source** — the node to copy *from*: pick another character from the studio, or
  **Browse…** for any Houdini project on disk (dropping a `.hip` on that button
  does the same). A project that keeps
  [**Houdini templates**](./attachments.md#houdini-templates) lists them here by
  name, and the **last five** sources come back as **Recently used** chips. Exactly
  one node can be the source.

  <p align="center">
    <img width="900" alt="the Source picker with the Recently used chips beneath it" src="screenshots/houdini-utils-recent-sources.png" />
    <br>
    <sub><em>The source you just picked comes back as a chip under the picker — the second use is one click.</em></sub>
  </p>
- **Transfer** asks for confirmation, then offers **Dry run** (changes nothing,
  reports exactly what a real run would do) and **Run**.

**Replace UV channels and bakers** is off by default: the copied ones are *added*
to whatever the target already has. Turned on, the target's existing UV channels
and bakers are removed first. It does not cover **material slots** — those always
[merge by surface](#material-slots-merge-by-surface).

## Pick a material, not a node

The thing you actually reuse is a **material**. The drawer lists the source node's
material slots with what each one costs by hand. Tick one and only that material
travels — its slot definition *and* the bakers that name it. Tick nothing and
everything is copied.

<p align="center">
  <img width="900" alt="the Materials list: each slot with its surfaces, bakers and layers" src="screenshots/houdini-utils-materials.png" />
  <br>
  <sub><em>Each slot with what it costs by hand — and which one needs the UV channels.</em></sub>
</p>

A **skin** slot merges the same ~15 Daz surfaces on every character of a
generation, so it transfers between any two Genesis 9 characters as-is.
**Clothing** slots only match when the target wears the same asset.

## What gets copied

**What to copy** picks which parts travel, all on by default:

| | what it is |
| --- | --- |
| **Material slots** | which Daz surfaces merge into each material — the merge list *is* the tedious part |
| **UV channels** | the node's UV channels and their operations (all of them — channels are positional, not named) |
| **Texture bakers** | the bakers of the picked materials, and every layer |

> **Bakers reference everything by name.** A baker copied into a node with no
> material called `MI_Skin` imports fine and then bakes nothing. Untick **Material
> slots** and the report names exactly which materials are missing.

**Do you need the UV channels?** The drawer tells you: a material shows **needs UV
channels** when its bakers read a UV that only a channel produces. A skin reads
`uv_geoshell` while clothing reads only `uv_original`, which every DTH import
already has — so a skin copy wants the channels and a clothing copy doesn't.

It isn't only advice: untick **UV channels** while such a material is selected and
**Transfer is disabled**, with the reason stated beside the checkbox. It applies
even to a target that *already* has matching channels, because UV channels carry no
name and the studio cannot verify what they produce.

**A parameter linked to another node arrives as its value.** DTH node names are
identical in every project, so a copied `ch("…/DazToHueMaterial/…")` reference would
silently rebind to the *target*'s own node. Expressions naming no node travel as
written.

## Material slots merge by surface

A material slot is a **claim on Daz surfaces**, and a surface can belong to only
one slot — so installing a slot removes exactly the slots claiming the same
surfaces, no more, no less. Copying a `Skin` that merges `Body Head Legs …` onto a
freshly imported character leaves you with `Skin` plus the clothing and eye slots
it never touched. A target slot claiming a *mix* of taken and untaken surfaces
keeps the ones nothing else claims.

The confirm dialog lists what this replaces at each target **before** you run.

## Same figure only — checked, not assumed

A material setup only transfers within one Genesis version, and the studio checks
this without knowing anything about generations: the surfaces your **selected
materials** claim are matched against the ones the target has.

- **Some** unclaimed is normal (the source wears a dress this character doesn't) —
  you get a note and the transfer runs.
- **None** matching means the two nodes describe different figures, and **Transfer
  is disabled**.
- A target with **no** material slots yet — a freshly generated network — is never
  flagged: setting an empty node up from a template is the normal reason to run a
  transfer.

## Portable texture paths

Texture layers store **absolute** paths into your Daz library, so a copied setup
breaks the day that library moves. **Portable texture paths** (on by default)
rewrites those under your library to `$DAZ3D_LIB/Runtime/Textures/…`, the variable
the studio wires into every configured `houdini.env`. Anything outside the library
stays absolute and the report lists it.

The transfer saves the target project once — the source is only read. **Close that
project in Houdini first**: Houdini writes the entire scene when you save, so an
open copy would overwrite the transfer.

> **Every run that writes takes a backup first** — one rolling
> `backup/<name>_dthbak.hiplc`, silently replaced each run. It only surfaces when
> something **fails**: the failed report entry grows an **Undo this run** button.
>
> **They last as long as the drawer.** Each is a full copy of the project, so on
> close the drawer lists what it made and asks — **Remove** or **Keep them**, with
> a warning if a failed run hasn't been undone. Only the studio's own `_dthbak`
> files are ever removed; Houdini's own backups are never touched.

## The Skeleton and Occlusion tabs

The same transfer for three more nodes, each with its own tab:

| Tab | Node | Sections copied |
| --- | --- | --- |
| **Skeleton** | `DazToHueSkeleton` | General · Skeleton · Skin Weights |
| **Occlusion** | `DazToHueOcclusion` | Occlusion Culling · Visualise |
| **Groom occlusion** | `DazToHueGroomOcclusion` | Options · Skin · Occlusion Mask · Texture Stamp · Visualise |

A skeleton setup carries just as much hand-work as a material one — 22 bone
renames, 10 reparents, 3 deletes, the physics-bone offsets and the skin-weight
operations — and Daz bone names are fixed per generation, so the whole block moves
between characters of that generation.

Each section here is copied **wholesale** (22 renames onto 22 existing ones would
be 44 rules, not a merged setup), so these tabs have no *Replace at target* toggle.
Tick only the sections you want — unlike a material setup, they do not depend on
each other. All three carry the same **Recently used** row as the Material tab,
from one list remembered per machine; each chip's **✕** drops the shortcut, never
the `.hip`.

> **The nodes' own `Linking` folders are deliberately not offered** — they hold
> parameter *references*, which would rebind to the target project's own node. Same
> rule as [above](#what-gets-copied).

&nbsp;

[← Into Houdini](./06-into-houdini.md) · [Next: Project checks and repairs →](./houdini-project-checks.md)
