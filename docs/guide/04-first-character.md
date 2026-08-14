# 4 · Your first character

## Create it

<p align="center">
  <img width="900" alt="project window, create character panel" src="screenshots/character-create-panel.png" />
  <br>
  <sub><em>The Add character panel in the project window.</em></sub>
</p>

1. In the project window press **Add character** (or drop a `.duf` anywhere).
2. **Choose Daz scene…** — pick the character's scene file. The studio reads
   it, fills in **Genesis** and **Gender**, and validates that the scene holds
   exactly **one character** with an **empty animation timeline** (the ROM
   script fills the timeline itself). *Create anyway* overrides a failed check —
   except one: a scene that already belongs to another character of the
   project is refused outright.
3. Name it — the name becomes its folder in the project.
4. **Fill from character** *(optional)* — copies a working ROM definition from
   any existing character across your projects: pick the source and check
   which sections to copy.
5. Press **Copy & Create** — the scene is copied into the character's folder
   and your original stays where it is (the toggle beside it turns the copy
   into a move). **Link & Create** leaves the scene where it is instead; a
   scene already inside the project shows a plain **Create**.

> [!TIP]
> **No scene yet?** Skip step 2 and press **Create without scene** — the
> character's folder (including the primary scene's subfolder, e.g.
> `daz3d/primary`) is created for you, so you can save your new scene there
> straight from Daz Studio. The
> character page stays **locked** until you link that scene as the primary (the
> Daz scenes panel shows the exact folder and the **Link Daz scene** button);
> the first link also derives Gender, Genesis and the Genitalia section from
> the scene, exactly like a normal create.

## Character settings

<p align="center">
  <img width="900" alt="character page top — primary Daz scene, hair items, Genesis 9 dials, derived Gender, linked Houdini project" src="screenshots/character-settings.png" />
  <br>
  <sub><em>The top of the character page: the primary Daz scene, hair items, the Genesis 9 dials, the derived Gender, and the linked Houdini project.</em></sub>
</p>

**Genesis** and **Gender** are set at creation; Gender never changes. On the
gender-neutral G9 it comes from the **GP/DK geograft** — Golden Palace →
female, Dicktator → male — the same detection that drives the
[GEN section](https://polynaut.github.io/dth-character-studio/guide/04-first-character.html#golden-palace--dicktator--the-genitalia-gen-section).
All four generations are selectable, but the deeply validated path is **G9**
(and G8.1 on the old pipeline); for the others, the studio offers whatever
pose assets the active DTH release ships.

The sidebar's three Genesis 9 dials sit under the hair items (on any other
generation they are shown greyed out):

- **Set UE5 tear UV** — the ROM script switches the **Genesis 9 Tear**
  figure's **UV Set** to **UE5** during the build, so DTH's **Lacrimal Fluid**
  material lines up without the manual Surfaces step. Only matters if you use
  that material; off by default, and G9-only.
- **FACS detail strength / Flexion strength** — the G9 dials **FACS Detail
  Strength** and **Flexion Automatic Strength**, applied at frame 0 as the ROM
  builds. Leave them at `100 %` unless the stock correctives need dialing up
  or down.

<details>
<summary><strong>Linked files — Daz scenes &amp; Houdini projects</strong></summary>
<table><tr><td>

