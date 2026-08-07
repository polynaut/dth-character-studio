# Conventions & rituals

The non-obvious "how we do things here". CLAUDE.md has the short version; this is
the reference.

## Working rules (every task, before anything else)

This project has ONE maintainer, working on it in his spare time. Every round
trip he spends re-stating something he already said is the expensive resource
here — not tokens, not CI minutes. These rules exist because each was paid for.

**The definition of done, in his words: every point of the prompt is solved.**
"The code works" is a precondition, never a completion criterion — a task is not
done because the thing you built runs. Treat the prompt as a ticket and each
point in it as an acceptance criterion: closing it with half the ACs met is the
failure, and a working build does not excuse it. If a point cannot be met, it is
named in the reply as outstanding — that is the only honest alternative to
doing it.

- **Open with the parsed todo list.** On any non-trivial prompt, the FIRST thing
  in the reply is the short list of what was parsed out of it — before the work
  starts. He then corrects a wrong reading in one glance instead of discovering
  the gap after the fact. **Close by ticking that list**, naming anything not
  done and why. A multi-part prompt is a checklist: re-read it before the
  closing summary and account for every clause, asides and parentheticals
  included. Never make him list what was dropped — offer to audit the session.
  *Earned by:* "i slowly get the feeling that you always skip like 25% of my
  prompts.. it's already the third thing i need to fix today where i'm 200% sure
  i told you already". The shape is always the same — the code works, and the
  edges fall off: the toggle that drives the feature, the icon, the docs, the
  files it writes and never deletes.
- **A feature is not done at the happy path.** Finish the whole loop — the files
  it writes AND their cleanup, the folders it fills, the icon it needs, the docs
  that describe it. When scope is genuinely ambiguous, take the WIDER reading
  and say so: under-delivering costs him a round trip, over-delivering costs him
  a glance.
- **Never watch CI.** Don't run `gh pr checks --watch`, don't poll a workflow,
  don't block on a run. He watches CI himself, deliberately, because it is his
  cue to go do something else. "write pr" means: open the PR, set the
  description, report the URL — seconds, not minutes.
- **Every `gh`/`git` command must be shaped so it cannot need a second attempt.**
  A retry is not free: it is another minute of his attention. The recurring
  killer is PowerShell quoting — a `"` inside a here-string breaks native
  argument splitting, and a bash `<<'EOF'` heredoc is a parse error. So **any
  multi-line or quote-bearing text goes to a file first**, then
  `gh pr create --body-file <path>` / `git commit -F <path>`. Never inline it.

**These are enforced where they can be, not trusted.** The rules that have never
been broken in this repo are the machine-checked ones (the changeset gate, lint,
the byte-identical rom output) — compliance simply isn't left to judgement. Two
hooks in `.claude/settings.json` move these the same way:

- `.claude/hooks/inject-agent-context.mjs` (**SessionStart**) prints
  `.ai/philosophy.md` and THIS section into context at the start of every
  session. `.ai/*` is read-on-demand and "on demand" means the agent decides —
  which is the exact failure. It reads both straight out of their own files, so
  editing the docs is still the only place to change a rule.
- `.claude/hooks/check-branch-upstream.mjs` (**PostToolUse**) fails a
  `git push` from a branch with no upstream and hands the fix back to the agent,
  in the same turn; creating a branch (`switch -c`, `checkout -b`, …) only drops
  a reminder, because a branch that isn't on the remote yet CANNOT track — push
  first, then set tracking (the full rule lives in Repo mechanics below).
  Documented as non-negotiable, skipped twice in one day — so it is a check now,
  not a reminder.

Both hook commands in `.claude/settings.json` are repo-root-relative
(`node .claude/hooks/…`) — start sessions at the repo root (a worktree's root
counts; it has its own checkout of `.claude/`), or the hooks fail MODULE_NOT_FOUND.

What a hook CANNOT check is whether every point of a prompt was answered; that
stays judgement, and the opening todo list is the closest thing to a proof of it.

## Stacked PRs

