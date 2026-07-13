# 4 · Your first character

## Create it

<!-- screenshot: project window, create character panel -->

1. In the project window press **Add character** (or drop a `.duf` anywhere).   
3. **Choose Daz scene…** — the character's scene file.
   **It must not contain an animation** — just the character itself.
4. Name it (the name becomes its folder in the project), confirm **Genesis** (G9)
   and **Gender**.
5. **ROM prefill** — start **Empty** for a first character, or prefill from any
   of your own characters (across projects) to copy a working ROM definition.

  <img width="722" height="518" alt="Screenshot 2026-07-13 202915" src="https://github.com/user-attachments/assets/3446cc99-9884-416a-88b0-e6e6f7cc8368" />
   
6. Press **Create**. The scene is copied into the character's folder — your
   original stays where it is.

   <img width="1014" height="700" alt="Screenshot 2026-07-13 203443" src="https://github.com/user-attachments/assets/9e6b850e-9725-4f5c-9e18-64ee797ce18b" />


## The ROM definition

<!-- screenshot: character page, ROM sections -->

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

The studio computes every frame number from this structure — you never type a
frame, and the Daz and Houdini outputs can't drift apart. 

<img width="1014" height="700" alt="Screenshot 2026-07-13 204539" src="https://github.com/user-attachments/assets/5e412f4b-d27f-4ac5-9fd7-8abb5f446fe4" />


### Golden Palace & Dicktator — the genitalia (GEN) section

<!-- screenshot: character page, GEN section enabled in Preset mode -->

**GEN** is the genital geograft's range of motion, and for most characters it's a
ready-made preset with nothing to fill in. You don't even choose the product — the
character's **Gender** (set when you created it) decides: a **female** character
uses **Golden Palace**, a **male** character uses **Dicktator**. Our example is a
G9 Female, so her GEN section covers Golden Palace.

Enable GEN and leave it on **Preset** — that's the whole setup. The studio inserts
the DTH release's stock Golden Palace (or Dicktator) ROM block: no morphs to list
and no frames to count, dropped into the fixed GEN slot of the sequence (after
EXP, before PHY) so the Daz and Houdini outputs stay frame-aligned like every
other section.

Two things worth knowing:

- **The geograft has to be fitted to the figure in the character's Daz scene.**
  The preset poses the geograft itself, so if Golden Palace / Dicktator isn't
  loaded and fitted when you build the ROM, those frames fail. (It's the same
  reason the morph scan below has you load your geografts — so their dials get
  indexed too.)
- **Preset only appears where the DTH release ships that asset.** If your release
  carries no Golden Palace / Dicktator content for the character's Genesis
  generation, the studio flags GEN's Preset as unavailable instead of letting you
  generate a block that can't run.

Want hand-picked genital morphs instead of the stock ROM? Switch GEN to **Custom**
and list them exactly like the FBM morphs below — but for most characters the
Preset is all you need.


For this example we add some **Full Body (FBM)**, switch it to Custom, and list the morphs your
character actually uses (each morph by its Daz property name, with the value to
key) — or import them from a `DthScanFrames` CSV (see [Tools](./tools.md)).

Each pose row has two name fields with very different jobs:

- **Name** — *your* name for the generated morph, the one value that travels to
  **Houdini** and later **Unreal Engine**. Letters, numbers and underscores
  **only** — Houdini rejects anything else, and the field flags invalid
  characters. The group's Left/Right suffix is appended automatically.
- **Morph name** — must **exactly match the morph's internal name in Daz
  Studio** (not its display label). A mismatch means that frame fails in the
  ROM run.

### Combining several morphs into one output

A pose usually maps one Daz morph to one generated output — but it doesn't have to.
Each row has a **morphs** toggle (it reads *"2 morphs"*, *"3 morphs"*… once you add
more); expand it to drive the **one** output morph from **several** Daz morphs or
controllers at once. That's how you bake a shape that only exists as a combination
of dials — or a controller plus its corrective — into a single clean morph for
Houdini and Unreal.

<!-- screenshot: a pose row expanded, showing several combined morphs -->

Each entry in the expanded list carries its own:

- **Node** — the scene node the morph lives on (`Genesis9`, `GoldenPalace_G9`, a
  bone, …); autocomplete fills it in when you pick a suggestion.
- **Property** — the morph's internal Daz name (same rule as the single Morph name).
- **Value** — what this morph is dialed to at the pose's frame.
- **Base** *(optional)* — the value it returns to on the frames around the pose
  (default `0`). Set it for a morph that's already part of the character's base
  shape so the ROM keys the delta instead of snapping from zero — or tick **Auto**
  to read the base from the morph's current scene value when the script runs.

