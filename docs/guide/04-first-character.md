# 4 · Your first character

## Create it

<!-- screenshot: project window, create character panel -->

1. In the project window press **Add character** (or drop a `.duf` anywhere).
2. **Choose Daz scene…** — the character's scene file.
   **It must not contain an animation** — just the character itself.
3. Name it (the name becomes its folder in the project), confirm **Genesis** (G9)
   and **Gender**.
4. **ROM prefill** — for a first character pick **Example**: it copies a complete,
   working ROM definition you can explore and adapt. (Later you can prefill from
   any of your own characters, across projects.)
5. Press **Create**. The scene is copied into the character's folder — your
   original stays where it is.

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
frame, and the Daz and Houdini outputs can't drift apart. Typical first-character
work: open **Full Body (FBM)**, switch it to Custom, and list the morphs your
character actually uses (each morph by its Daz property name, with the value to
key). The **Example** prefill shows how the pieces fit.

Two G9 sliders above the sections — **FACS Detail Strength** and **Flexion
Automatic Strength** — are keyed at frame 0 if your character needs them.

## Save = generate

Press **Save**. Every save regenerates the character's files in one go:

- **`<Name>_G9.dsa`** — the Daz apply-script, installed straight into your Daz
  library under `Scripts/DTH-Character-Studio/<Project>/<Character>/`
- **`<Name>_pose_asset.csv`** — the Houdini PoseAsset import CSV, stored in the
  character's folder
- FBM helper files and (with an export folder set — see next step) an export script

Change anything later — morphs, sections, export options — and simply Save again;
both sides stay in sync by construction.

[← Your first project](./03-first-project.md) · [Next: Build the ROM in Daz →](./05-rom-in-daz.md)
