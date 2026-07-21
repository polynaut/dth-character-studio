# Conventions & rituals

The non-obvious "how we do things here". CLAUDE.md has the short version; this is
the reference.

## Repo mechanics

- **pnpm workspace monorepo**, `packageManager: pnpm@9.1.4`, **Node ≥ 24**.
  `@dth/rom` and `@dth/ui` are consumed **as source** (`exports` point at
  `src/index.ts`) — no build step, no stale dist.
- **Import alias:** `#/*` → `apps/web/src/*` (declared in `apps/web/package.json`
  `imports`).
- **`main` is PR-only** (active ruleset: PR required + no force-push/deletion;
  required checks: `validate` + `rust` + `smoke` + `changeset`). Branch
  `feature/…` / `fix/…` / `docs/…`. Squash merges. The `changeset` job runs on
  EVERY PR and exempts Dependabot/the version PR INSIDE the job (reporting
  success, not skipped) — a required check that never reports would block the
  merge as "Expected" forever.
- **Lint gate is oxlint** (type-aware): `pnpm lint` from the **repo root**.
  Notable: `typescript/no-floating-promises` is an **error**, `import/no-cycle`
  is an error; promise rules are relaxed in tests. Config: `.oxlintrc.json`.
  Promotion pattern: whole categories (`perf`, `suspicious`) sit at **error**
  with the named intentionally-tolerated rules pinned back to `warn` (each with
  an explanatory comment) — documented patterns stay advisory while everything
  else in the category gates. Don't weaken a category to warn to admit one rule.
- **Routing is file-based** (TanStack Router). `routeTree.gen.ts` is generated —
  run `pnpm generate-routes` after adding/removing a route FILE (not needed for
  tabs inside an existing route).

## Versioning ritual (Changesets)

- The four packages `@dth/web` / `@dth/desktop` / `@dth/rom` / `@dth/ui` are a
  **fixed group** — one product version, bumped in lockstep.
- **Every feature PR needs a changeset** (CI enforces it). The summary is the
  user-facing changelog entry — write it for users, not for git, and **keep it
  changelog-sized: one tight paragraph, a few sentences.** The full essay
  (UI walkthrough, edge cases, implementation notes) belongs in the PR
  description, never in the changeset — a fixed-group changeset lands verbatim
  in FOUR CHANGELOGs and the GitHub release notes, so a wall of text is
  amplified everywhere users read.
- Docs/CI-only PRs satisfy the gate with an **empty** changeset
  (`pnpm changeset --empty`).
- A changeset may name several packages, but **identical text is written into
  every named CHANGELOG** — `pnpm version-packages` runs
  `scripts/dedupe-changelogs.mjs` afterwards, which drops duplicated entries
  (priority: desktop → web → rom → ui; the first keeps it). Entries that
  genuinely differ per package all survive.
- Dependabot PRs are exempt — which means product-relevant dependency bumps never
  release themselves. The `/dep-release` skill (`.claude/skills/dep-release`)
  finds and ships them.
- Never tag or publish by hand — see `.ai/release.md`.

## Character-schema change ritual

The persisted `Character` shape is versioned (`CHARACTER_SCHEMA_VERSION` in
`packages/rom/src/types.ts`, migrations in `packages/rom/src/migrate.ts`).
**The full decision tree + copy-paste templates live at the top of `migrate.ts`
— read them before touching the schema.** Summary:

0. A stored `schemaVersion` **above** the app's is a forward-version file (saved
   by a newer build): `migrateCharacterData` throws **`CharacterSchemaTooNewError`**
   before any normalization can strip its fields (the old clamp silently
   downgraded and a save then destroyed the newer data). Hosts catch it and say
   "update the app" — the web scan surfaces it via the character-scan problems
   channel and never re-saves the file.
1. Always: edit `characterSchema` → bump the constant + add a History line → add a
   `migrate.test.ts` case.
2. Add a `characterMigrations[N]` **step** only for a rename/restructure or a
   value **computed** from the character's own data. Additive fields with a zod
   default and removed fields need **no step** (zod fills/strips).
3. A value needing host context (settings, fs, installed DTH release) resolves in
   web `parseCharacter` — never in the pure core.
4. Steps run pre-zod on raw objects, must be idempotent, and guard on
   `=== undefined`.
