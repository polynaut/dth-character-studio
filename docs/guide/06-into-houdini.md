# 6 · Into Houdini

The Houdini side of the pipeline is the **DazToHue HDA** — its own documentation
covers the network in depth; this page is just the hand-off.

## What the studio gives you

- The **Houdini assets** (otls, presets, toolbar) were merged into your Houdini
  documents folder during [setup](./02-setup.md).
- Your character's **PoseAsset CSV** — delivered into each scene's export
  folder under the same scene-suffixed base name as everything beside it
  (`<Name>_<Scene>_pose_asset.csv`; the primary scene's is plain
  `<Name>_pose_asset.csv`). Without direct export, take it from the studio's
  own copy: `<Project>/.dcsmeta/characters/<Character>/<Name>_pose_asset.csv`.
  That folder is hidden and belongs to the app — read from it, don't edit it;
  the next Save overwrites what's there.
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
> Use Houdini's **File → Set Project** on the
> **[character folder](./05-rom-in-daz.md#where-the-houdini-project-fits)**
> itself — the one holding `houdini/` — so `$JOB` covers the exports as well as
> the scene. The exports sit beside the scene: in the file picker, navigate to
> `daz-export/` and tick **Make path relative to current directory** — the
> import reads `$JOB/houdini/daz-export/primary/<Name>.dth` and the `.hip` stays
> portable.

## Generate the Houdini project automatically

The character page's **Houdini projects → Generate project** creates the whole
project for you: a new scene named after the character (editable in the dialog,
which refuses a name that already exists), saved in the character's houdini
folder, with **Set Project already baked in** — `$JOB` on the **character
folder**, so both the scene and the exports sit under it — and the **DazToHue
network ready**. The network comes out
**wired**: the import file paths (`.dth`, FBX, Alembic, ROM FBX), the
**PoseAsset CSV path**, the **export directory** and the **Skinning method**
(Linear / Dual Quaternion, from the ROM definition) are prefilled — relative to
`$JOB` — the character folder — (`$JOB/houdini/daz-export/…`) by default, absolute when the
project's
[Houdini path style](./05-rom-in-daz.md#reference-skeleton-paths--hip-by-default)
says so — and the **character name** is set with them. A parameter
your installed DazToHue version doesn't have yet is simply skipped (the CSV
path needs the release with the CSV-driven PoseAsset node).

**Which scene?** A character with several Daz scenes gets a **Daz scene to
import** picker in the dialog (a single-scene character isn't asked). Each scene
exports into its own folder, so the pick decides which export set the imports
point at — generate one project per scene to cover them all.

The **export directory** is a different folder from the imports, on purpose:
they read the Daz→Houdini intermediates under `daz-export`, while Houdini
writes its own Unreal-bound output to the character's **`export/`** folder
(`$JOB/export/`, or whatever the project's *Final export subfolder* is
named). One `export/` per character, shared by every scene's project.
Generate a second or third project and they all land in the same houdini folder,
so they share both `$JOB` and `$HIP` — and with `$HIP` shared, Houdini's own
output (renders, caches, backups) collects in that one folder rather than
scattering per scene.

<p align="center">
  <img width="900" alt="the Generate Houdini project dialog" src="screenshots/houdini-generate-dialog.png" />
  <br>
  <sub><em>Generate project: one name, prefilled — the studio builds the scene, Set Project and the DazToHue network.</em></sub>
</p>

```
Ita/                            ← $JOB (Set Project), baked into every scene
├─ daz3d/                       ← your Daz scenes
└─ houdini/                     ← $HIP, and the shared project folder
   ├─ PlaygroundAssets_Ita.hiplc   ← the generated scene (imports daz-export/…)
   ├─ daz-export/                  ← what the DTH Exporter wrote, per scene
   └─ render/ geo/ backup/         ← Houdini's own output, shared by every scene here
```

Removing a **generated** project asks about its files: with **Keep houdini
files** on it is only unlinked; turned off, its scene file is deleted too. The
houdini folder itself always stays — the character's other scenes live in it,
and so does its `daz-export` folder. Hand-linked projects are always
unlink-only.

One one-time Settings entry powers it: the **Houdini installation folder**
(Houdini's own install directory — its `bin\hython.exe` builds the scene
headlessly), paired with the **matching Houdini documents folder**
(`Houdini 22.0.x` ↔ `…\Documents\houdini22.0`) so the DazToHue assets load.
Normally you never type either: activating a Houdini card in
[**Settings → General**](./02-setup.md#houdini-installation--same-idea) fills
both together, which is exactly why the cards exist. Fill them by hand on a
machine with no card and Settings warns live when the pair doesn't match. The DazToHue
network is created from your **installed DazToHue HDA** at generate time, so
it's always the current plugin version — no template scene that could rot
across Houdini or DazToHue updates. If the HDA isn't installed the project
still generates (empty scene, Set Project baked) and the studio tells you to
add the network from the DazToHue shelf.

## Project checks — what the card warns about

The studio checks a character's own Houdini projects in the background: opening
the character page scans them (at most two at a time) and caches the result, so
nothing waits on Houdini and a project you haven't touched since costs nothing to
re-check. Projects linked from **outside** the character folder are left alone —
those are yours, and the studio has no `$JOB` expectation for them.

A project that needs attention gets a **Needs attention** marker on its card,
with the reason in the tooltip:

| What it says | What it means |
| --- | --- |
| `$JOB` points at … | the project's Set Project is another character's folder — every path it stores collapses against the wrong root |
| import paths do not resolve | a `.dth`/FBX/Alembic reference points at a file that isn't there |
| Not filled in yet | a DazToHue parameter the studio knows the value for is still blank |

All of them are repaired from the **Utils** drawer's *General* tab
(**Repair $JOB**, **Make paths portable**, **Fill network**) — which is exactly
what makes **copying** a project workable: a copy arrives carrying the source's
`$JOB` and file references, the card tells you so, and three buttons fix it.

> [!NOTE]
> The checks cover `$JOB`, the DazToHue import paths and blank parameters. They
> do **not** verify material texture paths — a clean card is not a promise that
> every path in the scene resolves.

## Utils — copy a texture-baker setup between projects

Setting up a **DazToHueMaterial** node is the most tedious part of the whole
workflow: one skin material easily runs to four bakers of thirty layers, each
layer naming a texture, a geometry group, a blend mode and seven adjustments —
on top of the material slots that merge fifteen Daz surfaces into one `Skin`.
If you reuse the same skin across characters, you were rebuilding all of it by
hand.

The **Utils** button on a Houdini project card (the 🔧 that appears on hover)
opens a drawer with three tabs. It opens on **General** — the health check of
the projects themselves, described [below](#the-general-tab) — while
**Material** and **Skeleton** copy a node's **complete setup** from one project
into another: material slots, UV channels and texture bakers.

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
and the report names it again afterwards.

### Same figure only — checked, not assumed

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
third-party figures. A target with **no** material slots yet (a fresh DazToHue
network) is never blocked: there is nothing to contradict, and setting one up
from a template is exactly what the drawer is for.

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

Every project the transfer writes is saved once. **Close the target projects in
Houdini first** — Houdini writes the entire scene when you save, so an open copy
would overwrite the transfer.

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

### The General tab

The tab the drawer opens on, and the only one useful without a second project
picked: what each linked project carries **now**, and what the studio can put
right. Every check is one row — its name on the left, the verdict on the right,
the value beneath — and the fixes sit in the footer, in the order they have to
be run. (**Refresh assets** leads them but answers to no check; see below.)

<p align="center">
  <img width="900" alt="the General tab: one row per check, verdicts aligned right, the fixes in the footer" src="screenshots/houdini-utils-general.png" />
  <br>
  <sub><em>A project made before v0.64: <code>$JOB</code> still points below the exports, everything else passes.</em></sub>
</p>

**Project folder (`$JOB`)** is the one you can repair. `$JOB` is saved *inside*
each `.hip`, so a project keeps whatever it was created with — and projects made
before v0.64 point it at the shared `houdini/houdini-project` folder, which sits
*below* your exports. Houdini only turns a path you pick into a variable when
that path is under `$HIP` or `$JOB`, so in those projects choosing an export by
hand writes an **absolute** path, and the project quietly stops being movable.

Measured with the call Houdini's own file picker uses:

| `$JOB` | picking an export gives you |
| --- | --- |
| `<character>/houdini/houdini-project` | `D:\…\Ita\houdini\daz-export\primary\Ita.fbx` |
| `<character>` — what **Repair `$JOB`** writes | `$JOB/houdini/daz-export/primary/Ita.fbx` |

`$HIP` still wins for paths inside the houdini folder, so this disturbs nothing
that already works.

> **It fixes what you pick from now on.** Repointing `$JOB` does not rewrite
> references that are *already* stored absolute — that is what **Make paths
> portable** below is for.

**Reference paths** and **Import references** are the other half. Repairing
`$JOB` decides how *future* picks are written down; these two fix what is
already written.

**Make paths portable** does two things in one pass:

- Rewrites every absolute reference that sits under `$HIP`, `$JOB` or
  `$DAZ3D_LIB` so it is stored relative to that variable instead. On a real
  project that was **131 texture paths**, all of them into the Daz library.
  Anything under none of those roots can't be made portable — it stays exactly
  as it is and the report names it.
- Rebuilds a **DazToHue import** path that points at a file which isn't there.
  Two cases, one pass. Projects made before v0.63 address their `.dth` through
  the retired `dth-exports` junction, so it dangles while the `.fbx` and `.abc`
  beside it are fine — the replacement is derived from that same node's other
  export files, which sit together under the same name. Projects made before
  v0.69 point at the old export folder, and there **every** import broke at
  once, so no sibling survives to follow: those are rebuilt from the character's
  current export directory instead. Either way the new path is only written when
  the file it would point at **actually exists**. Nothing is guessed.

> **`$JOB` has to be right first**, and the button stays disabled until it is.
> A path is made relative to whatever `$JOB` the scene currently carries, so
> repathing a project that still has the old value would store every export
> path against the wrong folder. Measured on one real project: with the stale
> `$JOB` it reports *0* paths it can fix; after the `$JOB` repair, the same file
> reports *2*.

Both offer a **Dry run**, and both take the same silent backup described above —
so a failed run can be undone from its own report. Running twice changes nothing
the second time.

**Fill network** gives an *existing* project the same wiring
[Generate project](#generate-the-houdini-project-automatically) gives a new one:
the import file paths, the export directory and — once your DazToHue has it —
the PoseAsset CSV path. Projects you already have can never be regenerated, so
this is how they catch up.

Two things make it safe to run on a project you set up by hand:

- **Only blank parameters are written.** Anything you filled in yourself is
  listed as *already set, left alone* and never touched.
- **A parameter your DazToHue version doesn't have is named, not silently
  skipped.** DazToHue 2.5 has no PoseAsset CSV *path* — the node ships an import
  *button* instead — so the row says so, and the same action starts filling it
  the day a release adds it. Nothing to re-install, nothing to re-generate.

**Repair `$JOB`** is enabled only when at least one project actually differs,
and it touches only those — a project already on the right folder is listed and
left alone, so running it twice rewrites nothing the second time. It offers the
same **Dry run** as the transfer, and the same backup before saving. A project
the scan couldn't read is never repaired: its `$JOB` is *unknown*, not wrong.

**Refresh assets** is the odd one out, and deliberately so. A `.hip` stores the
DazToHue asset definitions it was built with, so switching your installed
DazToHue release leaves every project you already have on the old ones —
DazToHue's own answer to that is the **Refresh Assets** tool on its shelf. This
button runs *that tool*, on every project the scan could open, without you
opening each one in Houdini.

Three things it does **not** do, because it can't:

- **It isn't a check.** Nothing in a project says which DazToHue release its
  assets came from, so nothing can tell you a project needs this. It is always
  on offer and never counted among the three checks above — you run it when you
  know you changed DazToHue.
- **It can't preview.** The studio runs DazToHue's tool rather than doing the
  refresh itself, so it has no idea in advance what will change. The **Dry run**
  still opens each project and runs the tool — it simply never saves the file.
  That is a weaker promise than the other dry runs' *nothing was written*, and
  the dialog says so.
- **It won't tell you it worked.** The report names the shelf tool that ran and
  whether the scene came back *modified* — nothing more, because nothing more
  was observed. A project that reports no change is left alone rather than
  re-saved.

If the tool isn't found, the report names the DazToHue shelf tools that *were*
there. hython reads the shelves from the Houdini **documents folder** in
Settings, so that list is usually the fastest way to see that DazToHue isn't
installed for the Houdini version the studio is pointed at.

### Scanning

Like Generate project, this runs Houdini's `hython`, so it needs the **Houdini
installation folder** and its matching documents folder in Settings. The drawer
scans when it opens, after a run, and when you press **Rescan** — but a project
is only re-read when its file changed since the last look, so coming back to
projects nobody touched costs nothing. Reading a `.hip` the first time takes a
few seconds; a transfer rewrites its targets, so exactly those are read again
and their neighbours aren't. One scan serves all three tabs — the `$JOB` and
`$HIP` values are read in the same pass as the nodes — so switching between
General, Material and Skeleton is instant.

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
