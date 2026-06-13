# DTH Character Studio

Declarative character & ROM administration for the
[DazToHue (DTH)](https://www.daztohue.com) character workflow.

You describe a character **once** — its Genesis version, gender, ROM sections,
and full-body morphs — and the studio generates the two artifacts that
otherwise cost hours of error-prone, frame-exact manual work:

- **Daz side** — `<Name>_FBMs.json` + `DthWorkflow<Name>.dsa`, a one-click full
  ROM apply through the [DazToHue-Scripts](#related-projects) framework
  (replacing the hand-built per-character scripts).
- **Houdini side** — the DazToHue **PoseAsset node** import CSV.

Because both come from the same definition, the "650 frames must match 100%"
problem disappears by construction — change the character, regenerate, and
both sides stay in sync.

## Why

Setting up a DTH character's Range of Motion by hand takes 1.5–2 hours of
click-work per character, is extremely error-prone, and the mistakes only
surface stages later as broken morphs in Unreal — with no fix but to redo the
work. The studio turns that ritual into a declaration: edit fields, click
generate, run the scripts. Reproducible in seconds instead of hours.

## Status

Early but functional. The **Genesis 9 female** path is feature-complete and
validated byte-for-byte against hand-built artifacts on both the Daz and
Houdini sides. Genesis 8/8.1 and the male (Dicktator) path are planned.

## Stack

TanStack Start (React 19, file-based routing, server functions for all file
I/O), TanStack Table for the ROM grid, dnd-kit for reordering, Tailwind 4 +
shadcn components, Zod schemas as the single source of truth for the character
model.

## Run

```sh
pnpm install
pnpm dev          # http://localhost:4330  (also bound on the LAN)
```

Other scripts: `pnpm build`, `pnpm test`, `pnpm generate-routes`.

After first launch, open **Settings** and point the two folders at:

- your **DazToHue-Scripts** checkout (generated Daz files are written here,
  next to `DthWorkflow.dsa`, so they run straight from Daz Studio), and
- your **DTH release or Poses folder** (scanned for the pre-defined pose
  preset catalog — accepts a release root or the installed library Poses
  folder directly).

## Data & sharing — share definitions, not assets

Character definitions live as one JSON file per character in `data/`
(gitignored). Generated artifacts (`FBM` JSON/CSV, PoseAsset CSV, art-direction
JSON) and these definitions are **recipes**: they reference Daz assets by morph
name, frame number and bone — they do **not** contain any licensed content.
That makes them freely shareable; bring your own licensed assets.

> **Do not share full Houdini projects or export folders.** Those contain baked
> licensed content (Alembic/FBX geometry, copied textures) and redistributing
> them violates the Daz / Renderotica asset licenses. Share the character
> definition, not the assets.

## Related projects

- **[DazToHue](https://www.daztohue.com)** by *mrpdean* — the Houdini/UE toolset
  this studio targets (the PoseAsset node, ROMs and pose presets).
- **DazToHue-Scripts** by *Soltude* and contributors — the Daz Studio scripting
  framework the generated workflow files drive.

## License

[MIT](./LICENSE) © Polynaut
