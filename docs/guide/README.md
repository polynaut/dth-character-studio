# Getting started

This guide takes you from a fresh install to your first generated Range of Motion:
you'll set the studio up, create a project and a character, build the ROM in Daz
Studio — optionally exporting straight into the DTH pipeline — and hand the result
to Houdini.

## What you need

- **Windows 10/11** and [DTH Character Studio](https://github.com/polynaut/dth-character-studio/releases/latest)
- **Daz Studio** with a **Genesis 9** character (G9 is fully supported, G8 only partially)
- The **[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue)** package by mrpdean —
  it contains the **DTH release** (Daz + Houdini content) and the **DTH Exporter Plugin**
- **SideFX Houdini** — needed for the far side of the pipeline (step 6)

## The steps

1. [Install the app](./01-installation.md)
2. [One-time setup](./02-setup.md) — wire up the DTH release and the Exporter Plugin
3. [Your first project](./03-first-project.md)
4. [Your first character](./04-first-character.md) — define it and generate
5. [Build the ROM in Daz Studio](./05-rom-in-daz.md) — with optional direct export
6. [Into Houdini](./06-into-houdini.md)

Each step is short — the whole path takes about 15 minutes once the downloads are in place.

## Optional & advanced

None of these are needed to generate a ROM — reach for them once you want finer
control over a character, or want the studio to help maintain your Daz/Houdini
content or organize a project beyond its characters:

- [The character page](./character-page.md) — the full tour of the character detail
  view: avatar, notes, run report, linked scenes/Houdini projects, the ROM timeline,
  group tools, delete.
- [Advanced character options](./advanced.md) — preserve morphs and node transforms
  across the ROM, reset genitalia morphs before custom frames, move a character's
  folder, and drive extra morphs off bone rotations (Modify JCM frames).
- [The Tools page](./tools.md) — install/maintain your own Daz & Houdini content,
  deduplicate downloads, storage housekeeping, and refresh generated files.
- [Attachments](./attachments.md) — attach reusable Daz scenes (not full characters)
  to a project, organized alongside its characters. *(Opt-in per project.)*
- [Daz product scanning](./product-scanning.md) — discover which Daz products a
  character uses and store the list on it. *(Opt-in per project.)*
