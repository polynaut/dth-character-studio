# Architecture

Two-layer pnpm monorepo. The **generation core is pure TypeScript** and is where
the value lives; the apps are thin shells around it.

```
packages/rom   @dth/rom      pure generation core (no I/O, no framework)  ── consumed as source
packages/ui    @dth/ui       app-agnostic React UI kit (no Tauri/router)  ── consumed as source
apps/web       @dth/web      React 19 SPA (Vite + TanStack file-based Router)
apps/desktop   @dth/desktop  Tauri 2 shell (Rust) — loads apps/web, provides native access
```

All four are a **fixed version group** (one product version). `@dth/rom` and
`@dth/ui` export `src/index.ts` directly — Vite/tsc compile them inline; there is
no build step and no stale dist.

## packages/rom — the core

`Character` definition (zod-validated, `types.ts`) → `generateAll()`
(`generate.ts`) → the Daz `.dsa` ROM script + the Houdini PoseAsset CSV (+
optional Export/Hair/Scan scripts). Frame math and ROM walks live in `frames.ts`;
ground-truth CSV templates in `src/templates/`; character-JSON migrations in
`migrate.ts`; Daz morph-CSV import in `daz-csv.ts`; product-scan CSV parsing in
`product-scan.ts`; timeline blocks in `timeline.ts`; custom-section validation in
`validation.ts`. See `.ai/domain.md` for the domain model and the frame-math
invariant.

## packages/ui — the kit

Primitives (Button, Input, Select, Switch, Tabs, Modal, SidePanel, TooltipHost,
InfoPopup, NumberField…), presentational components (LinkedAssetCard,
KeyedListEditor, MultiSelect, Field, Tag, EditableTitle…), and hooks
(`useModifierHeld`, `installAltMenuGuard`, `useRefetchOnFocus`).
**No Tauri / router / filesystem imports** — host behavior is injected via
`UiConfigProvider` (`config.tsx`: `onNavigate`, `onOpenExternal`); the app
supplies it in `apps/web/src/routes/__root.tsx`. Single public entry
`src/index.ts` (export only what the app consumes). Tailwind reaches the kit via
`@source` in `apps/web/src/styles.css`.

## apps/web — the SPA

### Routes (`src/routes/`, file-based; `routeTree.gen.ts` is generated)

| Route | Purpose |
|---|---|
| `__root.tsx` | App shell: UiConfigProvider, ConfirmProvider, Toaster, TooltipHost, update-prompt host, native menu wiring, startup effects. |
| `index.tsx` | Home/launcher: recent `.dcsp` projects, create/open project (each opens its own native window). |
| `projects.$projectId.index.tsx` | Project overview: character grid/list, create character, attachments + notes tabs, Unreal footer. |
| `projects.$projectId.characters.$characterId.tsx` | **The character editor** (largest route) — draft/save/generate. |
| `settings.tsx` | Project tab (`.dcsp` manifest) + General (machine tool paths) + App Data. |
| `tools.tsx` | Daz/Houdini content install sections, dedup, danger zone, Refresh assets. |
| `about.tsx` | Version, asset staleness summary, links. |

**Key fact: the `$projectId` route param IS the project folder path.** One
project per native window; the window's `.dcsp` comes from `active_project_file`
and route loaders pin it via `setActiveProjectDir`.

### The lib/ layer — the native boundary

Everything native lives under `src/lib/**`, `isTauri()`-guarded (the SPA runs in
a plain browser with native features as no-ops):

- `lib/desktop.ts` — the Tauri seam: `openExternal`, window-close interception,
  native menu events, all file pickers, window commands.
- `lib/rom/api/` — the data layer. `api.ts` is a barrel; every route-facing
  function takes `{ data }` and zod-parses it at entry. Modules: `core.ts`
  (shared state: active project dir, pose catalog, caches), `characters.ts`
  (CRUD/imports/run-log), `projects.ts` (`.dcsp` lifecycle), `generate.ts`
  (artifact generation + `resolvePresetFrames` + staleness sweep), `install.ts`,
  `maintenance.ts`, `avatars.ts`, `attachments.ts`, `notes.ts`, `products.ts`,
  `native-types.ts` (the FFI zod schemas).
