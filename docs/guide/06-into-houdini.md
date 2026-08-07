# 6 · Into Houdini

The Houdini side of the pipeline is the **DazToHue HDA** — its own documentation
covers the network in depth; this page is just the hand-off.

## What the studio gives you

- The **Houdini assets** (otls, presets, toolbar) were merged into your Houdini
  documents folder during [setup](./02-setup.md).
- Your character's **PoseAsset CSV** — delivered into each scene's export
  folder under the same scene-suffixed base name as everything beside it
  (`<Name>_<Scene>_pose_asset.csv`; the primary scene's is plain
  `<Name>_pose_asset.csv`). Without direct export it's in the character's
  folder in the project (as `<Name>_pose_asset.csv`).
- The exporter's **`<Name>.abc`** / **`<Name>.dth`** next to it.
- For any **[Bone scale](./04-first-character.md)** frames, a
  **reference-skeleton FBX** each — the CSV already points at them, nothing to
  wire up.

## Hook it up

In your DazToHue network, point the **PoseAsset** import at the character's
`_pose_asset.csv` and the geometry import at the exported `.abc`/`.dth`.

Wire the network once — from then on the studio can run it for you: pick the
project in [**DTH Export**](./05-rom-in-daz.md#batch-export--dth-export) and it
opens Houdini, runs the DazToHue exports for the scenes in scope, and closes
Houdini again when they're done — with **Skip Daz — use last exports** for a
Houdini-only pass.

> [!TIP]
> Use Houdini's **File → Set Project** on the character's
> **[`houdini-project` folder](./05-rom-in-daz.md#where-the-houdini-project-fits)**
> so `$JOB` means one thing per character. The exports live on the Daz side,
> one `..` up from the scene: in the file picker, navigate to
> `../daz3d/dth-exports/` and tick **Make path relative to current directory**
> — the import reads `$HIP/../daz3d/dth-exports/primary/<Name>.dth` and the
> `.hip` stays portable.

## Generate the Houdini project automatically

The character page's **Houdini projects → Generate project** creates the whole
project for you: a new scene named after the character (editable in the dialog,
which refuses a name that already exists), saved in the houdini folder **next
to** the `houdini-project` folder it Set-Projects into, with **Set Project
already baked in** and the **DazToHue network ready** — open it and import.
The project folder is shared: generate a second or third project and they all
open with the same `$JOB`.

<p align="center">
  <img width="900" alt="the Generate Houdini project dialog" src="screenshots/houdini-generate-dialog.png" />
  <br>
  <sub><em>Generate project: one name, prefilled — the studio builds the scene, Set Project and the DazToHue network.</em></sub>
</p>

```
houdini/
├─ PlaygroundAssets_Ita.hiplc   ← the generated scene (imports ../daz3d/dth-exports/…)
└─ houdini-project/             ← $JOB (Set Project), shared by every project
```

Removing a **generated** project asks about its files: with **Keep houdini
files** on it is only unlinked; turned off, its scene file is deleted too. The
shared `houdini-project` folder always stays — the character's other projects
open with it, and it holds no exports. Hand-linked projects are always
unlink-only.

One one-time Settings entry powers it: the **Houdini installation folder**
(Houdini's own install directory — its `bin\hython.exe` builds the scene
headlessly). Its version must have a **matching Houdini documents folder**
configured (`Houdini 22.0.x` ↔ `…\Documents\houdini22.0`) so the DazToHue
assets load — Settings warns live when the pair doesn't match. The DazToHue
network is created from your **installed DazToHue HDA** at generate time, so
it's always the current plugin version — no template scene that could rot
across Houdini or DazToHue updates. If the HDA isn't installed the project
still generates (empty scene, Set Project baked) and the studio tells you to
add the network from the DazToHue shelf.

## Utils — copy a texture-baker setup between projects

Setting up a **DazToHueMaterial** node is the most tedious part of the whole
workflow: one skin material easily runs to four bakers of thirty layers, each
layer naming a texture, a geometry group, a blend mode and seven adjustments —
on top of the material slots that merge fifteen Daz surfaces into one `Skin`.
If you reuse the same skin across characters, you were rebuilding all of it by
hand.

The **Utils** button on a Houdini project card (the 🔧 that appears on hover)
opens a drawer that copies a material node's **complete setup** — material
slots, UV channels and texture bakers — from one project into another.

<p align="center">
  <img width="900" alt="the Utils drawer: target projects, source project and what to copy" src="screenshots/houdini-utils-drawer.png" />
  <br>
  <sub><em>The Utils drawer: the character's own projects as targets, a browsed project as the source, and what travels.</em></sub>
</p>

- **Target** — this character's linked Houdini projects, with every DazToHue
  material node found in each. Tick as many as you want; the card you opened
  Utils from starts selected.

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
  name as one-click sources. Exactly one node can be the source.
- **Transfer** asks for confirmation, then offers **Dry run** (changes nothing,
  reports exactly what a real run would do) and **Run**.

**Replace UV channels and bakers** is off by default: the copied ones are
*added* to whatever the target already has. Turned on, the target's existing UV
channels and bakers are removed first. It does not cover **material slots** —
those always [merge by surface](#material-slots-merge-by-surface).

### Pick a material, not a node

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

### What gets copied

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

### Material slots merge by surface

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
and the report names it again afterwards. The eviction set is read out of the
source's own slots at transfer time, so it needs no per-generation knowledge —
but for that same reason the studio cannot tell a Genesis 9 skin from a Genesis
8 one. If the copied materials claim surfaces that exist on *no* slot at the
target, the drawer says so: a few is normal (the source wears something this
character doesn't), all of them means you are copying between different figures.

### Portable texture paths

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

Every project the transfer writes is saved once, after its previous state is
kept as `backup/<name>_dthbak.hiplc` (one rolling backup, beside Houdini's own).
**Close the target projects in Houdini first** — Houdini writes the entire scene
when you save, so an open copy would overwrite the transfer.

### The Skeleton tab

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

Like Generate project, this runs Houdini's `hython`, so it needs the **Houdini
installation folder** and its matching documents folder in Settings. The drawer
scans when it opens, after a run, and when you press **Rescan** — but a project
is only re-read when its file changed since the last look, so coming back to
projects nobody touched costs nothing. Reading a `.hip` the first time takes a
few seconds; a transfer rewrites its targets, so exactly those are read again
and their neighbours aren't. One scan serves both tabs, so switching between
Material and Skeleton is instant.

## `$DAZ3D_LIB` — your Daz library, as a variable

With both **My DAZ 3D Library** and the **Houdini documents folder** set in
Settings, the studio maintains a `DAZ3D_LIB` variable in each configured
Houdini version's `houdini.env`, pointing at your Daz library. Reference any
library file as `$DAZ3D_LIB/…` (textures, geometry, presets) instead of
hardcoding machine paths — together with `$JOB` imports, the whole project
stays moveable. It updates automatically when the library path changes in
Settings, and **Tools → Refresh assets** (re)wires it too — restart Houdini to
pick up changes.

> [!NOTE]
> In the export folder, every scene's delivered CSV is scene-suffixed — always
> point the PoseAsset import at the CSV sitting in the scene subfolder you
> exported. (In the character's folder, a scene whose
> [per-scene ROM overrides](./advanced.md#rom-overrides) change the **frame
> layout** additionally has its own source CSV — see
> [What Save generates](./advanced.md#what-save-generates).)

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="houdini, daztohue hda poseasset import" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>Point the DazToHue HDA's PoseAsset import at the character's CSV.</em></sub>
</p>
-->

&nbsp;

> [!NOTE]
> That's the whole trick: the CSV comes from the **same definition** as the Daz
> script you just ran, so every frame Houdini expects is exactly where Daz put
> it. Change the character later, Save, re-run, re-export — both sides move
> together.

&nbsp;

From here, continue with the [DazToHue](https://docs.google.com/document/d/1LYXl90FCXPX5KVpru4_T_hCY_XLr9vinR_9zYENPHUw/edit?tab=t.0)
documentation for the Houdini → Unreal leg.

---

**That's it — first character, first ROM, both sides in sync.** From the second
character on, the loop is just: *Add character → Fill from character → adjust
morphs → Save → run the script.*

[← Build the ROM in Daz](./05-rom-in-daz.md) · [Guide overview](./README.md)
