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
generation. The studio picks the index up automatically — switch back to the
studio window and it's live. Run the scan once per Genesis generation you work
with, each on a figure of that generation loaded in the scene.

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
