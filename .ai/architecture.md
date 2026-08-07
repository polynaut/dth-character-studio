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
optional Export/Hair/Scan scripts, + a scene-suffixed CSV per ROM-override
scene). The ONE ROM script embeds every scene's overrides and selects the open
scene at run time (no per-scene scripts). `generate.ts` is a **barrel** over the
split generation modules: `resolve.ts` (catalog/path resolution, FAC support via
`facPresetSupport`, `presetFramesSignature`), `csv.ts` (the CSV pipeline +
template splice + `templateBakedPoseNames`), `dsa.ts` (the `.dsa` generators),
`dz-snippets.ts` (embedded DzScript text, package-internal). Frame math and ROM
walks live in `frames.ts`; per-scene override merge/slug/gate in `scene-override.ts`;
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
`UiConfigProvider` (`config.tsx`: `onNavigate`, `onOpenExternal`, `onError`); the app
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
| `projects.$projectId.characters.$characterId.tsx` | **The character editor** — draft/save/generate. Decomposed: the route (~640 lines) composes `components/character/*` sections (editor-header — which hosts the DTH Export dialog, `dth-export.tsx` — identity, scripts, export-settings, rom-editor, operations-section, rom-run-log-report, scene-footer, frame-zero/preserve/groom fields) + `components/houdini-projects-field.tsx` + `lib/use-scene-selection` / `use-rom-run-log` / `character-paths`. The ROM subtree (`RomSections`/`PoseGroupsEditor`/`GroupCard`) is `React.memo`d with latest-ref, id-routed callbacks — new props into it must keep stable identities or the memo chain silently dies. |
| `settings.tsx` | Project tab (`.dcsp` manifest) + General (machine tool paths) + App Data. |
| `tools.tsx` | Three tabs, **Scan & index** first and the default (`ProjectScanSection`, `components/tools/project-scan-section.tsx`; a plain `/tools` lands here, `?tab=install` / `?tab=refresh` address the others), then install (Daz/Houdini content install sections, dedup, danger zone), then Refresh assets. |
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
  (artifact generation + `resolvePresetFrames` + staleness sweep), `execute.ts`
  (the DTH Exporter job-file handoff + Daz launch — pure parts in
  `lib/rom/execute-jobs.ts`, contract in `docs/exporter-plugin-job-file.md`),
  `houdini.ts` (Generate project via hython + the leftover-junction sweep),
  `install.ts`, `maintenance.ts`, `avatars.ts`, `attachments.ts`, `notes.ts`,
  `products.ts`, `move.ts` (the shared folder-move lock gate: `assertMovable`
  throws `LockedFilesError` off `probeLockedFiles`), `data-url.ts`,
  `native-types.ts` (the FFI zod schemas).
- **Two job-file handoffs, deliberately the same shape** — the studio writes a
  JSON job, the other side works through it and writes results back, the studio
  polls. Daz's is `execute.ts` + `execute-jobs.ts` (the Runner plugin). Houdini's
  is `lib/rom/houdini-jobs.ts` + `lib/rom/houdini-runtime/456.py`, which Houdini
  runs after a scene loads when the studio's folder is on `HOUDINI_SCRIPT_PATH`
  and `DTH_HOUDINI_JOB` points at a job — driven by `api/houdini.ts`
  (`startHoudiniExport` / `fetchHoudiniRunProgress`) and Rust
  `launch_houdini_job`/`houdini_running`. **Live since v0.59** — the DTH Export
  dialog's Houdini list continues a Daz batch straight into Houdini (sequential
  multi-project queue: `startHoudiniQueue` in `components/character/dth-export.tsx`;
  see `.ai/domain.md` § the Houdini export handoff).
- `lib/rom/run-log.ts` — pure per-scene run-log parsing/merge (log v2:
  `parseRomRunLogText`, `mergeRomRunLogs`, `unreadableRomRunLog`), consumed by
  `api/characters.ts`; tested in `lib/rom/run-log-multi-scene.test.ts`.
