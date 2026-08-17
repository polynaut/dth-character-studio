# Getting started

From a fresh install to your first generated Range of Motion: set the studio up,
create a project and a character, build the ROM in Daz Studio, hand the result
to Houdini.

## What you need

- [DTH Character Studio](https://github.com/polynaut/dth-character-studio/releases/latest) on **Windows 10/11** or **macOS** (Apple Silicon). The Mac build defines characters and generates both artifacts; the automation that drives Daz and Houdini is [Windows-only](./01-installation.md#macos).
- **[Daz Studio](https://www.daz3d.com/technology/)** with a **Genesis 9** character (G3, G8, G8.1 and G9 are selectable; G9 is the deeply validated path)
- The **[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue)** package by mrpdean — it contains the **DTH release** (Daz + Houdini content) and the **DTH Exporter Plugin**
- **[SideFX Houdini](https://www.sidefx.com/products/houdini/)**

## The steps

1. [Install the app](./01-installation.md)
2. [One-time setup](./02-setup.md) — wire up the DTH release and the Exporter Plugin
3. [Your first project](./03-first-project.md)
4. [Your first character](./04-first-character.md) — define it, get its Daz scripts
5. [Build the ROM in Daz Studio](./05-rom-in-daz.md) — with optional direct export
6. [The DTH Export batch](./dth-export.md) — or let the studio run the whole round trip
7. [Into Houdini](./06-into-houdini.md)

## Optional & advanced

None of these are needed to generate a ROM:

- [Custom morphs](./custom-morphs.md) — pose rows, combining several Daz morphs
  into one output, bone-scale reference frames, internal Daz names.
- [Advanced character options](./advanced.md) — multiple Daz scenes on one
  character (outfits, per-scene hair, per-scene overrides) and Modify JCM frames.
- [Bundled fix-it scripts](./bundled-scripts.md) — a geograft trapped under a
  Golden Palace shell; a scene that is only a baked ROM animation.
- [The Utils drawer](./houdini-utils.md) — copy a material, skeleton or occlusion
  setup between Houdini projects.
- [Project checks and repairs](./houdini-project-checks.md) — a project's `$JOB`,
  timeline, paths and blank DazToHue parameters, checked and put right.
- [The Tools page](./tools.md) — **Scan & index**, installing your own Daz &
  Houdini content, deduplicating downloads, refreshing generated files.
- [Attachments](./attachments.md) — reusable Daz scenes and Houdini templates.
  *(Opt-in per project.)*
- [Daz product scanning](./product-scanning.md) — which Daz products a character
  uses. *(Opt-in per project.)*
