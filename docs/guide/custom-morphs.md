# Custom morphs

A ROM section in **Preset** mode runs a DTH release asset as it ships. Switch it
to **Custom** and you list the morphs yourself. This page continues
[Your first character](./04-first-character.md#the-rom-definition), which does
exactly that for its **Full Body Morphs (FBM)** section.

<details>
<summary><strong>Import from an existing Daz scene</strong></summary>
<table><tr><td>

A section already posed on a Daz timeline doesn't have to be typed in again.
**Import from Daz scene** reads those keyed frames and turns each one into a
pose row.

Click it, then **pick a scene** — or drag the `.duf` straight from Explorer onto
the button. The studio checks the scene first:

| Check | Why |
| ----- | --- |
| Exactly **one figure** | The scan picks the figure itself, so a second one makes it a coin toss. |
| The character's **own generation** | A G8 scan imports morph names that belong to another skeleton. |
| **Animation on the timeline** | The keyed frames *are* what there is to read. This is the opposite of the check when you *add* a scene, which wants an empty timeline for the ROM script to fill. |

A failed check blocks the scan and says why, with the usual *"Scan anyway"*
escape if you know better.

**Start scan** hands the scene to Daz Studio — the same job runner **DTH
Export** uses, so it needs the **Runner plugin** installed
([Installation](./01-installation.md)). Daz opens the scene, scans it with no
dialogs and the studio takes you straight to the frame-range picker. It looks
like nothing is happening in Daz: that is the point — the run opens no windows,
and it clears the scene again when it finishes. **Cancel scan** takes the job
back if you change your mind.

Scans you already made stay listed in the same dialog, newest first. That is
deliberate: **one scan of a scene can feed several ROM sections**, so importing
FBM after RET should not send you back to Daz. **Browse** still takes any CSV
you curated yourself, and running **`Scan_Frames`** by hand in Daz
(`Scripts › DTH-Character-Studio`) still works and lands in the same list.

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

## Finding a morph's internal Daz name

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

> **Base morphs first — it isn't just an ordering preference.** A scene scan
> works out what a scene *adds* by subtracting the base index, so without one
> there is nothing to subtract. Rather than file the whole stock figure as
> "what this scene adds", a scene scan with no base index for that generation
> **stops and tells you**. Your ROM and export runs scan their scene
> automatically, so they simply skip that step (a line in the Daz log, never a
> failed export) until the base index exists — then the next run files it
> correctly.

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

[← Your first character](./04-first-character.md) · [Guide overview](./README.md)
