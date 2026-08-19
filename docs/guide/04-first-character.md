# 4 · Your first character

## Create it

<p align="center">
  <img width="900" alt="project window, create character panel" src="screenshots/character-create-panel.png" />
  <br>
  <sub><em>The Add character panel in the project window.</em></sub>
</p>

1. In the project window press **Add character** (or drop a `.duf` anywhere).
2. **Choose Daz scene…** — pick the character's scene file. The studio reads it,
   fills in **Genesis** and **Gender**, and checks that the scene holds exactly
   **one character** with an **empty animation timeline**. *Create anyway*
   overrides a failed check — except a scene already belonging to another
   character of the project, which is refused outright.
3. Name it — the name becomes its folder in the project.
4. **Fill from character** *(optional)* — copy a working ROM definition from any
   existing character across your projects.
5. Press **Copy & Create** — the scene is copied into the character's folder and
   your original stays put (a toggle turns the copy into a move). **Link &
   Create** leaves it where it is; a scene already inside the project shows a
   plain **Create**.

> [!TIP]
> **No scene yet?** Press **Create without scene** — the character's folder is
> created for you (including `daz3d/primary`), so you can save your new scene
> there straight from Daz Studio. The page stays **locked** until you link that
> scene as the primary.

## Character settings

<p align="center">
  <img width="900" alt="character page top — primary Daz scene, hair items, Genesis 9 dials, derived Gender, linked Houdini project" src="screenshots/character-settings.png" />
  <br>
  <sub><em>The top of the character page: the primary Daz scene, hair items, the Genesis 9 dials, the derived Gender, and the linked Houdini project.</em></sub>
</p>

