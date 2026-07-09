# Development

Everything you need to run, build, and understand DTH Character Studio from
source. For the product overview, see the [README](../README.md).

## Architecture at a glance

A 2-layer pnpm-workspace monorepo. The generation core is pure TypeScript and is
where the value lives; the apps are thin shells around it.

```
apps/
  web/      React SPA (Vite + TanStack Router) — the studio UI. Runs standalone in a browser.
  desktop/  Tauri 2 shell (Rust) — the shippable desktop app; loads apps/web and
            provides native file / dialog / auto-update access.
packages/
  rom/      Pure ROM/CSV/DSA generation core (@dth/rom) — framework-agnostic, no I/O.
```

## Run — web

```sh
pnpm install
pnpm dev          # http://localhost:4330  (also bound on the LAN)
```

Other scripts: `pnpm build`, `pnpm preview`, `pnpm -r test`, `pnpm -r typecheck`,
`pnpm generate-routes`. Run as a plain web build, the native file features no-op —
they require the Tauri desktop app.

## Run — desktop

Requires Rust ([rustup](https://rustup.rs)) and, on Windows, WebView2
(preinstalled on Windows 11).

```sh
pnpm dev:desktop      # Tauri: starts the web dev server (HMR) + the native window
pnpm build:desktop    # production build → NSIS installer under apps/desktop/target/release/bundle
```

## How the desktop app works

The Tauri shell loads the `apps/web` SPA and exposes native capabilities through
Tauri plugins instead of a Node backend:

- **File I/O** — characters, settings, generated output, and the Poses-folder
  scan go through `@tauri-apps/plugin-fs`; the native file/folder pickers use
  `@tauri-apps/plugin-dialog`. The generation itself (`packages/rom`) is pure
  TypeScript and runs in the webview.
- **Two storage roots** — app-owned data (settings, the projects list, avatars)
  lives in the per-user app-data folder (`appLocalDataDir()`), so it survives app
  updates; your **characters** live in each **project's folder**, which you choose
  and back up.

The native boundary is concentrated in `apps/web/src/lib/rom/{api,storage}.ts`
and `lib/desktop.ts`, each `isTauri()`-guarded so the SPA still runs in a plain
browser (native features no-op there). That boundary is also what makes a future
online deployment — or web-only e2e that mocks the native layer — possible.

## Releases & auto-update

Versioning is [Changesets](../.changeset/); merging the auto-generated "version
packages" PR triggers a GitHub Release (NSIS installer + signed updater metadata)
built by `.github/workflows/release.yml`. Installed apps check for an update on
launch and self-update on the user's confirmation.

Full pipeline, signing-key, and branch-policy setup live in
[devops.md](./devops.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## More docs

- [devops.md](./devops.md) — release pipeline, signing keys, branch policy
- [poseasset-csv-spec.md](../apps/web/docs/poseasset-csv-spec.md) — the DazToHue PoseAsset import-CSV format, reverse-engineered from the HDA
- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to contribute
