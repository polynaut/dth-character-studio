# DTH Character Studio

Declarative character & ROM administration for the
[DazToHue (DTH)](https://www.artstation.com/marketplace/p/BLM5K/daztohue) character workflow — as a web app or
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

A 2-layer pnpm-workspace monorepo:

```
apps/
  web/      React SPA (Vite + TanStack Router) — the studio UI. Runs standalone in a browser.
  desktop/  Tauri 2 shell (Rust) — the shippable desktop app; loads apps/web and
            provides native file / dialog / auto-update access.
packages/
  rom/      Pure ROM/CSV/DSA generation core (@dth/rom) — framework-agnostic, no I/O.
```

The generation core (`packages/rom`) is pure TypeScript and is where the value
lives; the apps are thin shells around it.

## Run — web

```sh
pnpm install
pnpm dev          # http://localhost:4330  (also bound on the LAN)
```

Other scripts: `pnpm build`, `pnpm preview`, `pnpm -r test`, `pnpm -r typecheck`,
`pnpm generate-routes`. (Run as a plain web build, the native file features
no-op — they require the Tauri desktop app.)

## Run — desktop

Requires Rust ([rustup](https://rustup.rs)) and, on Windows, WebView2
(preinstalled on Windows 11).

```sh
pnpm dev:desktop      # Tauri: starts the web dev server (HMR) + the native window
pnpm build:desktop    # production build → NSIS installer under apps/desktop/target/release/bundle
```

After first launch, open **Settings** and point the two folders at:

- your **DazToHue-Scripts** checkout (generated Daz files are written here, next
  to `DthWorkflow.dsa`, so they run straight from Daz Studio), and
- your **DTH release or Poses folder** (scanned for the pre-defined pose preset
  catalog — accepts a release root or the installed library Poses folder).

## How the desktop app works

The Tauri shell loads the `apps/web` SPA and exposes native capabilities through
Tauri plugins instead of a Node backend:

- **File I/O** — characters, settings, generated output, and the Poses-folder
  scan go through `@tauri-apps/plugin-fs`; the native FBX picker uses
  `@tauri-apps/plugin-dialog`. The generation itself (`packages/rom`) is pure
  TypeScript and runs in the webview.
- Character data lives in the per-user app-data folder (`appLocalDataDir()`), so
  it survives app updates.

The native boundary is concentrated in `apps/web/src/lib/rom/{api,storage}.ts`
and `lib/desktop.ts`, which keeps the SPA runnable in a plain browser (and lets
web-only e2e tests mock that layer).

### Releases & auto-update

Versioning is [Changesets](.changeset/); merging the auto-generated "version
packages" PR triggers a GitHub Release (NSIS installer + signed updater
metadata) built by `.github/workflows/release.yml`. Installed apps check for an
update on launch and self-update on the user's confirmation. Full pipeline,
signing-key, and branch-policy setup: see `docs/devops.md` and `CONTRIBUTING.md`.

## Data & sharing — share definitions, not assets

Character definitions live as one JSON file per character in the app's per-user
data folder (`appLocalDataDir()`). Generated artifacts (`FBM` JSON/CSV, PoseAsset
CSV, art-direction JSON) and these definitions are **recipes**: they reference Daz assets by morph
name, frame number and bone — they do **not** contain any licensed content. That
makes them freely shareable; bring your own licensed assets.

> **Do not share full Houdini projects or export folders.** Those contain baked
> licensed content (Alembic/FBX geometry, copied textures) and redistributing
> them violates the Daz / Renderotica asset licenses. Share the character
> definition, not the assets.

## Related projects

- **[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue)** by *mrpdean* — the Houdini/UE toolset
  this studio targets (the PoseAsset node, ROMs and pose presets).
- **[DazToHue-Scripts](https://github.com/soltude/DazToHue-Scripts)** by *Soltude*
  and contributors — the Daz Studio scripting framework the generated workflow
  files drive.

## License

[MIT](./LICENSE) © Polynaut
