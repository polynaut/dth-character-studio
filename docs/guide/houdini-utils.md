# The Utils drawer

Every Houdini project card on the character page carries a **Utils** button (the
🔧 that appears on hover). It opens a drawer with a tab per job.

**The drawer works on that one project.** Utils are per project — that is why the
button lives on the card rather than on the section — so everything inside is
about the `.hip` you pressed it on: its checks, its repairs, its nodes. To work
on another project, open its own card's Utils. (The one exception is the
**source** of a copy, which is by definition another project.)

- **Material**, **Skeleton**, **Occlusion** and **Groom occlusion** — copy a
  node's **complete setup** from one project into another. One tab per DazToHue
  node kind, because a setup belongs to its node: the material tab carries
  material slots, UV channels and texture bakers, the other three carry their
  node's own option folders. **This page.**
- **General** reads *this* project instead of copying into it — the health check
  and the repairs for what it finds. It has its own page:
  [Project checks and repairs](./houdini-project-checks.md).

For what the studio hands Houdini in the first place — the CSV, the exports and
the generated project — see [Into Houdini](./06-into-houdini.md).

## Copy a texture-baker setup between projects

Setting up a **DazToHueMaterial** node is the most tedious part of the whole
workflow: one skin material easily runs to four bakers of thirty layers, each
layer naming a texture, a geometry group, a blend mode and seven adjustments —
on top of the material slots that merge fifteen Daz surfaces into one `Skin`.
If you reuse the same skin across characters, you were rebuilding all of it by
hand.

<p align="center">
  <img width="900" alt="the Utils drawer: this project's target nodes, the source project and what to copy" src="screenshots/houdini-utils-drawer.png" />
  <br>
  <sub><em>The Utils drawer: this project's nodes as targets, a browsed project as the source, and what travels.</em></sub>
</p>

- **Target** — the DazToHue material nodes in **this** project, the one whose
  card you opened Utils from. Tick the ones that should receive the copy;
  nothing is ticked for you, because this writes to the project. To copy into a
  different project, open that card's Utils.

  **Network boxes are picked up if you use them.** Once a project holds more
  than one DTH network, the usual way to keep them apart is to wrap each in a
  network box and give it a title — and then the nodes inside are all called
  `DazToHueMaterial`, `DazToHueMaterial1`, `DazToHueMaterial2`, which says
  nothing about which network you're picking. The scan reads the box title and
  lists those as `KiraDefault`, `KiraYoga`, `KiraNaked`, keeping the node name
  beside it. Boxes are entirely optional: with one network — or an untitled
  box — the list simply shows the node name, exactly as before.
