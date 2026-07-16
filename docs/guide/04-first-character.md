# 4 · Your first character

## Create it

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="project window, create character panel" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Add character panel in the project window.</em></sub>
</p>
-->

1. In the project window press **Add character** (or drop a `.duf` anywhere).   
3. **Choose Daz scene…** — the character's scene file.
   **It must not contain an animation** — just the character itself.
4. Name it (the name becomes its folder in the project), confirm **Genesis** (G9)
   and **Gender**.
5. **ROM prefill** — start **Empty** for a first character, or prefill from any
   of your own characters (across projects) to copy a working ROM definition.

  <p align="center">
    <img width="722" alt="Character details and ROM prefill" src="https://github.com/user-attachments/assets/3446cc99-9884-416a-88b0-e6e6f7cc8368" />
    <br>
    <sub><em>Set Genesis, gender, and the ROM prefill for the new character.</em></sub>
  </p>
   
6. Press **Create**. The scene is copied into the character's folder — your
   original stays where it is.

   <p align="center">
     <img width="1014" alt="The new character's page" src="https://github.com/user-attachments/assets/9e6b850e-9725-4f5c-9e18-64ee797ce18b" />
     <br>
     <sub><em>After Create, the scene is copied into the character's folder.</em></sub>
   </p>


## The ROM definition

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="character page, ROM sections" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The ROM sections on the character page.</em></sub>
</p>
-->

