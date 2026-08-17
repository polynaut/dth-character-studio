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
  ui/       App-agnostic React UI kit (@dth/ui) — primitives, components, hooks;
            no Tauri / router / filesystem imports (host behaviour is injected).
```

## Run — web

```sh
pnpm install
pnpm dev          # http://localhost:4330  (also bound on the LAN)
```

Other scripts: `pnpm build`, `pnpm --filter @dth/web preview`, `pnpm -r test`,
`pnpm -r typecheck`, `pnpm lint`, `pnpm --filter @dth/web smoke` (Playwright browser
smoke), `pnpm generate-routes`, `pnpm screenshots` / `pnpm clips` (user-guide
screenshots and webp clips), `pnpm build:guide` (renders `docs/guide` → `site/guide`
and validates guide links/assets). Run as a plain web build, the native file
features no-op — they require the Tauri desktop app.

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
- **Two storage roots** — machine-only app data (`settings.json`, the recently-
  opened `.dcsp` list, `network-drives.json`) lives in the per-user app-data
  folder (`appLocalDataDir()`); everything worth backing up — your **characters**,
  generated artifacts, and the app's own per-character bookkeeping and avatars
  (under the hidden `.dcsmeta/`) — lives in each
  **project's folder**, marked by its `.dcsp` file. There is no global project
  registry: a `.dcsp`'s location *is* the project.
- **Custom Rust commands** — heavy work beyond the plugins (asset install/dedup,
  avatar upscaling, launching Daz Studio and Houdini/hython, sweeping leftover
  NTFS junctions,
  multi-window projects) is `#[tauri::command]`s in per-feature modules under
  `apps/desktop/src/`, registered in `lib.rs`. Paths are resolved in TS, file
  work happens in Rust; structured returns are zod-parsed
  (`apps/web/src/lib/rom/api/native-types.ts`) and their wire format is pinned
  by the shared fixtures in `contracts/`.

The native boundary is concentrated in `apps/web/src/lib/rom/api/*` + `storage/*`
(re-exported through the `api.ts` / `storage.ts` barrels) and `lib/desktop.ts`,
each `isTauri()`-guarded so the SPA still runs in a plain
browser (native features no-op there). That boundary is also what makes a future
online deployment — or web-only e2e that mocks the native layer — possible.

## Releases & auto-update

Versioning is [Changesets](../.changeset/); merging the auto-generated "version
packages" PR triggers a GitHub Release (NSIS installer + signed updater metadata)
built by `.github/workflows/release.yml`. Installed apps check for an update on
launch and self-update on the user's confirmation.

Full pipeline, signing-key, and branch-policy setup live in
[devops.md](./devops.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Claude Code commands & skills

The repo ships its own [Claude Code](https://claude.com/claude-code) commands
(`.claude/commands/*.md` — single-prompt slash commands) and skills
(`.claude/skills/<name>/SKILL.md` — multi-step walkthroughs). They encode this
repo's rituals so no session has to rediscover them: type the slash name in a
Claude Code session started at the repo root. The authoritative description of
each lives in its file's frontmatter; this table is the map.

| Command | What it does |
| ------- | ------------ |
| `/grill` | Adversarial staff-engineer review of the branch diff — verdict SHIP IT / NEEDS WORK / BLOCK, re-reviewed after fixes until everything is resolved. |
| `/verify` | Runs the full verification gate in order (typecheck, lint, tests, smoke, cargo) and fixes what fails. |
| `/write-pr` | The house style for PR descriptions — structure, tone, and naming what was and wasn't verified. |
| `/dep-release` | Puts already-merged dependency bumps on the release train — Dependabot PRs carry no changesets, so product-relevant bumps never release themselves. |
| `/refresh-docs` | Brings `docs/guide` back in step with the code. It **proposes** what shipped undocumented and asks which of it to document and at what depth (one line / paragraph / section / page) before writing a word, refreshes or proposes screenshots, deletes what no longer applies, and holds every page to a word budget — a pass that only added is a failed pass. |
| `/upgrade-dth` | Walkthrough for a new **DazToHue** release: every studio↔DTH coupling surface (PoseAsset CSV era, HDA node/parm names, the Exporter Plugin contract, preset assets, install layout) as contract → check → adjust, with the tests that pin each. |
| `/upgrade-daz` | Walkthrough for a new **Daz Studio**: flavor detection and its closed DS4/DS6 world, the Runner plugin's SDK/ABI rules, the emitted-DazScript quirk ledger, and the process/launch hardcodes. |
| `/upgrade-houdini` | Walkthrough for a new **Houdini**: pairing the new install with its fresh (empty!) prefs folder and reinstalling the DTH assets there, then the hython/Python/env assumptions. |

The `upgrade-*` trio exists because those details fade between releases: each
skill was built from a measured code sweep, and each run is expected to
re-stamp the "measured against" versions and fold what the new release changed
back into the skill.

When to reach for which: `/verify` before pushing, `/grill` before merging
anything non-trivial, `/write-pr` when opening the PR, `/refresh-docs` after a
run of feature merges, `/dep-release` after merging Dependabot PRs, and the
`upgrade-*` trio when the corresponding external release ships.

## More docs

- [devops.md](./devops.md) — release pipeline, signing keys, branch policy
- [release-checklist.md](./release-checklist.md) — the release checklist
- [exporter-plugin-job-file.md](./exporter-plugin-job-file.md) — the DTH Exporter job-file contract
- [guide/README.md](./guide/README.md) — the user guide source (rendered by `pnpm build:guide`)
- [poseasset-csv-spec.md](../apps/web/docs/poseasset-csv-spec.md) — the DazToHue PoseAsset import-CSV format, reverse-engineered from the HDA
- [CONTRIBUTING.md](../CONTRIBUTING.md) — how to contribute