- `lib/rom/storage/` — filesystem persistence (plugin-fs): `settings.ts`
  (**`studioSettingsSchema`** — THE app-global settings definition),
  `projects.ts` (**`DcspManifest`** + recents), `characters.ts` (scan/CRUD +
  `moveCharactersRoot`), `runtime-install.ts` (`studioScriptsDir`,
  `copyRuntimeFiles` — installs the bundled `.dsa` runtime), `script-icons.ts`
  (Content Library artwork written beside each generated script),
  `houdini-env.ts` (the `DAZ3D_LIB` upsert into each Houdini docs folder's
  `houdini.env`), `releases.ts`, `pose-assets.ts`, `network-drives.ts`,
  `assets.ts`, `fs.ts`, `app-data.ts`.
- `lib/updater.ts`, `lib/file-drop.ts` (Tauri drag-drop hit-testing),
  `lib/path.ts`, `lib/rom/migrate-projects.ts` (one-time pre-`.dcsp` upgrade).
- Editor machinery: `lib/use-character-draft.ts` (draft/baseline/dirty +
  save→generate→settle, single-flight `patchAndRegenerate`),
  `lib/use-unsaved-guard.ts` (router blocker + beforeunload + native ✕),
  `lib/use-confirm.tsx` (app-styled promise confirm), `lib/use-folder-move.tsx`
  (the locked-files dialog + retry loop wrapping every folder move, catching
  `LockedFilesError` from `api/move.ts`).

### Data flow

Route loaders fetch via `api.ts`; mutations call api then `router.invalidate()`.
The character editor keeps a draft + baseline (`dirty` by JSON comparison);
`save()` = validate (`romValidationErrors` on the base sections AND on each
ROM-override scene's merged sections — `sceneOverrideBuildsRom`) → `saveCharacter` →
`generateCharacterFiles` → settle draft+baseline in one paint → invalidate in the
background. The editor's page-local **selected scene** (the Daz scene cards)
drives every per-scene feature: the hair list, the implicit per-scene overrides
(edit-to-override — ROM frames, the G9 identity dials, preserve items), and — with
more than one scene linked — the header's scene tag. It also scopes the run-log
report's red frame markers (clicking a failure selects its scene first —
`revealFailure` in the route) and filters the Morph-name autocomplete to entries
scanned from that scene (`components/rom/morph-index-provider.tsx`).

## apps/desktop — the Tauri shell

Rust modules (`src/*.rs`): `lib.rs` (builder + `generate_handler!`), `windows.rs`
(multi-window: label→`.dcsp` map, single-instance routing, async window
creation), `install.rs`/`assets.rs`/`dedup.rs`/`uninstall.rs` (content install +
dedup + guarded cleanup), `poses.rs` (`.duf` frame counting/wearables + base-figure detection),
`housekeeping.rs`, `daz.rs` (process probe/script bridge), `houdini.rs` (hython
project generation + the Houdini job launcher), `houdini_material.rs` (the
material-utility runner: drives `material_utils.py` under hython and returns its
typed report), `avatar.rs` (avatar image
up/downscale), `shellopen.rs` (Explorer-delegated file open — the launched app
inherits the pristine user-session environment, not the studio's),
`elevation.rs` (elevated-session detection + the title prefix below),
`drives.rs` (network
drive remap), `foreground.rs`, `github.rs` (server-side GitHub API — webview CSP
blocks it), `archive.rs` (zip-bomb bounds), `content.rs`, `fsutil.rs`
(recursive-delete rails + `move_tree`, the one mover shared by dedup's
quarantine and the export-root migration), `junction.rs` (the removal sweep for
the retired junction feature — reparse-point-verified, creation survives only
as a test helper), `exports.rs` (moving a character's exported files to
the fixed export root), `report.rs`, `testutil.rs`, `contract_tests.rs`.

A project window's **native title is `"<.dcsp stem> — DTH Character Studio"`** —
derived from the `.dcsp` *filename*, set at creation. An **elevated** session
prefixes every title with `Administrator: ` (`elevation.rs`, Windows' own
convention — a prefix survives truncation in the taskbar/Alt-Tab where a suffix
would not). It matters because an elevated session behaves differently in ways
nothing else shows: mapped network drives are per-session so its drive letters
are absent (drives.rs), and files it creates get an elevated owner. Every title
goes through `window_title()`, which is idempotent — the startup pass re-titles
the config's `main` window from its CURRENT title (that one never passes through
the builders), and a rename re-titles an already-marked window. Renaming a project
(`api/projects.renameProject`) therefore renames the `.dcsp` file too
(`storage.renameManifestFile`) and calls `sync_renamed_project_window` to
live-re-title + re-pin every open window on the old file (no close/reopen).