A ROM is a fixed sequence of eight sections. Each can be **enabled or disabled**,
and runs in **Preset** mode (the DTH release's stock pose assets) or **Custom**
mode (your own poses and morphs):

| Section | What it covers |
|---|---|
| RET | Retargeting poses |
| JCM | Joint corrective morphs |
| FAC | FACS / face poses |
| EXP | Expressions |
| GEN | Genitalia (Golden Palace / Dicktator presets) |
| PHY | Physics |
| FBM | Full-body morphs — where your character's custom morphs go |
| MISC | Everything else |

&nbsp;

> [!NOTE]
> The studio computes every frame number from this structure — you never type a
> frame, and the Daz and Houdini outputs can't drift apart.

&nbsp;

<p align="center">
  <img width="1014" alt="The ROM's eight fixed sections" src="https://github.com/user-attachments/assets/5e412f4b-d27f-4ac5-9fd7-8abb5f446fe4" />
  <br>
  <sub><em>The ROM's eight sections, each enabled and set to Preset or Custom.</em></sub>
</p>

Above the sections, a colored **timeline bar** maps the whole ROM: one segment per
block (preset and custom), widths proportional to their frame counts — hover a
segment for its exact frame range. It re-renders as you edit, so you always see
where every section lands before anything runs.


<details>
<summary><strong>Golden Palace &amp; Dicktator — the genitalia (GEN) section</strong></summary>
<table><tr><td>

<p align="center">
  <img width="1028" height="449" alt="Screenshot 2026-07-14 115129" src="https://github.com/user-attachments/assets/dc32ca32-ce39-4374-b71d-112329b83013" />
  <br>
  <sub><em>The GEN section's Golden Palace art-direction frames — a morph set per frame.</em></sub>
</p>


**GEN** is the genital geograft's range of motion. You don't choose the product —
the character's **Gender** (set when you created it) decides: a **female**
character uses **Golden Palace**, a **male** character uses **Dicktator**. Our
example is a G9 Female, so her GEN section covers Golden Palace.

Enable GEN on **Preset** and the studio drops the DTH release's stock GP/DK ROM
block into the fixed GEN slot (after EXP, before PHY), frame-aligned like every
other section. But the preset only supplies the *motion* — the **look is yours to
art-direct**. The section lists the block's **Art direction** frames; go through
them and, for each frame, set the morph (or morphs) that give it the shape you
want — node, morph name and value, exactly like any custom morph.

Frames flagged **required — empty in the preset ROM** ship with no shape at all, so
they do nothing until you set a morph there. Ones you leave alone keep the preset
default. Your choices are written to a per-character art-direction JSON that's
stamped onto those frames as the ROM loads.

Two things worth knowing:

- **The geograft has to be fitted to the figure in the character's Daz scene.**
  The preset poses the geograft itself, so if Golden Palace / Dicktator isn't
  loaded and fitted when you build the ROM, those frames fail.
- **Preset only appears where the DTH release ships that asset.** If your release
  carries no Golden Palace / Dicktator content for the character's Genesis
  generation, the studio flags GEN's Preset as unavailable instead of letting you
  generate a block that can't run.

You built your own pose asset for the genital graft? Switch GEN to **Custom** and
use your own asset!

</td></tr></table>
</details>


For this example we add some **Full Body Morphs (FBM)**, switch it to Custom, and list the morphs your
character actually uses (each morph by its Daz property name, with the value to
key) — or import them with **Import from CSV**: run the bundled **`Scan_Frames`**
script in Daz Studio (`Scripts › DTH-Character-Studio`, figure root selected) and
its scan of the open scene — every keyed morph frame — shows up in the import
picker automatically, one CSV per scene. A **Browse** button still takes any CSV
you curated yourself.

Each pose row has two name fields with very different jobs:

- **Name** — *your* name for the generated morph, the one value that travels to
  **Houdini** and later **Unreal Engine**. Letters, numbers and underscores
  **only** — Houdini rejects anything else, and the field flags invalid
  characters. The group's Left/Right suffix is appended automatically.
- **Morph name** — must **exactly match the morph's internal name in Daz
  Studio** (not its display label). A mismatch means that frame fails in the
  ROM run.

<details>
<summary><strong>Combining several morphs into one output</strong></summary>
<table><tr><td>

A pose usually maps one Daz morph to one generated output — but it doesn't have to.
Each row has a **morphs** toggle (it reads *"2 morphs"*, *"3 morphs"*… once you add
more); expand it to drive the **one** output morph from **several** Daz morphs or
controllers at once. That's how you bake a shape that only exists as a combination
of dials — or a controller plus its corrective — into a single clean morph for
Houdini and Unreal.


<p align="center">
  <img width="1030" height="343" alt="Screenshot 2026-07-14 115731" src="https://github.com/user-attachments/assets/339bafa8-5fbf-487a-8cc0-29142629c04b" />
  <br>
  <sub><em>A pose row expanded to drive one output from several morphs.</em></sub>
</p>

Each entry in the expanded list carries its own:

- **Node** — the scene node the morph lives on (`Genesis9`, `GoldenPalace_G9`, a
  bone, …); autocomplete fills it in when you pick a suggestion.
- **Property** — the morph's internal Daz name (same rule as the single Morph name).
- **Value** — what this morph is dialed to at the pose's frame.
- **Base** *(optional)* — the value the morph **returns to** on the frames around
  the pose (default `0`). Set it for a morph that's already part of the character's
  base shape, so the ROM keys the *delta* from that base instead of snapping the
  morph up from zero.
- **Auto** — instead of a fixed **Base**, tick this to read the base from the
  morph's **current scene value** when the apply-script runs — handy when that
  resting value differs from character to character.

All the listed morphs are keyed together on that one frame, so they blend into the
single output named in **Name**. **Add morph** piles on more; the trash icon drops
one (a pose always keeps at least one).

</td></tr></table>
</details>

<details>
<summary><strong>Bone scale — morphs that scale bones (reference skeletons)</strong></summary>
<table><tr><td>

Some morphs don't just push vertices — they **scale bones** (Torso Length,
Proportion Height, and the like). Morphs can only move vertices, and Daz's FBX
export doesn't carry bone scales either — so on its own, the generated morph would
reshape the body while the skeleton stays put. Those frames need a
**reference-skeleton FBX**: an export carrying the morph *and* its bone scale,
which the Houdini PoseAsset points at for that frame (its *Reference FBX File*
input) to correct the skeleton to the pose.

Building that FBX by hand used to be the only way. Now just tick **Bone scale** on
the pose row and the studio handles the rest end to end:

- the frame is handed to the **DTH Exporter Plugin**, which writes its
  reference-skeleton FBX automatically — into a `Reference Skeletons` subfolder of
  your export directory;
