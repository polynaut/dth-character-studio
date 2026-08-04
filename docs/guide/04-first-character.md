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
  Original**, and — for the saved
  [ROM animation](./05-rom-in-daz.md#direct-export-optional-recommended) —
  **Open ROM Animation** when a current one exists, or **Open and Generate ROM
  Animation**, which builds it in Daz and opens the result (Ctrl forces a
  rebuild; Alt+click reveals the folder). A running Daz Studio opens the scene
  right away (handed over via the bundled
  [Runner plugin](./02-setup.md#install-the-dth-character-studio-runner-plugin)),
  otherwise Daz is started with it.
- **Houdini projects** — drop `.hip`/`.hiplc` files to link the character's
  Houdini project(s), or let
  [**Generate project**](./06-into-houdini.md#generate-the-houdini-project-automatically)
  build one. Click a card to open it in Houdini, **Alt+click** to reveal its
  folder.

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
lands. It's fixed and read-only: `dth-exports` inside the character's Daz
folder, created with the character. A Houdini project reaches those files
through a shortcut rather than containing them — see
[where the Houdini project fits](./05-rom-in-daz.md#where-the-houdini-project-fits).

<details>
<summary><strong>Add morphs on frame 0</strong></summary>
<table><tr><td>

Morphs dialed once at **frame 0** of the ROM, on *every* node that carries
them — the figure and every fitted item. One row like a clothing **Expand All**
reaches whichever outfit pieces the open scene wears, and a scene without the
morph simply skips it. Overridable
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
  value**.
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

<details>
<summary><strong>Import from existing Daz scene</strong></summary>
<table><tr><td>

Run the bundled **`Scan_Frames`** script in Daz Studio
(`Scripts › DTH-Character-Studio`): it scans the open scene — every keyed morph
frame — and writes a CSV. That CSV shows up in the **Import from CSV** picker
automatically, one per scene name; **Browse** still takes any CSV you curated
yourself.

</td></tr></table>
</details>

Each pose row has two name fields with very different jobs:

- **Name** — *your* name for the generated morph; it travels to **Houdini**
  and later **Unreal Engine**. Letters, numbers and underscores **only** —
  Houdini rejects anything else. The group's Left/Right suffix is appended
  automatically.
- **Parameter name** — must **exactly match the parameter's internal name in
  Daz Studio** (not its display label), or that frame fails in the ROM run.

A pose row can also drive its one output from **several Daz morphs at once** —
expand its **morphs** toggle.

<p align="center">
  <img width="900" alt="Expanded pose rows: a single-morph row, and rows combining several morphs into one output" src="screenshots/combine-morphs.png" />
  <br>
  <sub><em>Expanded pose rows — a plain single-morph row on top, and two rows combining several morphs into one output below.</em></sub>
</p>

Every entry in that expanded list carries its own:

- **Node** — the scene node the morph lives on (`Genesis9`, `GoldenPalace_G9`,
  a bone, …); autocomplete fills it in when you pick a suggestion.
- **Parameter name** — the morph's internal Daz name (same rule as the main
  row's Parameter name).
- **Value** — what this morph is dialed to at the pose's frame.
- **Base** *(optional)* — the value the morph **returns to** on the frames
  around the pose (default `0`). Set it for a morph that's part of the
  character's base shape, so the ROM keys the *delta* instead of snapping the
  morph up from zero.
- **Auto** — instead of a fixed **Base**, read the base from the morph's
  **current scene value** when the script runs — for resting values that
  differ per character.

<details>
<summary><strong>Combining several morphs into one output — why you'd do it</strong></summary>
<table><tr><td>

Combining bakes a shape that only exists as a combination of dials — or a
controller plus its corrective — into a single clean morph for Houdini and
Unreal: all the listed morphs are keyed together on that one frame and blend
into the output named in **Name**. **Add morph** adds more; the trash icon
removes one (a pose always keeps at least one).

</td></tr></table>
</details>

<details>
<summary><strong>Bone scale — morphs that scale bones (reference skeletons)</strong></summary>
<table><tr><td>

Some morphs also **scale bones** (Torso Length, Proportion Height, and the
like). Generated morphs can only move vertices, and Daz's FBX export doesn't
carry bone scales — the body would reshape while the skeleton stays put. Such
frames need a **reference-skeleton FBX**: an export carrying the morph *and*
its bone scale, which the Houdini PoseAsset points at for that frame (its
*Reference FBX File* input).

Tick **Bone scale** on the pose row and the studio handles that end to end:
the frame is handed to the **DTH Exporter Plugin**, which writes the FBX into
a `Reference Skeletons` subfolder of your export directory, and the PoseAsset
CSV gets that FBX's absolute path filled in — Houdini finds it with nothing to
type.

<p align="center">
  <img width="900" alt="the Bone scale toggle on a pose row" src="screenshots/character-bone-scale-toggle.png" />
  <br>
  <sub><em>Tick Bone scale on a bone-scaling morph — its reference-skeleton FBX is exported and referenced for you.</em></sub>
</p>

&nbsp;

> [!NOTE]
> **Bone scale only acts when the export actually runs** — that's when the
> studio drives the exporter. Turn *Run the export with the ROM script* off (and
> don't run the split `Export_…` script) and the studio generates the ROM only,
> so a ticked Bone scale is simply a no-op — you export the reference skeletons
> yourself. Turn the export back on and it becomes live, no re-ticking needed.

Only **GEN** and **FBM** poses can be reference frames — the two categories
DazToHue supports reference skeletons in. DTH's own
[Guide To Creating Custom ROMs](https://docs.google.com/document/d/1e8B9uDSmiS-v5si0YLEnnAhcnhnfGl9m0RsgCE5EDWA/edit?tab=t.0)
describes the feature in depth.

</td></tr></table>
</details>

<details>
<summary><strong>Section &amp; group tools — suffixes, mirroring, reordering, inserting</strong></summary>
<table><tr><td>

Each section header has its **Enable** switch and **Mode** (Preset / Custom)
select. In Preset mode you can **pick the exact DTH release asset** (when
several match); a red **no G9 asset** chip (naming the character's generation)
appears when the active release ships nothing for it. The **JCM** section's Custom mode
takes a **path to your own pose preset** (`.duf`), loaded as the base ROM
exactly like a DTH asset.

Grouped sections carry per-group settings in their header:

- **driver bone(s)** — the bones driving the group's poses (JCM/GEN/PHY).
- **Generation / Calculate from / Suffix** — how Houdini computes the group's
  morphs (Default / Individual / Additive / Cumulative / Advanced Additive),
  what deltas are measured against (Rest Pose / Animation Frame), and the side
  suffix (Left / Centre / Right → `_l` / `_r` appended automatically).
- **Mirror right** — on a *Left* group, appends a mirrored right-side copy of
  the whole group in one click.
- The **frame chip** shows the group's computed range live (`frames 104–107`).

Inside a group: **drag rows** to reorder (frames simply renumber — they're
never stored), and the small **+** next to a frame number inserts an empty pose
before or after it.

</td></tr></table>
</details>

### Finding a morph's internal Daz name

The **Parameter name** the studio asks for is the parameter's internal name,
which usually differs from the slider's label (label *Body Tone* → internal
`body_bs_BodyTone`). The comfortable way is the studio's **autocomplete** —
one unattended scan (**Tools → Scan & index**) covers every generation, and
from then on each Parameter name field suggests matches as you type. The
manual route via *Parameter Settings* (right screenshot) still works for a
single name.

<p align="center">
  <img width="440" align="top" alt="A morph's internal Daz name" src="https://github.com/user-attachments/assets/9ca14a2a-f871-4a10-80dc-7713942dac49" />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<img width="355" align="top" alt="Looking up a morph's internal name in Daz" src="https://github.com/user-attachments/assets/703690ca-78a1-4a45-9c9a-c7d91be49a86" />
  <br>
  <sub><em>Left: a morph's internal name differs from its slider label. Right: the manual route via Parameter Settings.</em></sub>
</p>

<details>
<summary><strong>Recommended: scan once, then autocomplete</strong> — <code>Tools → Scan &amp; index</code></summary>
<table><tr><td>

The index behind the autocomplete is something the studio builds **for you**
— there is no script to hunt down: open
[**Tools → Scan & index → Scan project**](./tools.md#tab-1--scan-amp-index),
tick what you want and press **Start scan**. The studio hands Daz Studio one
batch and works through it unattended, reporting progress on the button.

- **Base morphs** builds each generation's stock figures and indexes both
  halves the studio autocompletes from — the **morphs** (everything dialable:
  classic morphs *and* controller dials, across every product installed for
  that generation) and the **skeleton** (every bone) — so it feeds the
  **Parameter name** fields *and* the bone field of
  [Modify JCM frames](./advanced.md#modify-jcm-frames). It covers *Genesis 3*,
  *8* and *8.1* female **and** male, and *Genesis 9* twice: it's
  gender-neutral, so that pair is differentiated by geograft instead
  (**Golden Palace** on one, **Dicktator** on the other, when you have them
  installed). Installed new morph products later? Just scan again — the
  studio picks the fresh index up by itself the next time its window gains
  focus.
- **Character morphs** opens every linked Daz scene and indexes the dials the
  base index *doesn't* have — fitted clothing, hair, third-party geografts
  and add-ons. Each find is filed under the scene it was found in and only
  suggested while that scene is selected in the editor, so two jackets in two
  scenes stop competing for the same *Expand All*.

From then on, every **Parameter name** field autocompletes after two typed
characters — searchable by **internal name** *or* **Daz UI label** — and
picking a suggestion fills in the exact internal name **and** the right node:
no more mismatched node/morph pairs.

  <p align="center">
    <img width="508" alt="Parameter name autocomplete suggestions" src="screenshots/detail-morph-autocomplete.png" />
    <br>
    <sub><em>Each Parameter name field autocompletes from the scanned index.</em></sub>
  </p>

**Manual execution — the same build as a Daz script.** The runtime
installation also puts the base build into your Daz library as a visible
script — `Scripts/DTH-Character-Studio/Build_Genesis_Index.dsa`. It is
exactly what the scan batch runs for you, so running it by hand isn't the
way to go anymore; it stays useful for one thing — **indexing a scene that
isn't linked to any character**. **Save your open scene first** (the stock
build clears it), then run the script from the Content Library:

   <p align="center">
     <img width="564" alt="Build_Genesis_Index in the Daz Content Library" src="https://github.com/user-attachments/assets/b0ad36d5-7983-4632-b842-3df0b6a8e531" />
     <br>
     <sub><em>Manual execution: the index script in Daz's Content Library, under Scripts/DTH-Character-Studio.</em></sub>
   </p>

Run by hand it behaves exactly like the batch — it confirms which generations
it found installed, builds the stock figures one generation at a time,
finishes on an **empty scene**, and a summary reports what was indexed per
generation, which geograft file it picked, and anything it couldn't find — so
a missing product, or an unexpected pick after a product update, is never
silent. With figures **already loaded** it offers to **scan the open scene**
instead of building fresh ones (that path never touches your scene — it's
only the *build* that clears), and if that scene is saved it asks how to file
the finds: **For this scene** (suggested only while that scene is selected —
what the *Character morphs* pass does for linked scenes) or **into the base
index** (suggested everywhere — for a figure or geograft the stock build
genuinely doesn't cover).

   <p align="center">
     <img width="508" alt="Build_Genesis_Index run summary dialog" src="https://github.com/user-attachments/assets/7dd80317-3cbc-4a3e-b33d-ae398e81882c" />
     <br>
     <sub><em>The run summary: morphs and bones indexed per generation, and the geograft file each pick settled on.</em></sub>
   </p>

</td></tr></table>
</details>

## Save = generate

Press **Save**. Every save regenerates the character's files in one go:

- **`ROM_<Name>_G9.dsa`** — the Daz apply-script, installed straight into your
  Daz library under `Scripts/DTH-Character-Studio/<Project>/<Character>/`
- **`<Name>_pose_asset.csv`** — the Houdini PoseAsset import CSV, stored in the
  character's folder

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

A **Products** tab appears when the project enables Daz Products — see
[Daz product scanning](./product-scanning.md).

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
<summary><strong>Deleting a character</strong></summary>
<table><tr><td>

**Operations → Delete** removes the character's folder and generated files,
with a confirmation that lets you **keep the Daz files folder** (your scenes
*and* their `dth-exports`) and **keep the Houdini files folder** (your `.hip`
projects — offered only when the character has one) — for when the assets
should outlive the definition. This can't be undone.

</td></tr></table>
</details>

&nbsp;

[← Your first project](./03-first-project.md) · [Next: Build the ROM in Daz →](./05-rom-in-daz.md)
