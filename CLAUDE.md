# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DTH Character Studio: a declarative tool for the **DazToHue** (Daz Studio → Houdini → Unreal)
workflow. From one character definition it generates **both** sides of a Range of Motion (ROM):
a Daz Studio apply-script (`.dsa`) and the Houdini **PoseAsset** import CSV. Ships as a Tauri 2
desktop app on Windows; the frontend also runs standalone in a browser.

## Commands

Package manager is **pnpm** (workspace monorepo). Run from the repo root:

```sh
pnpm install
pnpm dev                 # web SPA only → http://localhost:4330 (native features no-op in a browser)
pnpm dev:desktop         # Tauri app: web dev server (HMR) + native window. Needs Rust (rustup) + WebView2
pnpm build               # web production build
pnpm build:desktop       # NSIS installer → apps/desktop/target/release/bundle
pnpm -r test             # all JS tests (vitest)
pnpm --filter @dth/web smoke  # Playwright browser smoke — the real SPA against an in-memory fake
                              # of the native layer (apps/web/smoke; specs are *.smoke.ts)
pnpm -r typecheck        # tsc --noEmit across packages
pnpm lint                # oxlint (type-aware) — the CI lint gate; `pnpm lint:fix` autofixes
pnpm generate-routes     # regenerate apps/web/src/routeTree.gen.ts (tsr generate)
pnpm changeset           # add a changeset (required on every feature PR; see Releases)
```

Per-package / single test (vitest):

```sh
pnpm --filter @dth/web test                         # one package's tests
pnpm --filter @dth/rom test src/daz-csv.test.ts     # a single test file
pnpm --filter @dth/rom test -t "<test name>"        # filter by test name
```

Rust (desktop crate, `apps/desktop`): `cargo check`, `cargo test`. The shell here is **PowerShell**
(a Bash tool is also available); use the right syntax for each.

## Architecture

Four workspace packages, two layers — the generation core is pure TypeScript and is where the
value lives; the apps are thin shells. Two packages (`@dth/rom`, `@dth/ui`) are pure and
app-agnostic; all consumed **as source** (their `exports` point at `src/`, so Vite/tsc compile them
inline — no build step, no stale `dist`).