- that FBX's path is filled into the PoseAsset CSV for you, resolved to the exact
  absolute location the exporter wrote — so Houdini finds it with nothing to type.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="the Bone scale toggle on a pose row" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>Tick Bone scale on a bone-scaling morph — its reference-skeleton FBX is exported and referenced for you.</em></sub>
</p>
-->

&nbsp;

> [!NOTE]
> Reference frames need an **Export directory** set (see [Build the ROM in
> Daz](./05-rom-in-daz.md)) — that's where the exporter writes the FBX. The studio
> warns you if you tick Bone scale without one.

Only **GEN** and **FBM** poses can be reference frames — the two categories
DazToHue supports reference skeletons in. DTH's own
[Guide To Creating Custom ROMs](https://docs.google.com/document/d/1e8B9uDSmiS-v5si0YLEnnAhcnhnfGl9m0RsgCE5EDWA/edit?tab=t.0)
describes the feature in depth — including the manual memorize/restore workflow
the studio replaces.

</td></tr></table>
</details>

<details>
<summary><strong>Section &amp; group tools — suffixes, mirroring, reordering, inserting</strong></summary>
<table><tr><td>

Each section header has its **Enable** switch and **Mode** (Preset / Custom)
select. In Preset mode you can **pick the exact DTH release asset** (when several
match); a red **no preset asset** chip appears when the active release ships
nothing for the character's generation. The **JCM** section's Custom mode takes a
**path to your own pose preset** (`.duf`), loaded as the base ROM exactly like a
DTH asset.

Grouped sections carry per-group settings in their header:

- **driver bone(s)** — the bones driving the group's poses (JCM/GEN/PHY).
- **Generation / Calculate from / Suffix** — how Houdini computes the group's
  morphs (Default / Individual / Additive / Cumulative / Advanced Additive), what
  deltas are measured against (Rest Pose / Animation Frame), and the side suffix
  (Left / Centre / Right → `_l` / `_r` appended automatically).
- **Mirror right** — on a *Left* group, appends a mirrored right-side copy of the
  whole group in one click.
- The **frame chip** shows the group's computed range live (`frames 104–107`).

Inside a group: **drag rows** to reorder (frames simply renumber — they're never
stored), and the small **+** next to a frame number inserts an empty pose
before or after it.

</td></tr></table>
</details>

### Finding a morph's internal Daz name

The internal name usually differs from the slider's label (label *Body Tone* →
internal `body_bs_BodyTone`). The comfortable way is to let the studio
**autocomplete** them for you — after a one-time scan per Genesis generation,
every Morph name field offers matching suggestions as you type. Two manual
routes still work when you just need a single name.


<p align="center">
  <img width="504" alt="A morph's internal Daz name" src="https://github.com/user-attachments/assets/9ca14a2a-f871-4a10-80dc-7713942dac49" />
  <br>
  <sub><em>A morph's internal name differs from its slider label.</em></sub>
</p>

<p align="center">
  <img width="404" alt="Looking up a morph's internal name in Daz" src="https://github.com/user-attachments/assets/703690ca-78a1-4a45-9c9a-c7d91be49a86" />
  <br>
  <sub><em>A manual route to a morph's internal Daz name.</em></sub>
</p>

<details>
<summary><strong>Recommended: scan your morphs once, then autocomplete</strong> — <code>Scan_Morphs_&lt;Genesis&gt;.dsa</code></summary>
<table><tr><td>

The runtime installation (see [Tools](./tools.md)) puts four visible scan
scripts into your Daz library at `Scripts/DTH-Character-Studio/`:

- `Scan_Morphs_G9.dsa`
- `Scan_Morphs_G8.1.dsa`
- `Scan_Morphs_G8.dsa`
- `Scan_Morphs_G3.dsa`

Run the one matching your generation, once per generation:

1. In Daz Studio, load a **freshly created, unrenamed** figure of that
   generation (e.g. plain *Genesis 9*) — plus anything whose morphs you want
   indexed: geografts like Golden Palace / Dicktator, add-ons, fitted
   clothing. The scan covers the selected figure **and every node fitted to
   it**.
