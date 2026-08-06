# Getting started

This guide takes you from a fresh install to your first generated Range of Motion:
you'll set the studio up, create a project and a character, build the ROM in Daz
Studio — optionally exporting straight into the DTH pipeline — and hand the result
to Houdini.

## What you need

- **Windows 10/11** and [DTH Character Studio](https://github.com/polynaut/dth-character-studio/releases/latest) — a Mac version of DTH Character Studio is available too, but the Daz **DTH Exporter Plugin** is Windows-only
- **[Daz Studio](https://www.daz3d.com/technology/)** with a **Genesis 9** character (G3, G8, G8.1 and G9 are all selectable; G9 is the deeply validated path)
- The **[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue)** package by mrpdean —
  it contains the **DTH release** (Daz + Houdini content) and the **DTH Exporter Plugin**
- **[SideFX Houdini](https://www.sidefx.com/products/houdini/)** — needed for the far side of the pipeline

## The steps

1. [Install the app](./01-installation.md)
2. [One-time setup](./02-setup.md) — wire up the DTH release and the Exporter Plugin
3. [Your first project](./03-first-project.md)
4. [Your first character](./04-first-character.md) — define it and get easy scripts for Daz Studio
5. [Build the ROM in Daz Studio](./05-rom-in-daz.md) — with optional direct export
6. [Into Houdini](./06-into-houdini.md)


## Optional & advanced

None of these are needed to generate a ROM:

- [Custom morphs](./custom-morphs.md) — listing the morphs of a section
  yourself: pose rows, combining several Daz morphs into one output, bone-scale
  reference frames, and finding a morph's internal Daz name.
- [Advanced character options](./advanced.md) — multiple Daz scenes on one
  character (outfits, per-scene hair, per-scene overrides), and driving extra
  morphs off bone rotations (Modify JCM frames).
- [The Tools page](./tools.md) — one-click **Scan & index** of a project (the
  morph/bone index behind the autocompletes), installing/maintaining your own
  Daz & Houdini content, deduplicating downloads, and refreshing generated
  files.
- [Attachments](./attachments.md) — reusable Daz scenes (not full characters),
  organized in a project alongside its characters. *(Opt-in per project.)*
- [Daz product scanning](./product-scanning.md) — discover which Daz products
  a character uses and store the list on it. *(Opt-in per project.)*