- **`packages/rom` (`@dth/rom`)** — framework-agnostic, **no I/O**. The full pipeline: a `Character`
  definition (`types.ts`, zod-validated) → `generateAll()` (`generate.ts`) → the Daz `.dsa` script
  text + the Houdini PoseAsset CSV. The frame math + ROM walks (the core invariant's computation)
  live in `frames.ts`; ground-truth CSV/`.dsa` templates in `src/templates`. Also parses
  DAZ-exported morph CSVs into poses (`daz-csv.ts`).
- **`packages/ui` (`@dth/ui`)** — app-agnostic React UI kit: primitives (button, input, select…),
  presentational components (`LinkedAssetCard`, `KeyedListEditor`, `Tag`, `Field`…), and hooks
  (`useModifierHeld`, `installAltMenuGuard`, `useRefetchOnFocus`). **No Tauri / router / filesystem
  imports** — host behaviour (link navigation, external-open) is injected via `UiConfigProvider`
  (see `config.tsx`), so a future online build can reuse it. The desktop app supplies the config in
  `routes/__root.tsx`. Tailwind scans it via an `@source` in `apps/web/src/styles.css`.
- **`apps/web` (`@dth/web`)** — React SPA (Vite + TanStack **file-based** Router). Routes in
  `src/routes`; UI runs the pure `@dth/rom` generation in the webview and composes `@dth/ui`.
- **`apps/desktop` (`@dth/desktop`)** — Tauri 2 shell (Rust, `src/lib.rs`). Loads `apps/web` and
  provides native file/dialog/updater access instead of a Node backend.

### The core invariant (do not break)

**Frame numbers are never stored.** They are computed from section/group/pose order at generation
time, so the Daz and Houdini outputs cannot drift out of sync — that synchronization *is* the
product. A ROM is a fixed sequence of eight sections in canonical order:
`RET, JCM, FAC, EXP, GEN, PHY, FBM, MISC` (`ROM_SECTIONS` in `types.ts`). Each section is enabled or
not and runs in `preset` or `custom` mode. When changing generation, preserve the property that the
two artifacts are derived from the same source and stay frame-aligned.

### The native boundary

Native access lives in the **`lib/` layer**, not in routes/components: primarily
**`apps/web/src/lib/rom/{api,storage}.ts`** + **`lib/desktop.ts`** (the bulk of it), plus a few
focused helpers that legitimately touch Tauri APIs — `lib/updater.ts`, `lib/file-drop.ts`,
`lib/path.ts`, `lib/rom/migrate-projects.ts`, and the app shell (`routes/__root.tsx`, `main.tsx`).
Each is `isTauri()`-guarded so the SPA still runs in a plain browser (native features no-op there —
which is also what a future online deployment or a web-only e2e mock of this layer would rely on).
UI code opens external links via `desktop.openExternal`, never `@tauri-apps/plugin-shell` directly.
`api.ts` is the primary bridge between the React UI and the filesystem; it keeps the `{ data }` call
convention the routes use, validates input with zod, and `invoke()`s Rust commands. When adding a
native capability, follow the existing pattern: **resolve paths in TS, do heavy file work in Rust**.

Rust commands (`apps/desktop/src/lib.rs`) take camelCase serde structs (`#[serde(rename_all = "camelCase")]`),
must be registered in the `generate_handler!` list, and are gated `#[cfg(desktop)]` when they use
desktop-only deps (updater/process/reqwest live under the non-android/ios target block in `Cargo.toml`).
Structured command RETURNS are parsed through the zod schemas in `api/native-types.ts` (never a bare
`invoke<T>()` cast), and their wire format is pinned by shared fixtures in `contracts/` (repo root):
serde round-trip in `apps/desktop/src/contract_tests.rs` + zod parse in `api/native-contract.test.ts`.
A new structured return = a schema + a fixture + a test case on both sides.

### Projects are `.dcsp` files (one active project per window)

A **project** is a user-chosen folder marked by a single **`.dcsp`** manifest (JSON: id, name,
created, + per-project behaviour defaults `dazSubdir`/`houdiniSubdir`/`createHoudiniSubdir`, and the
opt-in `assetsEnabled` flag + `charactersSubdir` root — see below). There is
**no global registry** — a folder's location *is* the project. The OS file association opens a `.dcsp`
in its **own window** (single-instance routes a second launch into a new window; see `lib.rs`
`open_project_window`/`active_project_file`). Routes still use `/projects/$projectId`, but `projectId`
is now the **project folder path** (the route param), resolved to a record via `storage.readManifest`.
The active folder for a window is pinned by the project/character route loaders via
`api.setActiveProjectDir` (used by avatar resolution); the launcher reads it from `desktop.activeProjectFile`.

- **Project folder** (backed up by the user): the `.dcsp`, the character folders (under
  `charactersSubdir` when set, e.g. `<dir>/assets/characters/<Name>/`, else directly `<dir>/<Name>/` →
  `<Name>.json` + generated artifacts), a hidden **`.dcsmeta/images`** for avatars, and `.assets/` for
  project-scoped Daz-scene assets (only when `assetsEnabled`).
- **App-data folder** (`appLocalDataDir()`, volatile/machine-only): `settings.json` (machine/tool
  paths), `recents.json` (recently-opened `.dcsp` list, the Home screen's source), and
  `network-drives.json`. No project registry, no avatars, no global assets — assets are per-project only.

A character's generated Daz script still goes to
`<My DAZ 3D Library>/Scripts/DTH-Character-Studio/<project>/<character>/`; the shared DTH runtime is
installed once at that root (`storage.ts`: `studioScriptsDir` / `copyRuntimeFiles`).

Upgrading from the pre-`.dcsp` model (old `projects.json` + `app-data/images`) is a one-time automatic
migration on first launch (`lib/rom/migrate-projects.ts`), then the legacy files are removed.

### Settings flow

Two scopes now:
- **App-global** (`settings.json`, machine/tool paths) → ONE tolerant zod schema,
  `studioSettingsSchema` in `storage/settings.ts`, is the single source of the field list, the
  defaults (`parse({})` = fresh install) and the validation on BOTH the settings.json read and the
  save input. Adding one = add the schema field + its UI in the Settings route. Settings/Tools gate
  "save before action" on a `dirty` flag — include a new field there or its value never reaches disk.
- **Per-project** (the `.dcsp` manifest: `dazSubdir`/`houdiniSubdir`/`createHoudiniSubdir` +
  `assetsEnabled`/`charactersSubdir`) → the `DcspManifest` type + `readManifest`/`writeManifest` in
  `storage.ts`, saved via `api.saveProjectSettings` and edited from the **Settings → Project tab**
  (shown only inside a project window). `assetsEnabled` is opt-in (default off → characters only).
  Changing `charactersSubdir` is **destructive**: `saveProjectSettings` calls
  `storage.moveCharactersRoot` to physically move existing character folders to the new root (and
  repoint their scene/Houdini paths) before writing the manifest.

## Conventions & gotchas

- **Import alias:** `#/*` → `apps/web/src/*` (see `imports` in `apps/web/package.json`).
- **Routing:** routes are file-based; `routeTree.gen.ts` is generated. Adding/removing a route **file**
  requires `pnpm generate-routes` (adding a tab inside an existing route does not).
- **Versioning:** Changesets. `@dth/web` / `@dth/desktop` / `@dth/rom` / `@dth/ui` are a **fixed
  group** — one product version, bumped in lockstep. Every feature PR needs a changeset (a CI check
  enforces this; a docs/CI-only PR can satisfy it with `pnpm changeset --empty`).
- **Character-schema changes:** the persisted `Character` shape is versioned by
  `CHARACTER_SCHEMA_VERSION` (`packages/rom/src/types.ts`); old JSONs are migrated on read by
  `migrateCharacterData` (`packages/rom/src/migrate.ts`). To change the shape: edit `characterSchema`,
  bump the constant + add a History line, add a `migrate.test.ts` case. Add a `characterMigrations[N]`
  **step** ONLY for a rename/restructure or a **computed** value — an additive field with a zod default
  and a removed field need no step (zod fills/strips them); a value needing host context (settings, fs,
  active DTH release) resolves in web `parseCharacter` like `canonicalImage`, never in the pure core.
  Steps are pre-zod, idempotent, and guard on `=== undefined`. Tools → Refresh assets migrates +
  re-saves stale definitions. **Full decision tree + copy-paste templates live atop `migrate.ts`** —
  read it before touching the schema.
- **Dependabot merges don't release themselves** — its PRs are exempt from the changeset gate, so
  product-relevant bumps (Rust crates, runtime npm deps) sit unreleased until a changeset follows.
  The `/dep-release` skill (`.claude/skills/dep-release`) finds them and cuts the patch release.
- **Releases are automated** (don't tag/publish by hand): feature PR + changeset → `main` → the
  **Version** workflow opens a "version packages" PR → merging it triggers the **Release** workflow
  (NSIS installer + signed updater `latest.json`). The Tauri version is read from
  `apps/desktop/package.json`. See `docs/devops.md`.
- **`main` is PR-only** — branch off `main` (`feature/…`, `fix/…`); no direct pushes.
- **Cargo.lock pins** `alloc-stdlib = 0.2.2` + `alloc-no-stdlib = 2.0.4` (newer breaks brotli 8 via
  Tauri's asset compression). Don't `cargo update` them back; re-pin if reverted (see `docs/devops.md`).
- **Don't rewrite users' downloaded Daz assets.** The dedup/install features may only *move* redundant
  copies (quarantine) or choose which version installs — never edit the contents of a downloaded asset.

## Key docs

- `docs/development.md` — run/build/architecture
- `docs/devops.md` — release pipeline, signing keys, branch policy
- `apps/web/docs/poseasset-csv-spec.md` — the DazToHue PoseAsset CSV format (reverse-engineered from the HDA)