2. Select the figure root and run the scan script from the Content Library
   (`Scripts/DTH-Character-Studio/Scan_Morphs_<Genesis>`).

  <p align="center">
    <img width="960" alt="Running the scan script in Daz" src="https://github.com/user-attachments/assets/1b381f07-38ae-46f2-8e84-d19e9ff65e1d" />
    <br>
    <sub><em>Select the figure root and run the scan script.</em></sub>
  </p>
  
3. A summary tells you how many morphs were found across how many nodes.

  <p align="center">
    <img width="342" alt="Scan summary" src="https://github.com/user-attachments/assets/55fba5d5-75ba-4576-b201-f4ea55178f84" />
    <br>
    <sub><em>The scan reports how many morphs were found across how many nodes.</em></sub>
  </p>

That's the whole scan — it indexes **everything dialable** the figure carries:
classic morphs *and* controller dials, across all products installed for that
generation. The studio picks the index up automatically — switch back to the
studio window and it's live. Run the scan once per Genesis generation you work
with, each on a figure of that generation loaded in the scene.

From then on, every **Morph name** field autocompletes after two typed
characters:

- search by the **internal name** *or* the **Daz UI label** — each suggestion
  shows both, tags which one matched, and names the node the morph lives on;
- picking a suggestion fills in the exact internal name **and** selects the
  right node on that ROM entry — no more mismatched node/morph pairs.

  <p align="center">
    <img width="638" alt="Morph name autocomplete suggestions" src="https://github.com/user-attachments/assets/3b5916c2-c664-4cb2-a6e1-68b5930264e8" />
    <br>
    <sub><em>Each Morph name field autocompletes from the scanned index.</em></sub>
  </p>

Installed new morph products since the last scan? Just run the scan script
again — the index is replaced wholesale, and the studio refreshes it the next
time its window gains focus.

</td></tr></table>
</details>

## Save = generate

Press **Save**. Every save regenerates the character's files in one go:

- **`ROM_<Name>_G9.dsa`** — the Daz apply-script, installed straight into your
  Daz library under `Scripts/DTH-Character-Studio/<Project>/<Character>/`
- **`<Name>_pose_asset.csv`** — the Houdini PoseAsset import CSV, stored in the
  character's folder

&nbsp;

> [!TIP]
> Change anything later — morphs, sections, export options — and simply Save again;
> both sides stay in sync by construction.

## The rest of the character page

Everything above covered the ROM. The page around it, box by box:

<details>
<summary><strong>The header — avatar, rename, path chip, Save/Discard</strong></summary>
<table><tr><td>

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="character page header" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The character page's header: avatar, name, path chip, Save/Discard.</em></sub>
</p>
-->

- **Avatar** — click the portrait to open the **Character image** dialog: pick one
  of the linked Daz scenes' thumbnails, drop an image file, or paste an image URL.
  Applied **immediately** (no Save needed); stored in the project's hidden
  `.dcsmeta/images` folder, so it travels with the project.
- **Name** — click it to rename the character. The character folder, notes and
  generated scripts follow the new name (the old `ROM_…` script is cleaned up).
- **Subtitle** — the generation, the **skinning** the ROM targets (DQS or Linear,
  derived from the chosen preset assets), and the count of custom ROM frames.
- **Path chip** — where the definition lives on disk. Click **copies** the path,
  **Alt+click reveals it in Explorer** — this works on every path chip in the app.
- **Save / Discard** — the page edits a **draft**: nothing touches disk until
  **Save** (which also regenerates, see above). **Discard** reverts to the last
  save; leaving with unsaved edits asks first. (Holding **Ctrl** turns a settled
  Save button into **Re-save** — force-rewrites the files when nothing changed.)

</td></tr></table>
</details>

<details>
<summary><strong>Notes — and the Products tab</strong></summary>
<table><tr><td>

The **Notes** tab holds freeform **markdown notes** for this character:
background, art direction, references. The rendered view is the default; hover
and hit the pencil to edit, **drop images or files straight into the editor**,
and it autosaves. Stored as `<Name>.notes.md` next to the definition (media in
`.dcsmeta/media`), so notes are part of your project backup. The project page
has the same tab for project-wide notes.