**FFI surface: 36 commands** registered in `generate_handler!` — installs
(`install_dth_release/plugin/daz_assets/daz_merge/houdini_presets/unreal_dth`),
scans (`list_daz_assets`, `scan_duf_files`, `pose_asset_frames`,
`scene_wearables`), dedup/uninstall, windows
(`open_project_window`/`active_project_file`/`sync_renamed_project_window`/
`release_project_window` — the last unpins a window after its project is deleted
so it continues as a Home window; the home window opens via the native menu's
Rust-side `open_home_window_impl`, no command), Daz bridge
(`daz_studio_running`/`run_daz_script`/`launch_daz_studio`/`focus_app_window` —
`launch_daz_studio` starts a scene-less Daz for the Execute job-file handoff,
see `docs/exporter-plugin-job-file.md`), drives
(`unc_for_path`/`ensure_network_drives`), avatars
(`upscale_avatar_file`/`downscale_avatar_png`), `shell_open_file`,
`housekeeping_sweep`,
`app_release_tags`, `unreal_dth_present`, `probe_locked_files`, and the Houdini
side (`create_houdini_project`, `remove_junction` — the best-effort sweep of
leftover `dth-exports` junctions from the retired feature —
`launch_houdini_job`/`houdini_running` for
the "Export too" handoff, `run_houdini_material_util` (scan a set of `.hip`
files for DazToHueMaterial nodes / transfer one node's texture bakers onto
others — the Houdini card's **Utils** drawer), plus `move_exports` for the v29
migration).
Nearly all are
`#[tauri::command(async)]`; structured returns are camelCase serde structs pinned
by the `contracts/` fixtures (see `.ai/conventions.md` § FFI ritual).

Window creation must never run on the main thread from a sync command
(deadlock) — `windows.rs` documents the pattern. `tauri.conf.json`:
`"version": "package.json"`, `.dcsp` file association, NSIS bundle, updater
config + pubkey, strict CSP, `fs.requireLiteralLeadingDot: false`, and
`bundle.resources` shipping the **DTH Character Studio Runner** plugin DLLs
(`resources/dth-runner/` — staged at build time from the
polynaut/dth-character-studio-runner repo's latest release by
`scripts/fetch-runner.mjs` via `beforeBuildCommand`; installed from Settings
into `<Daz install>/plugins`, DS4 vs DS6 detected from the DAZStudio exe).

## The projects model

A **project** is a user-chosen folder marked by a single `.dcsp` manifest (JSON:
id/name/created + behavior defaults + opt-in flags). **No global registry** — the
folder's location is the project; the Home screen lists recents
(`recents.json` in app-data). The OS file association opens a `.dcsp` in its own
window (single-instance routes a second launch). Project folder holds the
character folders (under `charactersSubdir` when set), `.dcsmeta/` (avatars,
media, per-character app files), and `.assets/` (opt-in). App-data (`appLocalDataDir()`) holds only
machine state: `settings.json`, `recents.json`, `network-drives.json`,
the morph/bone index (`morphs_<G>.json` +
`morphs_scenes_<G>.json`, read by `api/characters.ts`), scan output
(`product-scans/`, `scan-frames/`), and `houdini-scripts/` — where `456.py` is
rewritten before every Houdini run (`houdini-jobs.ts`). Generated Daz scripts install to
`<Daz library>/Scripts/DTH-Character-Studio/<project>/<character>/`.

### Where the app's own per-character files live

`.dcsmeta/characters/<library-relative character folder>/` — `characterMetaDir`
in `storage/projects.ts`. Everything the studio writes FOR ITSELF about one
character: `.dth_execute_stamps.json`, `.dth_export_folders.json`,
`.last_rom_run.json`, the Daz-written `dth_rom_run_log.json` transport, the
generated `<Name>_pose_asset.csv` (plus per-scene variants), `products.json`
(since v0.68), and `detected-ignore.json` (the new-file wizard's permanent skip
list). They all sat in the character folder root until v0.68, mixed in
with the user's scenes and `.hip`s (`products.json`'s data sat on the definition).