- `lib/rom/storage/` — filesystem persistence (plugin-fs): `settings.ts`
  (**`studioSettingsSchema`** — THE app-global settings definition),
  `projects.ts` (**`DcspManifest`** + recents), `characters.ts` (scan/CRUD +
  `moveCharactersRoot`), `runtime-install.ts` (`studioScriptsDir`,
  `copyRuntimeFiles` — installs the bundled `.dsa` runtime), `releases.ts`,
  `pose-assets.ts`, `network-drives.ts`, `assets.ts`, `fs.ts`, `app-data.ts`.
- `lib/updater.ts`, `lib/file-drop.ts` (Tauri drag-drop hit-testing),
  `lib/path.ts`, `lib/rom/migrate-projects.ts` (one-time pre-`.dcsp` upgrade).
- Editor machinery: `lib/use-character-draft.ts` (draft/baseline/dirty +
  save→generate→settle, single-flight `patchAndRegenerate`),
  `lib/use-unsaved-guard.ts` (router blocker + beforeunload + native ✕),
  `lib/use-confirm.tsx` (app-styled promise confirm).

### Data flow

Route loaders fetch via `api.ts`; mutations call api then `router.invalidate()`.
The character editor keeps a draft + baseline (`dirty` by JSON comparison);
`save()` = validate (`romValidationErrors`) → `saveCharacter` →
`generateCharacterFiles` → settle draft+baseline in one paint → invalidate in the
background.

## apps/desktop — the Tauri shell

Rust modules (`src/*.rs`): `lib.rs` (builder + `generate_handler!`), `windows.rs`
(multi-window: label→`.dcsp` map, single-instance routing, async window
creation), `install.rs`/`assets.rs`/`dedup.rs`/`uninstall.rs` (content install +
dedup + guarded cleanup), `poses.rs` (`.duf` frame counting/wearables),
`housekeeping.rs`, `daz.rs` (process probe/script bridge), `drives.rs` (network
drive remap), `foreground.rs`, `github.rs` (server-side GitHub API — webview CSP
blocks it), `archive.rs` (zip-bomb bounds), `content.rs`, `fsutil.rs`
(recursive-delete rails), `report.rs`, `contract_tests.rs`.

**FFI surface: 24 commands** registered in `generate_handler!` — installs
(`install_dth_release/plugin/daz_assets/daz_merge/houdini_presets/unreal_dth`),
scans (`list_daz_assets`, `scan_duf_files`, `pose_asset_frames`,
`scene_wearables`), dedup/uninstall, windows
(`open_project_window`/`open_home_window`/`active_project_file`), Daz bridge
(`daz_studio_running`/`run_daz_script`/`focus_app_window`), drives
(`unc_for_path`/`ensure_network_drives`), `housekeeping_sweep`,
`app_release_tags`, `unreal_dth_present`. Nearly all are
`#[tauri::command(async)]`; structured returns are camelCase serde structs pinned
by the `contracts/` fixtures (see `.ai/conventions.md` § FFI ritual).

Window creation must never run on the main thread from a sync command
(deadlock) — `windows.rs` documents the pattern. `tauri.conf.json`:
`"version": "package.json"`, `.dcsp` file association, NSIS bundle, updater
config + pubkey, strict CSP, `fs.requireLiteralLeadingDot: false`.

## The projects model

A **project** is a user-chosen folder marked by a single `.dcsp` manifest (JSON:
id/name/created + behavior defaults + opt-in flags). **No global registry** — the
folder's location is the project; the Home screen lists recents
(`recents.json` in app-data). The OS file association opens a `.dcsp` in its own
window (single-instance routes a second launch). Project folder holds the
character folders (under `charactersSubdir` when set), `.dcsmeta/` (avatars,
media), and `.assets/` (opt-in). App-data (`appLocalDataDir()`) holds only
machine state: `settings.json`, `recents.json`, `network-drives.json`, scan
output. Generated Daz scripts install to
`<Daz library>/Scripts/DTH-Character-Studio/<project>/<character>/`.