A **Products** tab appears when the project enables Daz Products — see
[Daz product scanning](./product-scanning.md).

</td></tr></table>
</details>

<details>
<summary><strong>The run report</strong></summary>
<table><tr><td>

After a ROM run in Daz had problems (a missing morph, a failed preset), a
**report banner** appears the moment you switch back to the studio: every failed
frame with its reason. Clicking an entry **jumps to and highlights the pose row**
(failed rows are also tinted red in the tables). **Dismiss** clears it; a clean
run clears it automatically.

</td></tr></table>
</details>

<details>
<summary><strong>Genesis &amp; Gender</strong></summary>
<table><tr><td>

The **Genesis** and **Gender** selects can be changed after creation — gender is
what decides the GEN section's product (Golden Palace vs Dicktator, see above).
All four generations are selectable; the deeply validated path is **G9** (and
G8.1 on the old pipeline) — for the others, DTH ships a subset of pose assets and
the studio offers whatever the active release actually provides.

</td></tr></table>
</details>

<details>
<summary><strong>The Genesis 9 specific box</strong></summary>
<table><tr><td>

G9 characters get a **Genesis 9 specific** box next to the Genesis/Gender fields:

- **Set UE5 tear UV** — a toggle. When on, the generated ROM script switches the
  **Genesis 9 Tear** figure's shader **UV Set** to **UE5** during the build — so
  DTH's **Lacrimal Fluid** material lines up without you doing the manual
  *Surfaces ▸ Genesis 9 Tear shader ▸ UV Set ▸ UE5* step every time. It only
  matters if you use that material, and an example UE5 tear UV only ships for
  Genesis 9 — so it's off by default and absent on other generations.
- **FACS detail strength / Flexion strength** — the G9 strength dials
  (**FACS Detail Strength** and **Flexion Automatic Strength**), applied at
  frame 0 as the ROM builds. Daz-style percentages (0–100 %), like every morph
  value in the studio. Leave them at `100 %` unless your character needs the
  stock correctives dialed up or down.

</td></tr></table>
</details>

<details>
<summary><strong>Linked files — Daz scenes &amp; Houdini projects</strong></summary>
<table><tr><td>

- **Daz scenes** — the character's scene, plus any number of extra scenes
  (outfit/look variants): **drop a `.duf`** on the card to add one; a dialog asks
  whether to **copy it into the character's folder** (optionally under a
  subfolder) or leave it where it is. The original scene can't be unlinked;
  extras can be removed. **Scenes subfolder** moves the whole scenes folder. Each
  scene has **Open in Daz** — if Daz Studio is already running with a scene
  loaded, the studio walks you through closing it and the button flips to
  **Open now** once Daz has quit.
- **Houdini projects** — drop `.hip`/`.hiplc` files to link the character's
  Houdini project(s). Click one to open it in Houdini, **Alt+click** to reveal
  its folder.

</td></tr></table>
</details>

<details>
<summary><strong>Script install location &amp; export directory</strong></summary>
<table><tr><td>

The **Daz scripts generated** box shows where the generated `ROM_…` (and, with
split export, `Export_…`) scripts install on Save:
`<My DAZ 3D Library>/Scripts/DTH-Character-Studio/<project>/<character>/` — needs
"My DAZ 3D Library" set in [Settings](./02-setup.md); the folder is created the
first time a script is generated.

The **Export directory** section drives [direct export](./05-rom-in-daz.md):
**Choose folder…** opens the picker (starting at the character's Houdini folder
as guidance), **Clear** turns direct export off again, and an amber warning
appears when poses are flagged **Bone scale** but no export directory is set —
their reference-skeleton FBX needs the exporter.

</td></tr></table>
</details>

<details>
<summary><strong>Deleting a character</strong></summary>
<table><tr><td>

**Operations → Delete** removes the character's folder and generated files, with
a confirmation that lets you **keep the Daz files folder** (your scenes) and
**keep the Houdini files folder** (your exports) — for when the assets should
outlive the definition. This can't be undone.

</td></tr></table>
</details>

&nbsp;

[← Your first project](./03-first-project.md) · [Next: Build the ROM in Daz →](./05-rom-in-daz.md)
