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
  required checks: `validate` + `rust`). Branch `feature/…` / `fix/…` / `docs/…`.
  Squash merges.
- **Lint gate is oxlint** (type-aware): `pnpm lint` from the **repo root**.
  Notable: `typescript/no-floating-promises` is an **error**, `import/no-cycle`
  is an error; promise rules are relaxed in tests. Config: `.oxlintrc.json`.
- **Routing is file-based** (TanStack Router). `routeTree.gen.ts` is generated —
  run `pnpm generate-routes` after adding/removing a route FILE (not needed for
  tabs inside an existing route).

## Versioning ritual (Changesets)

- The four packages `@dth/web` / `@dth/desktop` / `@dth/rom` / `@dth/ui` are a
  **fixed group** — one product version, bumped in lockstep.
- **Every feature PR needs a changeset** (CI enforces it). The summary line is the
  user-facing changelog entry — write it for users, not for git.
- Docs/CI-only PRs satisfy the gate with an **empty** changeset
  (`pnpm changeset --empty`).
- Dependabot PRs are exempt — which means product-relevant dependency bumps never
  release themselves. The `/dep-release` skill (`.claude/skills/dep-release`)
  finds and ships them.
- Never tag or publish by hand — see `.ai/release.md`.

## Character-schema change ritual

The persisted `Character` shape is versioned (`CHARACTER_SCHEMA_VERSION` in
`packages/rom/src/types.ts`, migrations in `packages/rom/src/migrate.ts`).
**The full decision tree + copy-paste templates live at the top of `migrate.ts`
— read them before touching the schema.** Summary:

1. Always: edit `characterSchema` → bump the constant + add a History line → add a
   `migrate.test.ts` case.
2. Add a `characterMigrations[N]` **step** only for a rename/restructure or a
   value **computed** from the character's own data. Additive fields with a zod
   default and removed fields need **no step** (zod fills/strips).
3. A value needing host context (settings, fs, installed DTH release) resolves in
   web `parseCharacter` — never in the pure core.
4. Steps run pre-zod on raw objects, must be idempotent, and guard on
   `=== undefined`.

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