All the listed morphs are keyed together on that one frame, so they blend into the
single output named in **Name**. **Add morph** piles on more; the trash icon drops
one (a pose always keeps at least one).

### Layering extra morphs onto JCM — "Modify JCM frames"

The **JCM** section runs the shipped joint-corrective-morph poses — bones rotate
through their range and the stock correctives fire. To ride *your own* morphs along
with those bends, the JCM section has a **Modify JCM frames** grid: an optional
power feature, collapsed by default.

<!-- screenshot: JCM section, "Modify JCM frames" grid expanded -->

You build it from **rules**, each watching **one bone's rotation axis** (XRotate /
YRotate / ZRotate) across the JCM ROM. A rule's **drives** are the morphs it sets
proportionally to the keyed angle — the **angle range maps linearly onto a value
range** — and you list them separately for **positive** and **negative** rotation,
so a bend each way can trigger different morphs. Example: layer a custom calf-flex
morph on top of the shipped knee-bend poses.

Each drive is one row:

- **Rotation** — `positive` or `negative` (which way the bone turns).
- **Morph name** — the morph to drive (autocompletes, same as everywhere else).
- **Angle from / to** — the bone angles, in degrees, over which the morph ramps.
- **Value from / to** — the morph's value at those angles (raw, `1` = 100%).

**Add rule** starts a new bone/axis; **Add morph drive** adds a row to a rule. The
**mirror** button copies a rule to the other side, flipping every Left/Right and
`_L`/`_R` token in the bone and morph names while carrying the angles and values
over unchanged — so you set a limb up once and mirror it.

### Finding a morph's internal Daz name

The internal name usually differs from the slider's label (label *Body Tone* →
internal `body_bs_BodyTone`). The comfortable way is to let the studio
**autocomplete** them for you — after a one-time scan per Genesis generation,
every Morph name field offers matching suggestions as you type. Two manual
routes still work when you just need a single name.


<img width="504" height="154" alt="Screenshot 2026-07-13 205938" src="https://github.com/user-attachments/assets/9ca14a2a-f871-4a10-80dc-7713942dac49" />

<img width="404" height="388" alt="Screenshot 2026-07-13 205952" src="https://github.com/user-attachments/assets/703690ca-78a1-4a45-9c9a-c7d91be49a86" />

<details>
<summary><strong>Recommended: scan your morphs once, then autocomplete</strong> — <code>Scan_Morphs_&lt;Genesis&gt;.dsa</code></summary>

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

  <img width="960" height="1044" alt="Screenshot 2026-07-13 214606" src="https://github.com/user-attachments/assets/1b381f07-38ae-46f2-8e84-d19e9ff65e1d" />
  
3. A summary tells you how many morphs were found across how many nodes.

  <img width="342" height="91" alt="Screenshot 2026-07-13 214615" src="https://github.com/user-attachments/assets/55fba5d5-75ba-4576-b201-f4ea55178f84" />

That's the whole scan — it indexes **everything dialable** the figure carries:
classic morphs *and* controller dials, across all products installed for that
generation. The studio picks the index up automatically (switch back to the
studio window and it's live).

From then on, every **Morph name** field autocompletes after two typed
characters:

- search by the **internal name** *or* the **Daz UI label** — each suggestion
  shows both, tags which one matched, and names the node the morph lives on;
- picking a suggestion fills in the exact internal name **and** selects the
  right node on that ROM entry — no more mismatched node/morph pairs.

  <img width="638" height="178" alt="Screenshot 2026-07-13 214703" src="https://github.com/user-attachments/assets/3b5916c2-c664-4cb2-a6e1-68b5930264e8" />

Installed new morph products since the last scan? Just run the scan script
again — the index is replaced wholesale, and the studio refreshes it the next
time its window gains focus.

</details>

## Save = generate

Press **Save**. Every save regenerates the character's files in one go:

- **`ROM_<Name>_G9.dsa`** — the Daz apply-script, installed straight into your
  Daz library under `Scripts/DTH-Character-Studio/<Project>/<Character>/`
- **`<Name>_pose_asset.csv`** — the Houdini PoseAsset import CSV, stored in the
  character's folder

Change anything later — morphs, sections, export options — and simply Save again;
both sides stay in sync by construction.

[← Your first project](./03-first-project.md) · [Next: Build the ROM in Daz →](./05-rom-in-daz.md)
