# Custom morphs

A ROM section in **Preset** mode runs a DTH release asset as it ships. Switch it
to **Custom** and you list the morphs yourself. This page continues
[Your first character](./04-first-character.md#the-rom-definition).

Each pose row has two name fields with very different jobs:

- **Name** — *your* name for the generated morph; it travels to **Houdini** and
  later **Unreal Engine**. Letters, numbers and underscores **only** — Houdini
  rejects anything else. The group's Left/Right suffix is appended automatically.
- **Parameter name** — must **exactly match the parameter's internal name in Daz
  Studio** (not its display label), or that frame fails in the ROM run.

<details>
<summary><strong>Import from an existing Daz scene</strong></summary>
<table><tr><td>

A section already posed on a Daz timeline doesn't have to be typed in again.
**Import from Daz scene** reads those keyed frames and turns each one into a pose
row. Click it, then **pick a scene** — or drag the `.duf` onto the button. The
scene must hold exactly **one figure**, of the character's **own generation**, with
**animation on the timeline** (the opposite of the check when you *add* a scene). A
failed check blocks the scan and says why, with the usual *"Scan anyway"* escape.

**Start scan** hands the scene to Daz Studio — the same job runner **DTH Export**
uses, so it needs the [Runner plugin](./02-setup.md#daz-studio-plugins). Daz opens
the scene, scans it with no dialogs and clears it again; if Daz wasn't running it is
started **minimized**.

Scans you already made stay listed in the same dialog, newest first — **one scan of
a scene can feed several ROM sections**. **Browse** takes any CSV you curated
yourself, and running **`Scan_Frames`** by hand in Daz lands in the same list.

**An import fixes the names for you.** Daz property labels are prose, so
`Torso Muscular` is imported as `TorsoMuscular`, which reads the same and passes
Houdini's rule. The raw Daz property stays on the morph as the **Parameter name**.
A name **you** type is flagged rather than silently rewritten.

</td></tr></table>
</details>

## Several Daz morphs in one row

A pose row can drive its one output from **several Daz morphs at once** — expand
its **morphs** toggle.

<p align="center">
  <img width="900" alt="Expanded pose rows: a single-morph row, and rows combining several morphs into one output" src="screenshots/combine-morphs.png" />
  <br>
  <sub><em>Expanded pose rows — a plain single-morph row on top, and two rows combining several morphs into one output below.</em></sub>
</p>

Every entry in that list carries its own:

- **Node** — the scene node the morph lives on (`Genesis9`, `GoldenPalace_G9`, a
  bone, …); autocomplete fills it in when you pick a suggestion.
- **Parameter name** — the morph's internal Daz name.
- **Value** — what this morph is dialed to at the pose's frame.
- **Base** *(optional)* — the value the morph **returns to** on the frames around
  the pose (default `0`). Only read when **Auto** is off.
- **Auto** — **on by default.** Reads the base from the morph's **current scene
  value** when the script runs.

> **Why Auto is on by default.** ROM morphs and base-shape morphs are allowed to
> overlap. With **Auto** on, a morph the open scene already dials to 100 %
> sawtooths back to *that* value around its pose instead of being flattened to
> `0` — so the ROM stops erasing the base shape. A morph the scene does not dial
> reads `0` anyway, so for most morphs Auto changes nothing.

<details>
<summary><strong>Combining several morphs into one output — why you'd do it</strong></summary>
<table><tr><td>

Combining bakes a shape that only exists as a combination of dials — or a
controller plus its corrective — into a single clean morph for Houdini and Unreal:
all the listed morphs are keyed together on that one frame and blend into the
output named in **Name**. **Add morph** adds more; the trash icon removes one (a
pose always keeps at least one).

</td></tr></table>
</details>

<details>
<summary><strong>Bone scale — morphs that scale bones (reference skeletons)</strong></summary>
<table><tr><td>

Some morphs also **scale bones** (Torso Length, Proportion Height…). Generated
morphs can only move vertices, and Daz's FBX export doesn't carry bone scales — the
body would reshape while the skeleton stays put. Such frames need a
**reference-skeleton FBX**, which the Houdini PoseAsset points at for that frame
(its *Reference FBX File* input).

Tick **Bone scale** on the pose row and the studio handles it end to end: the frame
is handed to the **DTH Exporter Plugin**, which writes the FBX into a `Reference
Skeletons` subfolder of your export directory, and the CSV gets its path filled in.

<p align="center">
  <img width="900" alt="the Bone scale toggle on a pose row" src="screenshots/character-bone-scale-toggle.png" />
  <br>
  <sub><em>Tick Bone scale on a bone-scaling morph — its reference-skeleton FBX is exported and referenced for you.</em></sub>
</p>

> [!NOTE]
> **Bone scale only acts when the export actually runs.** With *Run the export
> with the ROM script* off (and no split `Export_…` run), a ticked Bone scale is a
> no-op — you export the reference skeletons yourself. Turn the export back on and
> it becomes live, no re-ticking needed.

Only **GEN** and **FBM** poses can be reference frames — the two categories
DazToHue supports reference skeletons in. DTH's own
[Guide To Creating Custom ROMs](https://docs.google.com/document/d/1e8B9uDSmiS-v5si0YLEnnAhcnhnfGl9m0RsgCE5EDWA/edit?tab=t.0)
describes the feature in depth.

</td></tr></table>
</details>

<details>
<summary><strong>Section &amp; group tools — suffixes, mirroring, reordering, inserting</strong></summary>
<table><tr><td>

Each section header has its **Enable** switch and **Mode** select. In Preset mode
you can **pick the exact DTH release asset** when several match; a red **no G9
asset** chip appears when the active release ships nothing for it. The **JCM**
section's Custom mode takes a **path to your own pose preset** (`.duf`).

Grouped sections carry per-group settings in their header:

- **driver bone(s)** — the bones driving the group's poses (JCM/GEN/PHY).
- **Generation / Calculate from / Suffix** — how Houdini computes the group's
  morphs (Default / Individual / Additive / Cumulative / Advanced Additive), what
  deltas are measured against (Rest Pose / Animation Frame), and the side suffix
  (`_l` / `_r`, appended automatically).
- **Mirror right** — on a *Left* group, appends a mirrored right-side copy.
- The **frame chip** shows the group's computed range live (`frames 104–107`).

Inside a group, **drag rows** to reorder (frames simply renumber) and the small
**+** next to a frame number inserts an empty pose before or after it.

</td></tr></table>
</details>

## Finding the internal Daz name

The **Parameter name** is the parameter's internal name, which usually differs from
the slider's label (label *Body Tone* → internal `body_bs_BodyTone`). The
comfortable way is the studio's **autocomplete**: one unattended scan (**Tools →
Scan & index**) covers every generation, and from then on each Parameter name field
suggests matches as you type — searchable by **internal name** *or* **Daz UI
label**, filling in the exact internal name **and** the right node.

<p align="center">
  <img width="440" align="top" alt="A morph's internal Daz name" src="https://github.com/user-attachments/assets/9ca14a2a-f871-4a10-80dc-7713942dac49" />&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<img width="355" align="top" alt="Looking up a morph's internal name in Daz" src="https://github.com/user-attachments/assets/703690ca-78a1-4a45-9c9a-c7d91be49a86" />
  <br>
  <sub><em>Left: a morph's internal name differs from its slider label. Right: the manual route via Parameter Settings.</em></sub>
</p>

<p align="center">
  <img width="508" alt="Parameter name autocomplete suggestions" src="screenshots/detail-morph-autocomplete.png" />
  <br>
  <sub><em>Each Parameter name field autocompletes from the scanned index.</em></sub>
</p>

<details>
<summary><strong>Building the index — <code>Tools → Scan &amp; index</code></strong></summary>
<table><tr><td>

Open [**Tools → Scan & index → Scan project**](./tools.md#tab-1--scan-amp-index),
tick what you want and press **Start scan**. The studio hands Daz Studio one batch
and works through it unattended.

- **Base morphs** builds each generation's stock figures and indexes their
  **morphs** and **skeleton**, feeding the **Parameter name** fields *and* the bone
  field of [Modify JCM frames](./advanced.md#modify-jcm-frames). It covers *Genesis
  3*, *8* and *8.1* female **and** male, and *Genesis 9* twice — being
  gender-neutral, that pair is differentiated by geograft. Installed new morph
  products later? Just scan again.
- **Character morphs** opens every linked Daz scene and indexes the dials the base
  index *doesn't* have — fitted clothing, hair, third-party geografts. Each find is
  filed under its scene and only suggested while that scene is selected, so two
  jackets in two scenes stop competing for the same *Expand All*.

> **Base morphs first.** A scene scan works out what a scene *adds* by subtracting
> the base index — without one it stops and tells you, rather than filing the whole
> stock figure as "what this scene adds".

**Running it by hand.** The runtime installation also puts the base build into
your Daz library as `Scripts/DTH-Character-Studio/Build_Genesis_Index.dsa` — the
same thing the scan batch runs. It stays useful for one case: **indexing a scene
that isn't linked to any character**. **Save your open scene first** (the stock
build clears it), then run it from the Content Library.

   <p align="center">
     <img width="564" alt="Build_Genesis_Index in the Daz Content Library" src="https://github.com/user-attachments/assets/b0ad36d5-7983-4632-b842-3df0b6a8e531" />
     <br>
     <sub><em>Manual execution: the index script in Daz's Content Library, under Scripts/DTH-Character-Studio.</em></sub>
   </p>

It confirms which generations it found, builds the stock figures one at a time,
finishes on an **empty scene**, and summarizes what was indexed per generation.
With figures **already loaded** it offers to **scan the open scene** instead (that
path never clears anything), and if that scene is saved it asks how to file the
finds: **For this scene** or **into the base index**.

   <p align="center">
     <img width="508" alt="Build_Genesis_Index run summary dialog" src="https://github.com/user-attachments/assets/7dd80317-3cbc-4a3e-b33d-ae398e81882c" />
     <br>
     <sub><em>The run summary: morphs and bones indexed per generation, and the geograft file each pick settled on.</em></sub>
   </p>

</td></tr></table>
</details>

[← Your first character](./04-first-character.md) · [Guide overview](./README.md)