- **Daz scenes** — the character's scene, plus any number of extra scenes
  (outfit/look variants): **drop a `.duf`** on the card to add one. Added
  scenes pass the same checks as at creation — plus the **same GP/DK geograft
  as the primary**, so every scene produces the primary's skeleton — and are
  copied into the character's folder or left in place. The original scene
  can't be unlinked; extras can. Each scene's open icon is a menu: **Open
  scene**, and — for the saved
  [ROM animation](./05-rom-in-daz.md#direct-export-optional-recommended) —
  **Open last ROM** whenever one is on disk; its tooltip notes when it predates
  the current definition (it opens anyway; stale is not wrong). **Generate new
  ROM** builds it in Daz and opens the result, and is offered when there is
  none or the saved one is stale (Ctrl offers it for a current one too;
  Alt+click reveals the folder). A running Daz Studio opens the scene
  right away (handed over via the bundled
  [Runner plugin](./02-setup.md#daz-studio-plugins)),
  otherwise Daz is started with it.
- **Houdini projects** — drop `.hip`/`.hiplc` files to link the character's
  Houdini project(s), or let
  [**Generate project**](./06-into-houdini.md#generate-the-houdini-project-automatically)
  build one. Click a card to open it in Houdini, **Alt+click** to reveal its
  folder. Pick a `.hip` that lives **outside** the character folder and the
  studio asks the same question it asks for a Daz scene: **Copy in** — into the
  character's Houdini folder, with *Delete original after copying* if you meant
  to move it — or **Link in place**. One that already sits inside the character
  folder is simply linked; there is nothing to decide. See
  [project checks](./06-into-houdini.md#project-checks--what-the-card-warns-about)
  for what a copied project needs afterwards.
  **Click a card's name to rename it** — the file on disk is renamed with it and
  the link follows, so a generated `3d-workflow_LaraCroft_G81` can just become
  `Lara`. The extension is kept (`.hip` / `.hiplc` / `.hipnc` carry the licence
  tier). Renaming is safe where *moving* is not: everything the studio bakes in
  is anchored on `$JOB` and `$HIP`, which are **folders** — the file's own name
  is the one part of its location nothing points at. Only projects inside the
  character folder are renamable; one you linked in place from your own tree
  stays untouched, so its name has no pencil.
- **Saved something new?** The studio notices by itself: save a `.duf` or a
  Houdini project anywhere into the character's folder, tab back, and a banner
  offers to **Review** the new files — a wizard with one page per file runs the
  same checks as adding by hand, then links each file in place (a character
  without a primary scene gets **Set as primary**). **Skip** ignores a file
  permanently (it can still be added by pick/drop later); the banner's ✕ only
  hides it for the session.
  It does not matter which page you tab back to, either: if the studio is
  showing the project page — or Settings, or Tools — a banner at the top of the
  window names the character whose folder the file landed in and takes you
  there.

</td></tr></table>
</details>

&nbsp;

> [!TIP]
> **Hair items** (per-scene hair kept out of the export) and everything else
> around **multiple Daz scenes on one character** — outfit variants, the selected
> scene, and per-scene overrides (the whole ROM, identity dials, preserve items) — read
> [Advanced: Multiple Daz scenes](https://polynaut.github.io/dth-character-studio/guide/advanced.html#multiple-daz-scenes--outfits-amp-hair-variants).

## Script install location & export directory

The **Daz scripts generated** box shows where the generated `ROM_…` (and, with
split export, `Export_…`) scripts install on Save:
`<My DAZ 3D Library>/Scripts/DTH-Character-Studio/<project>/<character>/`
("My DAZ 3D Library" comes from [Settings](./02-setup.md)). It also holds the
two **export switches** — combined vs split export, and the hair pass —
detailed in [Build the ROM in Daz](./05-rom-in-daz.md#direct-export-optional-recommended).

<p align="center">
  <img width="900" alt="the Daz scripts generated box — install location and the export switches" src="screenshots/character-scripts-section.png" />
  <br>
  <sub><em>The Daz scripts generated box: the install location and the two export switches.</em></sub>
</p>

The **Export directory** section shows where [direct export](./05-rom-in-daz.md#direct-export-optional-recommended)
lands. It's fixed and read-only: `daz-export` inside the character's Houdini
folder, created with the character. Those files exist only to be imported by
Houdini, so they sit next to the `.hip` that reads them (`$HIP/daz-export/…`)
— see [where the Houdini project fits](./05-rom-in-daz.md#where-the-houdini-project-fits).

<details>
<summary><strong>Add morphs on frame 0</strong></summary>
<table><tr><td>

Morphs dialed once at **frame 0** of the ROM. With the **Item** field empty a
row lands on *every* node that carries the morph — the figure and every fitted
item — so one row like a clothing **Expand All** reaches whichever outfit
pieces the open scene wears. Auto-follow puts the same dial on every conformed
item, though, so a fit value meant for one backpack would deform the boots and
gloves too: name the **Item** (picking a suggestion fills it in) to apply the
row on that one node only. A scene without the morph — or the item — simply
skips it. Overridable
[per Daz scene](./advanced.md#per-scene-overrides--edit-to-override).

</td></tr></table>
</details>

<details>
<summary><strong>Advanced options — preserve morphs &amp; node transforms</strong></summary>
<table><tr><td>

<p align="center">
  <img width="900" alt="character page, Advanced options panel expanded" src="screenshots/character-advanced-options.png" />
  <br>
  <sub><em>The Advanced options section on the character page.</em></sub>
</p>

The **Advanced options** panel near the bottom of the character page — none of
it is needed for a working ROM:

- **Preserve morphs after ROM loading** — the ROM zeroes morphs as it loads;
  any morph you list here is restored to the value you set afterwards. Use it
  for body-shaping controls (breast or muscle morphs, say) that should hold
  across the whole ROM. Enter the morph's **property name** and its **hold
  value**; the **Item** field names the scene item the morph lives on (empty =
  the figure itself, and picking a suggestion fills it in — a clothing morph
  needs it, since it never lives on the figure).
- **Preserve node transforms** — the listed node's transform is memorized
  before the ROM loads and restored after, so posed nodes (the eyes, say) keep
  their orientation instead of being reset. Enter the **node's label** as it
  appears in Daz.

On a **non-primary Daz scene** both lists are overridable, so an outfit scene
can preserve different morphs or nodes than the primary — see
[Advanced: per-scene overrides](./advanced.md#per-scene-overrides--edit-to-override).

</td></tr></table>
</details>

## The ROM definition

<p align="center">
  <img width="900" alt="character page, ROM sections" src="screenshots/character-rom-sections.png" />
  <br>
  <sub><em>The ROM sections on the character page.</em></sub>
</p>

A ROM is a fixed sequence of eight sections. Each can be **enabled or
disabled**, and runs in **Preset** mode (the DTH release's stock pose assets)
or **Custom** mode (your own poses and morphs).

Above the sections, a colored **timeline bar** maps the whole ROM live as you
edit — one segment per block, hover for its exact frame range.

<details>
<summary><strong>Golden Palace &amp; Dicktator — the genitalia (GEN) section</strong></summary>
<table><tr><td>

<p align="center">
  <img width="900" alt="GEN section, Golden Palace art-direction frames" src="screenshots/gen-art-direction.png" />
  <br>
  <sub><em>The GEN section's Golden Palace art-direction frames — a morph set per frame.</em></sub>
</p>

**GEN** is the genital geograft's range of motion. You don't enable it by
hand: it turns itself on exactly when the primary scene contains a Golden
Palace / Dicktator geograft (detected when the scene is linked at creation) —
the same graft that derives the character's **Gender**. Our example G9 Female
carries Golden Palace, so her GEN section covers it.

In **Preset** mode the studio drops the DTH release's stock GP/DK ROM block
into the fixed GEN slot (after EXP, before PHY). The preset supplies the
*motion* — the **look is yours**: the section lists the block's **Art
direction** frames, and for each one you set the morph (or morphs) that give
it the shape you want — node, morph name and value, like any custom morph.

Frames flagged **required — empty in the preset ROM** do nothing until you set
a morph there; frames you leave alone keep the preset default.

Two things worth knowing:

- **The geograft must be fitted to the figure in the Daz scene** — the preset
  poses the geograft itself, so those frames fail without it.
- **Preset only appears where the DTH release ships that asset** — otherwise
  the studio flags GEN's Preset as unavailable.

You built your own pose asset for the genital graft? Switch GEN to **Custom**
and use your own asset!

</td></tr></table>
</details>

&nbsp;

> [!NOTE]
> The studio computes every frame number from this structure — you never type a
> frame, and the Daz and Houdini outputs can't drift apart.

> [!TIP]
> Want to learn all about the ROM process itself — what the blocks do and why?
> Read mrpdean's original
> **[DazToHue documentation](https://docs.google.com/document/d/1bRkFg3vo-WRKuu-kpTGig7GEoIfg7fPNVViFQspmPzc/edit?tab=t.g940wfwgh8lb#heading=h.wlvdwavo6j7h)**
> — the learning resource this studio builds on.

## Custom morphs

For this example we add some **Full Body Morphs (FBM)**: switch the section to
Custom and list the morphs your character should use.

Filling in those rows is its own chapter — the two name fields a pose row
carries, combining several Daz morphs into one output, bone-scale reference
frames, the section and group tools, and how to find a morph's internal Daz
name:

**→ [Custom morphs](./custom-morphs.md)**

## Save = generate

Press **Save**. Every save regenerates the character's files in one go:

- **`ROM_<Name>_G9.dsa`** — the Daz apply-script, installed straight into your
  Daz library under `Scripts/DTH-Character-Studio/<Project>/<Character>/`
- **`<Name>_pose_asset.csv`** — the Houdini PoseAsset import CSV. It's kept in
  the project's hidden `.dcsmeta/characters/<Character>/` folder, together with
  the studio's other bookkeeping for that character, so your character folder
  holds only your own files. The export script copies it into the export folder
  when it runs; see [Into Houdini](./06-into-houdini.md#what-the-studio-gives-you)
  for grabbing it by hand.

Two more scripts appear alongside the ROM one **only when their feature is on**:

- **`Export_<Name>_G9.dsa`** — split out only when an **Export directory** is
  set **and** *Run the export with the ROM script* is turned off; otherwise the
  export runs inline at the tail of the ROM script (no separate file).
- **`Export_Hair_<Name>_G9.dsa`** — generated when the character lists
  **[hair items](./advanced.md#hair-items--per-scene-kept-out-of-the-export)**:
  it exports **one `<Name>_Hair_<item>_grooms.abc` per listed hair item** for
  Houdini's **DazToHueGroom Import** node — each item worn, every other
  wearable hidden.

Each of them gets its own **Content Library icon**, so you can tell them apart at
a glance in Daz — the ROM script's icon even says whether the export runs with it
or not. They appear on the next Save (or **Tools → Refresh assets** for
characters you haven't touched since updating).

A character with **[per-scene ROM overrides](./advanced.md#rom-overrides)**
additionally gets per-scene PoseAsset CSVs — see
[Advanced: What Save generates](./advanced.md#what-save-generates).

&nbsp;

> [!TIP]
> Change anything later and simply Save again — both sides stay in sync.

## The rest of the character page

Everything above covered the ROM. The page around it, box by box:

<details>
<summary><strong>The header — avatar, rename, path chip, Save/Discard</strong></summary>
<table><tr><td>

<p align="center">
  <img width="900" alt="character page header" src="screenshots/character-header.png" />
  <br>
  <sub><em>The character page's header: avatar, name, path chip, Save/Discard.</em></sub>
</p>

- **Avatar** — click the portrait to use the **primary** Daz scene's
  thumbnail, drop an image file (cropped square in the built-in editor), or
  paste an image URL; earlier uploads stay one click away. Applied immediately
  (no Save needed); stored in the project's hidden `.dcsmeta/images` folder, so
  it travels with the project.
- **Name** — click it to rename. The character folder, notes and generated
  scripts follow (the old `ROM_…` script is cleaned up).
- **Subtitle** — the generation, the **skinning** the ROM targets (DQS or
  Linear, derived from the chosen preset assets), and the custom-frame count.
- **Path chip** — where the definition lives on disk; click copies, Alt+click
  reveals, like every path chip in the app.
- **Save / Discard** — the page edits a **draft**: nothing touches disk until
  **Save** (which also regenerates, see above). **Discard** reverts to the
  last save; leaving with unsaved edits asks first. **Ctrl** turns a settled
  Save button into **Re-save**, force-rewriting the files when nothing changed.

</td></tr></table>
</details>

<details>
<summary><strong>Notes — and the Products tab</strong></summary>
<table><tr><td>

The **Notes** tab holds freeform **markdown notes** for this character:
background, art direction, references. Hover, hit the pencil to edit, **drop
images or files straight into the editor** — it autosaves. Stored as
`<Name>.notes.md` next to the definition (media in `.dcsmeta/media`), so notes
travel with your project backup. The project page has the same tab for
project-wide notes.

A **Products** tab appears when the project switches it on — the scanning itself
runs regardless. See [Daz product scanning](./product-scanning.md).

</td></tr></table>
</details>

<details>
<summary><strong>The run report</strong></summary>
<table><tr><td>

After a ROM run in Daz had problems (a missing morph, a failed preset), a
**report banner** appears the moment you switch back to the studio: every
failed frame with its reason, grouped under the scene it came from (a batch
keeps *all* scenes' problems). Clicking an entry **switches to that scene and
jumps to the pose row**; the selected scene's failed rows are also tinted red
in the tables. **Dismiss** clears it; a clean run clears it automatically.

</td></tr></table>
</details>

<details>
<summary><strong>Filling the ROM from another character</strong></summary>
<table><tr><td>

**Operations → Fill from character** opens the same two-step wizard as at
creation: pick a source character (same generation and gender) from any of
your projects, then check which of its filled ROM sections to copy
(Retargeting always rides with JCM; the *Modify JCM frames* rules and preserve
lists are optional extras). The checked sections **replace** this character's
current config in the editor draft; nothing lands on disk until you save. GEN
keeps this character's own scene-derived Golden Palace / Dicktator setup.

</td></tr></table>
</details>

<details>
<summary><strong>Export &amp; import — the whole character as one zip</strong></summary>
<table><tr><td>

**Operations → Export** packs the character into a single, self-contained
`<Name>_<date>.dcsc.zip`: the definition, notes, **all Daz scenes**, **all
Houdini project files**, the avatar and the studio's metadata (run log, Execute
stamps, PoseAsset CSVs) are always in it. Two toggles add the regenerable —
and often gigabyte-sized — export trees: **Daz exports** (`houdini/daz-export`,
the Daz→Houdini intermediate) and **Houdini exports** (the final `export`
folder). Confirm, pick a folder, and the zip lands there. Unsaved editor
changes are not packed — Save first.

The zip restores in two ways:

- **Onto a character** — that character's **Operations → Import** button, or
  just drop the zip anywhere on its page. An **import wizard** (in the spirit
  of the Fill dialog) opens with everything pre-selected for a full restore,
  and lets you dial it back: edit the **character name** (pre-filled with the
  zip's), pick which of the zip's **ROM sections** and extras to take
  (unchecked sections keep this character's config — unless the zip is a
  different generation/gender, where the full ROM must come along), pick the
  **Daz scenes** to restore (the primary is always included; the character's
  existing scenes are **always wiped** and replaced), and pick the **Houdini
  projects** — either replacing the character's own or added beside them. The
  character itself persists (same entry, same page); notes, avatar and
  metadata come from the zip when it has them. This can't be undone.
- **Onto a project** — drop the zip anywhere on the project page: the zip's
  character is restored, with *all* of its data, as a **new character** of that
  project.

Import fixes every stored path for the new location: the definition's scene /
Houdini / avatar references, the studio's metadata records, and the Houdini
projects themselves — their `$JOB` is repointed at the new character folder and
their stored references repaired, the same fixes the Utils drawer's *Repair
project settings* + *Make paths portable* run (this needs a paired Houdini
install; without one the import finishes and tells you to run those two later).
The `.dsa`
scripts and PoseAsset CSV are regenerated to match. A scene or `.hip` that was
**linked in place outside** the character folder keeps its original absolute
path — on another machine it shows as missing and is relinked in the editor.

</td></tr></table>
</details>

<details>
<summary><strong>Deleting a character</strong></summary>
<table><tr><td>

**Operations → Delete** removes the character's folder and generated files,
with a confirmation that lets you **keep the Daz files folder** (your scenes)
and **keep the Houdini files folder** (your `.hip` projects — offered only when
the character has one) — for when the assets should outlive the definition.
Either way the `daz-export` folder goes: it's regenerable output, often
gigabytes of it, and keeping your own files must not quietly keep that too.
This can't be undone.

</td></tr></table>
</details>

&nbsp;

[← Your first project](./03-first-project.md) · [Next: Build the ROM in Daz →](./05-rom-in-daz.md)