**Changes with different merge gates get different PRs.** A PR merges as one
unit, so bundling work that can ship now with work that waits on an external
gate (a DazToHue release, an upstream fix) blocks the shippable half — split
them and stack when they are entangled. Paid for on 2026-08-04: the junction
removal (mergeable immediately) was folded into the release-gated prefill PR
and had to be surgically split back out (#682/#683).

**Stacked PRs need an explicit link, not just a base branch.** When a PR depends
on another (its base is that PR's branch), targeting the parent branch is
NECESSARY BUT NOT SUFFICIENT — GitHub tracks a stack object, and without it the
PR page shows no "Able to merge as a stack" panel and no **Merge stack** button.
Create it from the existing PRs:

```sh
gh extension install github/gh-stack        # once
GH_REPO=polynaut/dth-character-studio \
  gh stack link <bottom-pr> <top-pr>        # bottom = the one targeting main
```

- **`GH_REPO=` is required in this repo.** The remote is the `github-poly` SSH
  alias (1Password agent), which `gh` cannot map to a GitHub host — it fails with
  "none of the git remotes configured for this repository point to a known GitHub
  host". Set the env var; do NOT add an HTTPS remote (see `.ai/release.md` and
  the SSH rule in Repo mechanics).
- Order is **bottom-up**: the PR whose base is `main` comes first.
- **Don't run `gh stack checkout`** while work is in flight — it sets up local
  tracking and moves branches around. The server-side stack needs none of it;
  `gh stack view` simply won't show the stack without it, which is fine.
- Public preview at time of writing (2026-08), docs:
  <https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests>.

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
- **Always set branch UPSTREAM TRACKING on every branch you create** — this is
  non-negotiable, not optional. After creating a branch, run
  `git branch --set-upstream-to=origin/<branch> <branch>` so a bare `git pull` /
  `git push` works for the maintainer (without it they get "there is no tracking
  information for the current branch"). This is BRANCH config only (`branch.<name>.remote`
  / `.merge`) — `origin` stays SSH; **never** reconfigure the remote to HTTPS. An agent
  that pushes ad-hoc via a token must ALSO do this, and re-fetch the branch into
  `refs/remotes/origin/<branch>` after each push so the maintainer's ahead/behind stays
  accurate. Machine-checked by `.claude/hooks/check-branch-upstream.mjs` (see Working
  rules) — this bullet is the rule's single full statement; CLAUDE.md and Working
  rules only point here.
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
- **A new capability is a `minor`; a fix to an existing one is a `patch`.** The
  precedent is the Utils drawer (#690 → v0.64.0). Two CI checks split the work
  that used to be left to judgement: `require-real-changeset.mjs` proves a
  changeset exists and bumps something, and `changeset-bump-type.mjs` proves the
  TYPE matches — it fails a patch-only PR that adds a route file, an export from
  the `lib/rom/api.ts` barrel, or a `#[tauri::command]`. *Earned by:* the
  Defaults tab (#706) and Make paths portable (#709) both shipping as `patch`;
  two features would have released under a patch version and read as bug fixes
  in four CHANGELOGs, caught only because a human read the version PR (#710).
  It is a heuristic, so it has an escape hatch — a YAML comment in the
  changeset's own frontmatter, which forces the judgement to be made and leaves
  it where the next reader looks (the same shape as bumping `.lint-baseline.json`
  for a deliberate lint warning):

  ```markdown
  ---
  # bump: patch is deliberate — moved an existing command, no new capability
  '@dth/web': patch
  ---
  ```

  A frontmatter comment never reaches a CHANGELOG (only the body does) and
  Changesets parses it fine — both verified before the check was written.
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
   the next Save). Add the field to that ONE helper. Still separate: the
   create-flow prefill — `fillSectionsFrom` (`apps/web/src/lib/fill-sections.ts`)
   plus the `prefillExtras` copy in `api/characters.ts`, which copies only
   `jcmMorphMods`/`preserveMorphs`/`preserveNodeTransforms` (no path
   fields). `sceneOverrides` (which
   carries each scene's hair since schema v24) is the existing example — grep it to find every site. (Regression fixed: `moveCharacter`
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
- A **primitive** return (a `String`, a `Vec<String>`) needs no fixture — parse it
  with a plain `z.string()` / `z.enum([...])` / `z.array(z.string())` at the call
  site and it is still not a bare cast. `create_houdini_project` (a `"a|b"`
  report), `remove_junction` (`"removed"`/`"absent"`/`"not-a-junction"`) and
  `move_exports` (one
  line per failure, empty = all moved) are the examples. Reach for a struct when
  the caller needs fields, not when it needs an answer.
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

A safety net is not a status line. Backups, quarantine copies and other
"we kept the old one" mechanics are taken silently and surfaced ONLY where they
can be acted on — the failure they exist for. The Houdini Utils drawer is the
worked example: `material_utils.py` takes one rolling backup before every save,
four report components used to print "· backup written" on every success, and
the line trained the eye to skip exactly the case that mattered. It now appears
once, as **Undo this run** beside a failed entry, wired to
`restore_houdini_backup` (a plain Rust file copy — never a Houdini round trip,
which would be another chance to damage what is being rescued). A report that
narrates the net on every happy path is noise; one that offers it on the
unhappy path is a feature.

**And a net has a lifetime.** The same backups are an undo buffer for the
drawer session, not an archive: ~8 MB per project touched, one beside every
project a run wrote, and nothing else in the app would ever collect them (the
retention-bound rule — app-generated data needs a ceiling). So the drawer asks
on CLOSE, listing what it made, and `discardHoudiniBackups` removes only paths
matching `isStudioBackup` (`…_dthbak.<ext>`) — Houdini's own `_bak1.hip` sits in
the same folder and must never be touched. It asks rather than sweeping: the one
case where the copy is still worth its 8 MB is a failed run the user hasn't
undone, which the prompt calls out in amber.

Modal footers: the Cancel button is always `variant="ghost"`, first child of
the right-aligned `flex justify-end gap-2` footer row — immediately left of the
affirmative/primary action (e.g. `bulk-delete-dialog.tsx`,
`character/dth-export.tsx`). Inline (non-modal) cancels — path chips, the Tools
danger-zone confirm strip — keep their own styling.

## Writing conventions

- Generated `.dsa`/CSV output changes must be intentional: the rom tests pin
  output **byte-identically**. Any change to what the generators EMIT bumps the
  matching version — `RUNTIME_VERSION` for script content (even when the
  runtime files' API is untouched), the CSV era for CSV format, the character
  schema for definition shape. The bump is not bookkeeping: it is what makes
  the Refresh-assets detection table fire on existing installs — without it
  nothing reads as stale, no pulse shows, and a migration that "ships" never
  actually runs anywhere. Paid for in v0.63: the junction removal changed the
  reference-path emission without a bump, released installs saw Local = App,
  and the leftover-junction sweep sat inert until v57 (PR #685) forced it.
- Daz-facing user copy says "hair"; Houdini/Unreal-facing copy says "groom".
- Settings: one tolerant zod schema (`studioSettingsSchema`,
  `apps/web/src/lib/rom/storage/settings.ts`) is the single source of app-global
  fields/defaults/validation. New field = schema + Settings UI + the `dirty` flag.
- Per-project settings live in the `.dcsp` manifest (`DcspManifest`,
  `readManifest`/`writeManifest` in `storage/projects.ts`), defaults
  centralized in `PROJECT_BEHAVIOR_DEFAULTS` (same file — THE single copy: a
  fresh manifest and the api's project-settings save input both read it). A
  new per-project field = the interface + `PROJECT_BEHAVIOR_DEFAULTS` + the
  Settings → Project tab. `houdiniPathStyle` lives here since v0.61
  (`createExportJunctions` arrived with it and was retired with the junction
  feature in v0.63 — old manifests carrying it still parse, the key is
  ignored); the app-global `studioSettingsSchema.houdiniPathStyle` is LEGACY
  (`storage/settings.ts`), kept only so old settings.json files still parse.
  Changing `charactersSubdir` is destructive (physically moves folders).
