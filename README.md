# DTH Character Studio

Declarative character & ROM administration for the
[DazToHue (DTH)](https://www.daztohue.com) character workflow — as a web app or
a desktop app.

You describe a character **once** — its Genesis version, gender, ROM sections,
and full-body morphs — and the studio generates the two artifacts that
otherwise cost hours of error-prone, frame-exact manual work:

- **Daz side** — `<Name>_FBMs.json` + `DthWorkflow<Name>.dsa`, a one-click full
  ROM apply through the [DazToHue-Scripts](#related-projects) framework
  (replacing the hand-built per-character scripts).
- **Houdini side** — the DazToHue **PoseAsset node** import CSV.

Because both come from the same definition, the "650 frames must match 100%"
problem disappears by construction — change the character, regenerate, and both
sides stay in sync.

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

## Repository layout

A small pnpm-workspace monorepo:

```
apps/
  web/      TanStack Start app — the studio itself. Runs standalone as a web app.
  desktop/  Thin Electron shell that reuses apps/web for its UI.
```

The web app never depends on Electron — it is always a first-class standalone
application. The desktop shell is purely additive.

## Run — web

```sh
pnpm install
pnpm dev          # http://localhost:4330  (also bound on the LAN)
```

Other scripts: `pnpm build`, `pnpm start` (production server), `pnpm test`,
`pnpm typecheck`, `pnpm generate-routes`.

## Run — desktop

```sh
pnpm dev:desktop      # web dev server (HMR) + an Electron window pointed at it
pnpm start:desktop    # build web + shell, run the packaged-style production app
```

> First desktop run downloads the Electron binary (~170 MB). If the shell errors
> with `Electron uninstall`, pnpm skipped that download — run it once with
> `pnpm --filter @dth/desktop exec node node_modules/electron/install.js`.

After first launch, open **Settings** and point the two folders at:

- your **DazToHue-Scripts** checkout (generated Daz files are written here, next
  to `DthWorkflow.dsa`, so they run straight from Daz Studio), and
- your **DTH release or Poses folder** (scanned for the pre-defined pose preset
  catalog — accepts a release root or the installed library Poses folder).

## How the desktop app reuses the web app

The desktop shell does **not** reimplement the backend. The web app's TanStack
Start server functions already do all file I/O, so the shell simply runs that
server and points a window at it:

- **Dev** — the Electron window loads the web dev server at `localhost:4330`
  (full HMR). You develop the web app exactly as before; Electron is optional.
- **Production** — the main process boots the web app's *own* production server
  (`apps/web/server/index.js`) on a random local port, then loads it.

The only Electron-specific surface is a deliberately tiny bridge
(`apps/desktop/src/preload`) exposing `window.desktop` — native FBX dialog, app
version, open-data-folder. The web UI feature-detects it and falls back to its
server functions when running as a plain web app, so neither mode breaks.

Character data lives in `apps/web/data` for the standalone web app; the desktop
shell sets `DTH_DATA_DIR` to the per-user application-data folder so characters
survive app updates.

### Packaging status

The dev and run-from-source flows work today. Producing a distributable
**installer** additionally requires bundling the web server's runtime
dependencies into the app resources (pnpm's symlinked `node_modules` don't copy
as-is) — that is a planned follow-up; see `apps/desktop/electron-builder.yml`.

## Data & sharing — share definitions, not assets

Character definitions live as one JSON file per character in `apps/web/data/`
(gitignored). Generated artifacts (`FBM` JSON/CSV, PoseAsset CSV, art-direction
JSON) and these definitions are **recipes**: they reference Daz assets by morph
name, frame number and bone — they do **not** contain any licensed content. That
makes them freely shareable; bring your own licensed assets.

> **Do not share full Houdini projects or export folders.** Those contain baked
> licensed content (Alembic/FBX geometry, copied textures) and redistributing
> them violates the Daz / Renderotica asset licenses. Share the character
> definition, not the assets.

## Related projects

- **[DazToHue](https://www.daztohue.com)** by *mrpdean* — the Houdini/UE toolset
  this studio targets (the PoseAsset node, ROMs and pose presets).
- **[DazToHue-Scripts](https://github.com/soltude/DazToHue-Scripts)** by *Soltude*
  and contributors — the Daz Studio scripting framework the generated workflow
  files drive.

## License

[MIT](./LICENSE) © Polynaut