**Genesis** and **Gender** are set at creation; Gender never changes. On the
gender-neutral G9 it comes from the **GP/DK geograft** — Golden Palace → female,
Dicktator → male — the same detection that drives the
[GEN section](#golden-palace--dicktator--the-genitalia-gen-section). All four
generations are selectable; **G9** is the deeply validated path.

Three Genesis 9 dials sit under the hair items (greyed out on other generations):

- **Set UE5 tear UV** — switches the **Genesis 9 Tear** figure's UV Set to **UE5**
  during the build, so DTH's **Lacrimal Fluid** material lines up without the
  manual Surfaces step. Off by default.
- **FACS detail strength / Flexion strength** — the G9 dials *FACS Detail
  Strength* and *Flexion Automatic Strength*, applied at frame 0. Leave at
  `100 %` unless the stock correctives need dialing.

<details>
<summary><strong>Linked files — Daz scenes &amp; Houdini projects</strong></summary>
<table><tr><td>

- **Daz scenes** — the primary plus any number of outfit/look variants: **drop a
  `.duf`** on the card to add one. Added scenes pass the same checks as at
  creation, plus the **same GP/DK geograft as the primary**. The primary can't be
  unlinked; extras can. Each scene's open icon is a menu: **Open scene**, **Open
  last ROM** once a
  [ROM animation](./05-rom-in-daz.md#what-a-run-exports) is saved,
  and **Generate new ROM** when there is none or the saved one is stale.
- **Houdini projects** — drop `.hip`/`.hiplc` files to link them, or let
  [**Generate project**](./06-into-houdini.md#generate-the-houdini-project-automatically)
  build one. Click a card to open it in Houdini, **Alt+click** to reveal its
  folder, **click its name to rename it** (the file on disk follows; in-folder
  projects only). A `.hip` from **outside** the character folder asks **Copy in**
  or **Link in place** — see
  [project checks](./06-into-houdini.md#project-checks--what-the-card-warns-about)
  for what a copied project needs afterwards.
- **Saved something new?** Save a `.duf` or `.hip` anywhere into the character's
  folder, tab back, and a banner offers to **Review** the new files — one wizard
  page per file, running the same checks as adding by hand.

</td></tr></table>
</details>

> [!TIP]
> **Hair items** and everything else around **multiple Daz scenes on one
> character** — outfit variants, the selected scene, per-scene overrides — are in
> [Advanced: Multiple Daz scenes](./advanced.md#multiple-daz-scenes--outfits-amp-hair-variants).

## Script install location & export directory

The **Daz scripts generated** box shows where the generated `ROM_…` (and, with
split export, `Export_…`) scripts install on Save:
`<My DAZ 3D Library>/Scripts/DTH-Character-Studio/<project>/<character>/`. It also
holds the two **export switches**, detailed in
[Working with the scripts alone](./05-rom-in-daz.md#working-with-the-scripts-alone).

<p align="center">
  <img width="900" alt="the Daz scripts generated box — install location, the export switches and the Export directory" src="screenshots/character-scripts-section.png" />
  <br>
  <sub><em>The Daz scripts generated box: the install location, the two export switches and the Export directory.</em></sub>
</p>

**Export directory**, at the bottom of the same box, shows where
[the export](./05-rom-in-daz.md#what-a-run-exports) lands.
It's fixed and read-only: `daz-export` inside the character's Houdini folder, next
to the `.hip` that reads it — see
[where the Houdini project fits](./05-rom-in-daz.md#where-the-houdini-project-fits).

<details>
<summary><strong>Advanced options</strong></summary>
<table><tr><td>

<p align="center">
  <img width="900" alt="character page, Advanced options panel expanded" src="screenshots/character-advanced-options.png" />
  <br>
  <sub><em>The Advanced options section on the character page.</em></sub>
</p>

Not needed for a working ROM:

- **Morphs set at frame 0** — dialed once at **frame 0** of the ROM. With no item
  scope — the labels under the field reading **All items** — a row lands on
  *every* node carrying the morph, so a clothing **Expand All** reaches whichever
  outfit pieces the open scene wears. Picking a suggestion instead scopes the row
  to the item its dial lives on (✕ returns it to every item), which is what a fit
  value meant for one item needs. A scene without the morph — or the item — skips
  it.
- **Preserve node transforms** — the listed node's transform is memorized before
  the ROM loads and restored after, so posed nodes (the eyes, say) keep their
  orientation. Enter the **node's label** as it appears in Daz.

Both lists are [overridable per scene](./advanced.md#per-scene-overrides--edit-to-override).

> Morph values no longer need a list of their own: current DazToHue releases hold
> them across the ROM load by themselves, so the old *Preserve morphs after ROM
> loading* field is gone.

</td></tr></table>
</details>

## The ROM definition

<p align="center">
  <img width="900" alt="character page, ROM sections" src="screenshots/character-rom-sections.png" />
  <br>
  <sub><em>The ROM sections on the character page.</em></sub>
</p>

A ROM is a fixed sequence of eight sections. Each can be **enabled or disabled**
and runs in **Preset** mode (the DTH release's stock pose assets) or **Custom**
mode (your own poses and morphs). Above them a colored **timeline bar** maps the
whole ROM live as you edit — hover a segment for its frame range.

<details>
<summary><strong>Golden Palace &amp; Dicktator — the genitalia (GEN) section</strong></summary>
<table><tr><td>

<p align="center">
  <img width="900" alt="GEN section, Golden Palace art-direction frames" src="screenshots/gen-art-direction.png" />
  <br>
  <sub><em>The GEN section's Golden Palace art-direction frames — a morph set per frame.</em></sub>
</p>

**GEN** is the genital geograft's range of motion. You don't enable it by hand: it
turns itself on when the primary scene contains a Golden Palace / Dicktator
geograft.

In **Preset** mode the studio drops the DTH release's stock GP/DK ROM block into
the fixed GEN slot. The preset supplies the *motion* — the **look is yours**: the
section lists the block's **Art direction** frames, and for each you set the morph
(or morphs) giving it the shape you want. Frames flagged **required — empty in the
preset ROM** do nothing until you set a morph there.

- **The geograft must be fitted to the figure in the Daz scene.**
- **Preset only appears where the DTH release ships that asset.**
- Built your own pose asset for the graft? Switch GEN to **Custom**.

</td></tr></table>
</details>

> [!NOTE]
> The studio computes every frame number from this structure — you never type a
> frame, and the Daz and Houdini outputs can't drift apart.

> [!TIP]
> To learn the ROM process itself, read mrpdean's
> **[DazToHue documentation](https://docs.google.com/document/d/1bRkFg3vo-WRKuu-kpTGig7GEoIfg7fPNVViFQspmPzc/edit?tab=t.g940wfwgh8lb#heading=h.wlvdwavo6j7h)**.

## Custom morphs

For this example, add some **Full Body Morphs (FBM)**: switch the section to
Custom and list the morphs your character should use. Filling in those rows is its
own chapter: **→ [Custom morphs](./custom-morphs.md)**

## Save = generate

Press **Save**. Every save regenerates the character's files:

- **`ROM_<Name>_G9.dsa`** — the Daz apply-script, installed into your Daz library
  under `Scripts/DTH-Character-Studio/<Project>/<Character>/`.
- **`<Name>_pose_asset.csv`** — the Houdini PoseAsset import CSV, kept in the
  project's hidden `.dcsmeta/characters/<Character>/` folder. The export script
  copies it into the export folder when it runs; see
  [Into Houdini](./06-into-houdini.md#what-the-studio-gives-you) to grab it by
  hand.

Two more appear **only when their feature is on**: **`Export_<Name>_G9.dsa`** (when
an Export directory is set *and* *Run the export with the ROM script* is off), and
**`Export_Hair_<Name>_G9.dsa`** (when the character lists
[hair items](./advanced.md#hair-items--per-scene-kept-out-of-the-export)). Each gets
its own **Content Library icon**, so you can tell them apart in Daz.

A character with [per-scene ROM overrides](./advanced.md#rom-overrides) additionally
gets per-scene PoseAsset CSVs — see
[What Save generates](./advanced.md#what-save-generates).

> [!TIP]
> Change anything later and simply Save again — both sides stay in sync.

## The rest of the character page

Everything above covered the ROM. The page around it, box by box — open the one
you need:

<details>
<summary><strong>The header — avatar, rename, path chip, Save/Discard</strong></summary>
<table><tr><td>

<p align="center">
  <img width="900" alt="character page header" src="screenshots/character-header.png" />
  <br>
  <sub><em>The character page's header: avatar, name, path chip, Save/Discard.</em></sub>
</p>

- **Avatar** — click the portrait to use the primary scene's thumbnail, drop an
  image file (cropped square in the built-in editor), or paste a URL. Applied
  immediately; stored in the project's `.dcsmeta/images`. The same dialog has a
  **Vertical offset** slider: Daz frames a figure in its previews by how tall it
  is, so a short or tall character can come out sitting high or low in the
  square. The slider moves that character's picture up or down in *every* avatar
  and scene thumbnail at once, and the dialog previews the result while you
  drag. 0 is the default.
- **Name** — click to rename. The folder, notes and generated scripts follow.
- **Subtitle** — the generation, the **skinning** the ROM targets (DQS or Linear,
  derived from the preset assets), and the custom-frame count.
- **Path chip** — where the definition lives on disk.
- **Save / Discard** — the page edits a **draft**: nothing touches disk until
  **Save** (which also regenerates). **Discard** reverts to the last save.
  **Ctrl** turns a settled Save into **Re-save**, force-rewriting the files.

</td></tr></table>
</details>

<details>
<summary><strong>Notes — and the Products tab</strong></summary>
<table><tr><td>

Freeform **markdown notes** for this character: hover, hit the pencil to edit,
**drop images or files straight into the editor**. It autosaves to
`<Name>.notes.md` beside the definition (media in `.dcsmeta/media`), so notes
travel with your project backup. The project page has the same tab for
project-wide notes.

A **Products** tab appears when the project switches it on — see
[Daz product scanning](./product-scanning.md).

</td></tr></table>
</details>

<details>
<summary><strong>The run report</strong></summary>
<table><tr><td>

After a ROM run in Daz had problems, a **report banner** appears the moment you
switch back: every failed frame with its reason, grouped under the scene it came
from. Clicking an entry **switches to that scene and jumps to the pose row**, and
the failed rows are tinted red in the tables. **Dismiss** clears it; a clean run
clears it automatically.

</td></tr></table>
</details>

<details>
<summary><strong>Filling the ROM from another character</strong></summary>
<table><tr><td>

**Operations → Fill from character** opens the same two-step wizard as at
creation: pick a source character (same generation and gender) from any project,
then check which of its ROM sections to copy. Retargeting always rides with JCM;
the *Modify JCM frames* rules and the preserve list are optional extras. The checked
sections **replace** this character's config in the editor draft; nothing lands on
disk until you save, and GEN keeps its own scene-derived setup.

</td></tr></table>
</details>

<details>
<summary><strong>Export &amp; import — the whole character as one zip</strong></summary>
<table><tr><td>

**Operations → Export** packs the character into a self-contained
`<Name>_<date>.dcsc.zip`: definition, notes, all Daz scenes, all Houdini project
files, avatar and metadata. Two toggles add the regenerable — often
gigabyte-sized — **Daz exports** and **Houdini exports** trees. Save first.

The zip restores in two ways:

- **Onto a character** — its **Operations → Import** button, or dropping the zip
  on its page, opens a wizard pre-selected for a full restore that lets you dial
  it back: the **name**, which **ROM sections**, which **Daz scenes** (the primary
  always; existing scenes are **always wiped**) and which **Houdini projects**.
- **Onto a project** — drop the zip on the project page and it is restored as a
  **new character**.

Every stored path is fixed for the new location — including each Houdini project's
`$JOB`, which needs a paired Houdini install. The `.dsa` scripts and CSV are
regenerated. A scene or `.hip` **linked in place outside** the character folder
keeps its original absolute path. This can't be undone.

</td></tr></table>
</details>

<details>
<summary><strong>Deleting a character</strong></summary>
<table><tr><td>

**Operations → Delete** removes the character's folder and generated files, with a
confirmation that lets you **keep the Daz files folder** (your scenes) and **keep
the Houdini files folder** (your `.hip` projects). Either way `daz-export` goes:
regenerable output, often gigabytes of it. This can't be undone.

</td></tr></table>
</details>

&nbsp;

[← Your first project](./03-first-project.md) · [Next: Build the ROM in Daz →](./05-rom-in-daz.md)