Three consequences worth knowing before touching this:

- **The key is the character's folder path relative to the CHARACTERS ROOT**, not
  the project — so changing `charactersSubdir` (which physically moves every
  character folder) needs no meta-side work at all. A character folder RENAME or
  MOVE does: `saveCharacter`, `moveCharacter` and `deleteCharacter` carry/remove
  it via `moveCharacterMetaDir`. A loose definition at the library root owns no
  folder and falls back to its id.
- **Two of these paths are baked into the generated `.dsa`** — the CSV the export
  block copies (`dthCsvSrcDir`) and the runtime's `runLogPath`. That is the whole
  reason `dsa.ts` takes a `metaDirAbs` (it used to be `charFolderAbs` and mean the
  character folder). Changing where they live means bumping `RUNTIME_VERSION`, or
  no installed script ever learns the new path.
- **The one-time relocation rides generation** (`migrateCharacterInternals` in
  `api/generate.ts`), which is why the v59 runtime bump matters twice: it makes
  every character stale, so one Refresh assets walks the whole library and moves
  the files. It only ever touches names the studio itself writes for THAT
  character (`relocatableInternals`) — never a `*_pose_asset.csv` pattern, which
  would also match a CSV the user copied back out of an export folder.

### Houdini project scans are CACHED and checked

- **Two stores, one format** (`lib/rom/houdini-project-cache.ts`): a character's
  own projects in its `.dcsmeta` folder, everything else (the Utils drawer's
  template SOURCES, routinely outside any character) in one shared app-data file.
  Keyed on `<path>|<mtime>`, so a `.hip` saved in Houdini invalidates itself.
  Pruning is opt-in — the character store drops unlinked projects; the source
  store is cumulative on purpose, since a template stays cached across the
  characters it is copied into.
