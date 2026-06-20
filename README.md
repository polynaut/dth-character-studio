<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo-on-black.png">
    <img alt="DTH Character Studio" src="brand/logo-on-white.png" width="200">
  </picture>
</p>

<h1 align="center">DTH Character Studio</h1>

<p align="center">
  <strong>Define your character once. Generate a flawless, frame-exact Range of Motion in seconds.</strong>
</p>

<p align="center">
  The companion app for the <a href="https://www.artstation.com/marketplace/p/BLM5K/daztohue">DazToHue</a> workflow — Daz&nbsp;Studio&nbsp;→&nbsp;Houdini&nbsp;→&nbsp;Unreal&nbsp;Engine.
</p>

<p align="center">
  <a href="https://github.com/polynaut/dth-character-studio/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/polynaut/dth-character-studio?label=download&color=ff5a1f"></a>
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows-blue">
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/github/license/polynaut/dth-character-studio?color=green"></a>
</p>

---

## Stop building Range of Motion by hand

Setting up a DazToHue character's Range of Motion the manual way takes **1.5–2 hours of frame-exact click-work** per character. One missed step doesn't fail loudly — it surfaces stages later as broken morphs in Unreal, and the only fix is to start over. A single character can eat a week.

DTH Character Studio turns that ritual into a **declaration**. Describe your character once — Genesis version, ROM sections, full-body morphs — and the studio generates everything the pipeline needs.

## One definition. Both sides. Always in sync.

From a single character definition, the studio produces:

- 🎬 **Daz side** — a one-click script that applies the *entire* ROM in Daz Studio, replacing the hand-built per-character setup.
- 🌀 **Houdini side** — the DazToHue **PoseAsset** import CSV, ready to drop into your network.

Because both come from the same source, the "hundreds of frames must match 100%" problem disappears **by construction**. Change the character, regenerate, and Daz and Houdini stay perfectly aligned.

## Why you'll want it

- 🎯 **Frame-exact & validated.** The Genesis 9 path is verified byte-for-byte against hand-built artifacts on both sides.
- 🖱️ **One-click everything.** Install the DTH runtime and exporter, generate, and apply — no manual file shuffling.
- 🗂️ **Projects & character library.** Organize characters per game project, switch between them instantly, and keep your library wherever you back up.
- 🔄 **Always up to date.** The desktop app checks for updates on launch and installs them with a click.
- 🤝 **Share recipes, not assets.** Definitions reference morphs by name and frame — freely shareable, with no licensed content baked in.

## How it works

1. **Describe** your character — pick the Genesis version, add ROM sections and body morphs.
2. **Generate** — one click produces the Daz apply-script and the Houdini PoseAsset CSV.
3. **Apply** — run the script in Daz Studio, import the CSV in Houdini.
4. **Export** to Unreal Engine — with every frame already matching, by design.

## Get it

**[⬇️ Download the latest release](https://github.com/polynaut/dth-character-studio/releases/latest)** (Windows installer). The app self-updates from there.

> Prefer to run it yourself or build from source? See the [Development guide](./docs/development.md).

## Status

The **Genesis 9 female** path is feature-complete and validated end-to-end — in
Daz Studio, in Houdini, and byte-for-byte against hand-built artifacts. Genesis
8/8.1 and the male (Dicktator) path are on the roadmap.

## Share definitions, not assets

Character definitions and the files the studio generates are **recipes** — they
reference Daz assets by morph name, frame number and bone, and contain no
licensed content. That makes them freely shareable; bring your own licensed
assets.

> **Don't share full Houdini projects or export folders.** Those contain baked
> licensed content (Alembic/FBX geometry, copied textures) and redistributing
> them violates the Daz / Renderotica asset licenses. Share the definition, not
> the assets.

## Built for the DazToHue workflow

- **[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue)** by *mrpdean* — the Houdini/UE toolset this studio targets (the PoseAsset node, ROMs and pose presets).
- **[DazToHue-Scripts](https://github.com/soltude/DazToHue-Scripts)** by *Soltude* and contributors — the Daz Studio scripting framework the generated files drive.

## Documentation

- [Development guide](./docs/development.md) — run, build, and architecture
- [DevOps](./docs/devops.md) — release pipeline, signing, branch policy
- [Contributing](./CONTRIBUTING.md)

## License

[MIT](./LICENSE) © Polynaut