5. A new field carrying a **scene path** (or any inside-the-character-folder
   path) must join the repoint helper, or renames/moves silently orphan it. The
   folder-repoint sites are now unified in one place —
   **`repointCharacterPaths`** (`apps/web/src/lib/rom/storage/characters.ts`),
   consumed by `saveCharacter`'s rename, `moveCharacter`, `moveCharactersRoot`,
   AND `moveCharacterScenesFolder` — including the character route's post-move
   DRAFT merge (`onScenesFolderMoved`), which must never keep a hand-picked
   field list (a list that misses a path field writes the dead old path back on
   the next Save). Add the field to that ONE helper. Still separate: only the
   prefill field list `romFields` (`api/characters.ts`). `sceneOverrides` and
   `groomScenes` are the existing examples — grep them to find every site. (Regression fixed: `moveCharacter`
   used to repoint only `scenePath`, orphaning extra scenes/grooms/overrides on a
   folder move.)

## FFI (Rust ↔ TS) change ritual

- Rust commands take camelCase serde structs (`#[serde(rename_all = "camelCase")]`),
  are registered in `generate_handler!` (`apps/desktop/src/lib.rs`), and use
  `#[tauri::command(async)]` for anything I/O-heavy (sync commands freeze the
  window; window creation from a sync command deadlocks).
- Structured returns are **never** bare `invoke<T>()` casts — they parse through
  the zod schemas in `apps/web/src/lib/rom/api/native-types.ts`.
- The wire format is pinned by shared fixtures in `contracts/` (repo root):
  serde round-trip in `apps/desktop/src/contract_tests.rs` + zod parse in
  `apps/web/src/lib/rom/api/native-contract.test.ts`.
- **A new structured return = a zod schema + a `contracts/` fixture + a test case
  on both sides.**
- Pattern: **resolve paths in TS, do heavy file work in Rust.** Native access
  stays in the `lib/` layer (`apps/web/src/lib/**`), `isTauri()`-guarded so the
  SPA still runs in a plain browser. UI opens external links via
  `desktop.openExternal`, never `@tauri-apps/plugin-shell` directly.

## Storage-layer rituals (apps/web/src/lib)

- **Every persistent JSON write goes through `writeTextFileAtomic`**
  (`storage/fs.ts`): temp file in the same dir + rename-over, with the
  Windows locked-target fallback chain owned by the helper. plugin-fs `rename`
  is `std::fs::rename` (replaces existing on Windows, can fail on locked
  targets). The temp suffix must never be `.json` — the library scan would pick
  it up. A torn definition is surfaced by the scan (`CharacterScanProblem`), and
  `saveCharacter` treats a corrupt existing folder as OCCUPIED (never forks a
  "Name (2)" beside it).
- **Location-threading ritual:** a scan that already resolved character
  locations primes the session cache (`cacheCharacterLocation`, `api/core`), and
  mutations accept a pre-resolved location instead of re-scanning
  (`saveCharacter(preResolved?)`, delete, generate). `locateCharacter` lives in
  `api/core`. Adding a new character operation that re-walks the library is the
  bug class the Refresh-sweep O(N²) fix removed — thread the location instead.
- **Destructive operations use STRICT primitives.** The tolerant walk
  (`walkFiles`: swallow, warn, continue) is for the library VIEW; anything that
  deletes based on what it saw (`gcNoteMedia`'s reference set) uses
  `walkFilesStrict` and aborts on any read failure. `moveCharactersRoot`
  collects per-item failures and rolls back on partial failure — the manifest
  must always match where folders actually are.

## UI kit boundary

`@dth/ui` must stay free of Tauri / router / filesystem imports. Host behavior
(link navigation, external-open) is injected via `UiConfigProvider`
(`packages/ui/src/config.tsx`); the app supplies it in
`apps/web/src/routes/__root.tsx`. Tailwind reaches the kit via an `@source` line
in `apps/web/src/styles.css` — kit-only utility classes break without it.
Export only what the app consumes (`packages/ui/src/index.ts` is the sole entry).

## Writing conventions

- Generated `.dsa`/CSV output changes must be intentional: the rom tests pin
  output **byte-identically**. Behavior changes bump `RUNTIME_VERSION`.
- Daz-facing user copy says "hair"; Houdini/Unreal-facing copy says "groom".
- Settings: one tolerant zod schema (`studioSettingsSchema`,
  `apps/web/src/lib/rom/storage/settings.ts`) is the single source of app-global
  fields/defaults/validation. New field = schema + Settings UI + the `dirty` flag.
- Per-project settings live in the `.dcsp` manifest (`DcspManifest`,
  `readManifest`/`writeManifest` in storage.ts) — edited via Settings → Project
  tab. Changing `charactersSubdir` is destructive (physically moves folders).