- **`scanCharacterHoudiniProjects` is the only thing that scans a character's own
  projects UNPROMPTED.** Character-folder projects ONLY (a project linked from
  the user's own tree has no `$JOB` expectation and no repair), a worker pool
  capped at 2 hython processes, coalesced per character, and silent — a
  background job must never toast at somebody who didn't ask. Store writes are
  serialized per file and fold into a fresh read (`queueScanStoreWrite`): a scan
  holds no store open across its hython run, so two workers finishing together
  append instead of last-writer-wins.
- **The drawer reads the store** (`fetchCachedHoudiniScans`) **and scans only
  what it doesn't cover** — an outside-folder link (never swept), a `.hip` saved
  since the last sweep — then merges, so a partial cache never hides a linked
  project from the node lists or the repairs. Target scans pass the character
  scope, so drawer-earned results land in the character's store, not the shared
  source store — including an outside link's, which the sweep's prune keeps
  (the keep-list is everything still LINKED), so it costs one scan, not one per
  open. It briefly POLLED for the sweep instead; that is wrong, because
  waiting is only safe if a sweep is guaranteed to deliver and it is not
  (external project, no Houdini configured).
- **The cache may never fail a scan.** Resolving the store path was once
  unguarded and took the drawer's whole project list down with it. A broken cache
  degrades to "no cache", never to "no scan".
- **`validateHoudiniProject`** (`lib/rom/houdini-validate.ts`) is a pure function
  over the scan the studio already has — `$JOB`, `refs.broken`,
  `prefill.fillable`. An UNSCANNED project is never a fault (else every page load
  flashes warnings), and an unreadable one reports only that. It does NOT cover
  material textures: `refs.broken` is deliberately scoped to the DazToHue import
  parms, because a healthy project reports several of Houdini's own scratch files
  as missing.
- **That check is what unlocked COPYING a project** (`copyHoudiniProject`,
  api/houdini.ts). It was refused for years because a copy carries the source's
  `$JOB` and absolute references; it is offered now because the card flags
  exactly that and the drawer repairs it. Only the scene file moves — `backup/`,
  `geo/`, `render/` are `$HIP`-relative output belonging to the project it was
  produced in.

### New-file detection

Files saved into the character's folder (an outfit variant `.duf`, a new `.hip`)
surface as a banner + add wizard instead of waiting for a manual pick/drop.

- **The rule is pure subtraction** (`lib/rom/detected-files.ts`, vitest-covered):
  everything on disk minus generated trees (`dth-exports/`, `rom-animations/`,
  `*_ROM.duf`, Houdini `backup/`, `.dcsmeta/`), minus the LIVE draft's linked
  lists, minus the permanent skip list. Stateless, so rescanning on every window
  focus (`lib/use-detected-files.ts`) is idempotent — which is what lets the
  wizard's page list update live while it is open.
- **The skip list** is `detected-ignore.json` in the character's `.dcsmeta`
  folder (folder-relative paths, tolerant parse, atomic write). Skip is
  PERMANENT; the banner's ✕ is session-only. A manual pick/drop of a skipped
  file still works — the list only mutes DETECTION.
- **An unreachable character folder throws** in `fetchDetectedFiles` rather than
  answering "no files" (the walk tolerates unreadable SUBfolders); the hook
  keeps the last answer on error, so a share blip cannot blank the banner.
- **Detection is PROJECT-WIDE as well** (`fetchProjectDetectedFiles` +
  `ProjectDetectedFilesBanner`, mounted at the root). The per-character hook only
  runs while that page is mounted, so a Save As while the studio showed the
  project page went unnoticed (#740). The root banner adds nothing itself — Open
  navigates to the owning character, whose wizard does the work — and excludes
  the character already on screen. Focus REGAIN only: firing on mount would make
  every launch pay for a whole-project walk before the first paint.
- **One native walk, not one per character.** `scan_files_by_ext` (fsutil.rs)
  walks a whole tree in ONE call with the generated directories pruned before
  descending — `DirVisitor::skip_dir`, additive with a `false` default and
  distinct from an `Err` from `enter_dir`, which aborts the walk instead of
  pruning a subtree. A JS `walkFiles` costs a readDir IPC PER DIRECTORY, which
  is what made a per-focus project sweep untenable on a share; the per-character
  scan uses the native call too. Attribution back to owners is pure
  (`attributeToOwners`) and LONGEST-folder-wins, so a character nested inside
  another keeps its own files.
- **The wizard links through the same builders as `DazSceneField`**
  (`lib/scene-add.ts`: `addScenePatch` / `primaryLinkPatch` /
  `useSceneAddValidation`) — extracted, not copied, so linking rules (hair
  seeding, GEN/gender/genesis derivation, the not-already-linked check) cannot
  drift. Scenes and `.hip`s are linked IN PLACE — they already live where they
  belong, unlike the pick/drop flows which may import from outside.

### Daz product scanning (v0.68: unattended)

- **`settings.dimManifestsFolder` arms it, not `project.dazProductsEnabled`.**
  That folder IS the product database, so it is the only prerequisite; the
  per-project toggle now decides ONLY whether the character page shows the
  Products tab. Both `generateCharacterFiles` (which emits the scan config +
  `Scan_Products_<Name>.dsa`) and `fetchProjectScanPlan` read the folder.
- **The results are per SCENE, in `products.json`.** `lib/rom/character-products.ts`
  owns the file shape and `withScans` — a pickup REPLACES the scenes it carries
  and leaves the rest, the same rule the ROM run log follows. Storing the merged
  view instead would let a one-scene re-scan wipe five scenes' products; the merge
  (`mergedProducts`) happens on read, for display only.
- **The pickup deletes its input.** `ingestProductScans` (api/products.ts) parses
  every CSV in the app-data drop folder, writes the store, and only THEN removes
  the CSVs it consumed. A CSV that won't parse is left alone — it may be a partial
  write Daz is still finishing. Runs from `fetchProductScan` (route load + focus,
  `ingest: false` on hover-preload), the Refresh sweep, and the Tools scan's
  completion (`ingestProjectProductScans`).
- **Schema v30 dropped `products`/`productsUnmatched`/`productsScannedAt`.**
  `carryStoredProductsToMeta` reads the RAW definition and writes the store
  before the save that strips them — so it must run BEFORE `storage.saveCharacter`
  at both save sites (`api.saveCharacter`, the Refresh sweep's schema re-save).