- **Source** — the node to copy *from*: pick another character from the studio,
  or **Browse…** for any Houdini project on disk (dragging a `.hip` out of
  Explorer onto that button does the same). A project that keeps
  **[Houdini templates](./attachments.md#houdini-templates)** lists them here by
  name as one-click sources. The **last five** sources you picked are offered as
  **Recently used** chips under the picker, so the template you keep coming back
  to is one click rather than another trip through the file dialog — re-picking
  one floats it back to the top, and a file that has since moved or been deleted
  drops out of the row rather than offering a chip that can't open. Exactly one
  node can be the source.

  <p align="center">
    <img width="900" alt="the Source picker with the Recently used chips beneath it" src="screenshots/houdini-utils-recent-sources.png" />
    <br>
    <sub><em>The source you just picked comes back as a chip under the picker — the second use is one click.</em></sub>
  </p>
- **Transfer** asks for confirmation, then offers **Dry run** (changes nothing,
  reports exactly what a real run would do) and **Run**.

**Replace UV channels and bakers** is off by default: the copied ones are
*added* to whatever the target already has. Turned on, the target's existing UV
channels and bakers are removed first. It does not cover **material slots** —
those always [merge by surface](#material-slots-merge-by-surface).

## Pick a material, not a node

The thing you actually reuse is a **material**. The drawer lists the source
node's material slots with what each one costs by hand:

<p align="center">
  <img width="900" alt="the Materials list: each slot with its surfaces, bakers and layers" src="screenshots/houdini-utils-materials.png" />
  <br>
  <sub><em>Each slot with what it costs by hand — and which one needs the UV channels.</em></sub>
</p>

Tick one and only that material travels — its slot definition *and* the bakers
that name it. Tick nothing and everything is copied.

This matters because the two halves behave differently. A **skin** slot merges
the same ~15 Daz surfaces on every character of a generation, so it transfers
between any two Genesis 9 characters as-is. **Clothing** slots only match when
the target wears the same asset.

## What gets copied

**What to copy** picks which parts travel, all on by default:

| | what it is |
| --- | --- |
| **Material slots** | which Daz surfaces merge into each material — the merge list *is* the tedious part |
| **UV channels** | the node's UV channels and their operations (all of them — channels are positional, not named) |
| **Texture bakers** | the bakers of the picked materials, and every layer |

> **Bakers reference everything by name.** A baker copied into a node that has no
> material called `MI_Skin` imports fine and then bakes nothing. Untick
> **Material slots** and the report names exactly which materials are then
> missing, so you know what to set up by hand first — unticking **UV channels**
> is refused outright when it would strand a baker (below).

**Do you need the UV channels?** The drawer tells you: a material shows
**needs UV channels** when its bakers read a UV that only a channel produces.
Measured on a real setup — a skin reads `uv_geoshell` (built by the
Copy-From-Geoshell channels), while clothing reads only `uv_original`, which
every DTH import already has. So a skin copy wants the channels and a clothing
copy doesn't, and you don't have to remember which.

It isn't only advice. Untick **UV channels** while such a material is selected
and **Transfer is disabled**, with the reason stated beside the checkbox that
caused it: those bakers would land pointing at a UV name nothing at the target
creates. Tick the channels, or deselect that material — either clears it. The
block applies only while **Texture bakers** travel; without them there is no UV
dependency to satisfy.

This also blocks a target that *already* has matching channels. UV channels
carry no name — they are positional — so the studio cannot verify that a
target's channels produce `uv_geoshell`, and it refuses rather than let a copy
through on an assumption it can't check.

**A parameter linked to another node arrives as its value.** The DazToHue HDA's
own **Linking** rewrites a node's parameters into references at its source
(`ch("…/DazToHueMaterial/…")`) so it live-mirrors another node inside the same
network. A reference like that cannot cross into another file: DTH node names
are identical in every project, so the copy would silently rebind to the
*target* project's own node and read wrong values without erroring. Such a
parameter is copied as the value it had in the source — which is what you meant
to reuse. Expressions naming no node travel as written.

## Material slots merge by surface

A material slot is a **claim on Daz surfaces**, and a surface can belong to only
one slot. So installing a slot removes exactly the slots that claim the same
surfaces — no more, no less.

Copying a `Skin` that merges `Body Head Legs …` onto a freshly imported
character (which holds each of those as its *own* slot) leaves you with `Skin`
plus the clothing and eye slots it never touched. Neither of the obvious
alternatives is right: replacing the list wholesale would throw away the
clothing, and appending would leave the target's `Body` beside the incoming
`Skin` that already claims it — the same surface claimed twice.

A target slot claiming a *mix* of taken and untaken surfaces is not dropped; it
keeps the ones nothing else claims.

The confirm dialog lists what this replaces at each target **before** you run,
and the report names it again afterwards.

## Same figure only — checked, not assumed

A material setup only transfers within one Genesis version. The studio checks
that without knowing anything about generations: the surfaces your **selected
materials** claim are matched against the ones the target actually has.

- **Some** unclaimed is normal — the source wears a dress this character
  doesn't. You get a note, and the transfer runs.
- **None** matching means the two nodes describe different figures, and
  **Transfer is disabled**, with the target named. The copied slots would name
  surfaces that aren't there and every baker would bake nothing. Deselect that
  target, or pick a source built from the same figure.

Because the match list comes from the source itself, this is right for every
generation — including ones the studio has never been told about, and
third-party figures.

A target with **no** material slots yet — a freshly generated DazToHue network —
is never flagged and never blocked. There is nothing there to contradict, and
setting an empty node up from a template is the normal reason to run a transfer
in the first place.

## Portable texture paths

Texture layers store **absolute** paths into your Daz library
(`D:\DAZ 3D\My DAZ 3D Library\Runtime\Textures\…`), so a copied setup breaks the
day that library moves — or the day the project opens on a machine where it sits
on another drive.

**Portable texture paths** (on by default) rewrites those to
`$DAZ3D_LIB/Runtime/Textures/…`, the variable the studio already wires into
every configured `houdini.env`. Houdini expands it at load, so the setup keeps
working wherever the library lives. Turn it off to copy the paths exactly as the
source stored them.

Only paths **under** your Daz library are rewritten. A texture living somewhere
else can't be made portable, so it stays absolute and the report lists it — the
copy is only as movable as those paths.

The transfer saves the target project once — the source is only read. **Close
that project in Houdini first** — Houdini writes the entire scene when you save,
so an open copy would overwrite the transfer.

> **Every run that writes takes a backup first**, and you never have to think
> about it: one rolling `backup/<name>_dthbak.hiplc` beside Houdini's own,
> silently replaced each run. It only ever surfaces when something **fails** —
> the failed entry in the report grows an **Undo this run** button that puts
> that project back exactly as it was. A run that worked has nothing to undo,
> so it says nothing.
>
> **They last as long as the drawer.** A backup is an undo buffer for this
> sitting, not an archive — each is a full copy of the project, so leaving them
> to pile up beside every project you ever touched is how a disk fills. When you
> close the drawer it lists what it made and asks: **Remove** clears them,
> **Keep them** doesn't. If a run failed and you haven't undone it, the prompt
> says so — that copy is the only way back. Only the studio's own `_dthbak`
> files are ever removed; Houdini's backups in the same folder are never
> touched, and a file Houdini is holding open stays put.

## The Skeleton tab

The same transfer for the **DazToHueSkeleton** node, which carries just as much
hand-work — a real setup here holds 22 bone renames, 10 reparents, 3 deletes,
the breast/glute physics-bone offsets and the skin-weight operations. Daz bone
names are fixed per generation, so that whole block moves between characters of
that generation.

Sections are the node's own three tabs — **General**, **Skeleton** and **Skin
Weights** — and each one is copied **wholesale**: a configuration block isn't a
list you append to (22 renames onto 22 existing ones would be 44 rules, not a
merged setup), so this tab has no *Replace at target* toggle. The counts beside
each section are how much is actually set there, not how many parameters exist.

It carries the same **Recently used** row as the Material tab, and the same list
behind it: sources are remembered per machine, not per tab and not per project,
because the template you copy from usually lives outside any project. The row
remembers *every* source you pick, including the one-off look, so each chip has
a **✕** to drop it again — that removes the shortcut only, never the `.hip`.

## The Occlusion tabs

Same transfer again, for the two occlusion nodes — and they are two, so they get
a tab each rather than one tab that changes shape under you:

- **Occlusion** — the **DazToHueOcclusion** node. Its sections are **Occlusion
  Culling** (the substance: the manual occlusion attributes and the
  Auto-Occlusion operation list) and **Visualise** (what the node draws in the
  viewport while you work).
- **Groom occlusion** — the **DazToHueGroomOcclusion** node, with its own
  **Options**, **Skin**, **Occlusion Mask**, **Texture Stamp** and **Visualise**.

Like the Skeleton tab, each section is a folder copied **wholesale** — its
settings and any lists inside it replace the target's — so there is no *Replace
at target* toggle, and the count beside a section is how much is actually set
there. Tick only the sections you want; unlike a material setup, these do not
depend on each other.

> **The node's own `Linking` folder is deliberately not offered.** It holds
> parameter *references*, and DTH node names are identical in every project — a
> copied reference would quietly rebind to the target project's own node and
> read the wrong values without erroring. It is the same rule the material
> transfer follows, where a linked parameter travels as
> [its value](#what-gets-copied).

## Checking and repairing the project itself

The **General** tab copies nothing — it reads the project you opened Utils on,
and repairs what it can. It has its own page:
**[Project checks and repairs](./houdini-project-checks.md)**.

&nbsp;

[← Into Houdini](./06-into-houdini.md) · [Next: Project checks and repairs →](./houdini-project-checks.md)
