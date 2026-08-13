/**
 * The facts that have to arrive UNASKED — the data half of `inject-gotchas.mjs`.
 *
 * Each entry names WHEN it fires (a command shape or a file path) and WHERE the
 * fact lives (`doc` + `anchor`, a verbatim substring of the bullet). The text
 * itself is NOT copied here — the hook extracts the bullet from the doc at run
 * time, so `.ai/*` stays the single source and this file cannot drift from it.
 * Use `note` only for a fact that lives in no doc.
 *
 * ## What earns a place
 *
 * (a) MEASURED, not theorised, and (b) tied to a recognisable ACTION. A fact
 * that cannot name the moment it matters belongs in the docs alone — a hook
 * firing on everything is noise with a per-call cost.
 *
 * ## Coverage — read this before trusting silence
 *
 * Swept in full: `.ai/gotchas.md` (all 1575 lines, ~90 measured facts — the
 * action-tied ones are below; the rest are semantic and stay doc-only).
 * Swept partially: `.ai/conventions.md` (Repo mechanics).
 * NOT swept: `.ai/domain.md`, `.ai/architecture.md`, `.ai/testing.md`,
 * `.ai/release.md`, `.ai/docs-site.md`, `CLAUDE.md`.
 *
 * So a silent tool call means "no trigger matched", NEVER "nothing is known
 * about this". The injected text says so too, on purpose: a half-populated
 * table that reads as exhaustive is worse than no table, because it teaches the
 * reader that absence of a warning is evidence of safety.
 *
 * Run `node .claude/hooks/inject-gotchas.mjs --audit` after editing a doc — it
 * fails on any anchor that no longer resolves.
 *
 * @typedef {object} Trigger
 * @property {string} id          stable key — also the once-per-session dedupe key
 * @property {RegExp} [command]   matched against a Bash/PowerShell command
 * @property {RegExp} [path]      matched against an Edit/Write path (FORWARD slashes)
 * @property {RegExp} [unless]    suppressor: the command already shows awareness
 * @property {'Bash'|'PowerShell'} [shell] restrict to one shell
 * @property {string} [doc]       repo-relative doc holding the fact
 * @property {string} [anchor]    verbatim substring of the bullet to extract
 * @property {string} [note]      literal text, for a fact in no doc
 */

const GOTCHAS = '.ai/gotchas.md'
const CONVENTIONS = '.ai/conventions.md'
const DOMAIN = '.ai/domain.md'

/** `git <sub>` at COMMAND position — not the same words inside a quoted string
 *  (`rg "git push" docs/` must not match). Mirrors check-branch-upstream.mjs. */
const gitCmd = (sub) =>
  new RegExp(
    `(?:^|[;&|(\\n]|\\$\\()\\s*git(?:\\s+(?:-[Cc]\\s+\\S+|--?[\\w-]+(?:=\\S*)?))*\\s+${sub}\\b`,
  )

/** @type {Array<Trigger>} */
export const TRIGGERS = [
  /* ---- pushing, branching, releasing ------------------------------------- */
  {
    id: 'token-push',
    command: gitCmd('push'),
    unless: /x-access-token|extraheader/,
    doc: CONVENTIONS,
    anchor: 'The ad-hoc token push uses BASIC auth',
  },
  {
    id: 'main-pr-only',
    command: /(?:^|[;&|(\n])\s*git(?:\s+\S+)*\s+push\b[^;&|\n]*\bmain\b/,
    doc: CONVENTIONS,
    anchor: '**`main` is PR-only**',
  },
  {
    id: 'releases-immutable',
    command: /gh\s+release\s+(create|edit|delete|upload)/,
    doc: GOTCHAS,
    anchor: 'GitHub releases are immutable',
  },
  {
    id: 'release-pat',
    command: /gh\s+release\s+create|gh\s+workflow\s+run\s+\S*release/i,
    doc: GOTCHAS,
    anchor: 'cannot create releases on this repo',
  },
  {
    id: 'version-pr-checks',
    command: /gh\s+run\s+(rerun|watch|list)|gh\s+pr\s+checks/,
    doc: GOTCHAS,
    anchor: "The version PR's checks sat `action_required`",
  },

  /* ---- running the gates -------------------------------------------------- */
  {
    id: 'smoke-port',
    command: /\bsmoke\b|playwright\s+test/,
    unless: /SMOKE_PORT/,
    note:
      'A local smoke run binds 4331 by default and the SECOND checkout\n' +
      '(`dth-character-studio_two`) collides with it — a green run can silently have tested THAT\n' +
      'tree. Pass `SMOKE_PORT=<free port>`; treat a surprising pass OR failure as this until\n' +
      'ruled out. See the PORT constant in apps/web/playwright.config.ts.',
  },
  {
    id: 'smoke-mock-mtime',
    path: /apps\/web\/smoke\/(tauri-mock|fixtures)\.ts$/,
    doc: GOTCHAS,
    anchor: "`tauri-mock`'s `stat` must return a **`Date`**",
  },
  {
    id: 'lint-decisions',
    command: /pnpm\s+lint|oxlint/,
    doc: GOTCHAS,
    anchor: "The repo's ~250 lint warnings are DECISIONS",
  },
  {
    id: 'cargo-fmt',
    command: /cargo\s+fmt/,
    doc: GOTCHAS,
    anchor: 'There is NO `cargo fmt` gate',
  },
  {
    id: 'cargo-pins',
    command: /cargo\s+update/,
    doc: GOTCHAS,
    anchor: '`Cargo.lock` pins `alloc-stdlib = 0.2.2`',
  },

  /* ---- the pure core ------------------------------------------------------ */
  {
    id: 'character-schema',
    path: /packages\/rom\/src\/(types|migrate)\.ts$/,
    // Lives in migrate.ts's own header + CLAUDE.md, not in gotchas.md — so this
    // one carries its text, and points at the file that holds the full tree.
    note:
      'The persisted `Character` shape is VERSIONED. Changing it = edit `characterSchema`, bump\n' +
      '`CHARACTER_SCHEMA_VERSION`, add a History line, add a `migrate.test.ts` case. A\n' +
      '`characterMigrations[N]` STEP is only for a rename/restructure or a COMPUTED value — an\n' +
      'additive field with a zod default and a removed field need none (zod fills/strips them).\n' +
      'Steps are pre-zod, idempotent, and guard on `=== undefined`. A value needing host context\n' +
      '(settings, fs, active DTH release) resolves in web `parseCharacter`, never in the pure core.\n' +
      'Full decision tree + copy-paste templates: the top of packages/rom/src/migrate.ts.',
  },
  {
    id: 'byte-identical-output',
    path: /packages\/rom\/src\/(generate|dsa|frames)\.ts$|packages\/rom\/src\/templates\//,
    doc: GOTCHAS,
    anchor: 'Byte-identical output tests are the contract',
  },
  {
    id: 'generator-emit',
    path: /packages\/rom\/src\/(dsa|generate|frames)\.ts$/,
    doc: GOTCHAS,
    anchor: 'A version bump makes a refresh RUN; it does not make a migration HAPPEN',
  },
  {
    id: 'runtime-dsa',
    path: /apps\/web\/src\/lib\/rom\/runtime\//,
    doc: GOTCHAS,
    anchor: '**Fast runtime test loop:**',
  },
  {
    id: 'runtime-include',
    path: /apps\/web\/src\/lib\/rom\/runtime\/.*\.dsa$/,
    doc: GOTCHAS,
    anchor: 'A hidden runtime `.dsa` must never `include()` a sibling runtime by name',
  },

  /* ---- the native boundary ------------------------------------------------ */
  {
    id: 'rust-command',
    path: /apps\/desktop\/src\/.*\.rs$/,
    doc: GOTCHAS,
    anchor: 'Never create a webview window from a synchronous',
  },
  {
    id: 'rust-io-async',
    path: /apps\/desktop\/src\/.*\.rs$/,
    doc: GOTCHAS,
    anchor: 'I/O-heavy commands must be `#[tauri::command(async)]`',
  },
  {
    id: 'ntfs-case',
    path: /apps\/desktop\/src\/(fsutil|dedup|install|junction|unreal_install)\.rs$/,
    doc: GOTCHAS,
    anchor: 'NTFS is case-insensitive; byte-exact rel-path keys never converge',
  },
  {
    id: 'window-lock-io',
    path: /apps\/desktop\/src\/windows\.rs$/,
    doc: GOTCHAS,
    anchor: 'Never do filesystem I/O (especially `fs::canonicalize`) while holding',
  },
  {
    id: 'plugin-fs-acl',
    path: /apps\/desktop\/capabilities\/|tauri\.conf\.json$/,
    doc: GOTCHAS,
    anchor: 'Every `@tauri-apps/plugin-fs` call needs its OWN',
  },
  {
    id: 'ffi-mirror',
    path: /apps\/web\/src\/lib\/rom\/api\/native-types\.ts$|contracts\//,
    doc: GOTCHAS,
    anchor: 'A JS mirror of a Rust decision must be pinned by the SAME test cases',
  },

  /* ---- the web app -------------------------------------------------------- */
  {
    id: 'route-file',
    path: /apps\/web\/src\/routes\/.*\.tsx$/,
    doc: GOTCHAS,
    anchor: '`routeTree.gen.ts` is generated',
  },
  {
    id: 'settings-field',
    path: /apps\/web\/src\/(routes\/settings|lib\/rom\/storage\/settings)\.tsx?$/,
    doc: GOTCHAS,
    anchor: 'Settings saves merge by baseline',
  },
  {
    id: 'react-table-stable',
    path: /apps\/web\/src\/components\/character\/(group-card|rom-sections)\.tsx$/,
    doc: GOTCHAS,
    anchor: "`useReactTable`'s `data` must be referentially stable",
  },
  {
    id: 'overlay-primitives',
    path: /packages\/ui\/src\/primitives\/(modal|side-panel|overlay-sweep|tooltip)/,
    doc: GOTCHAS,
    anchor: "Radix's modal `Dialog` sets `pointer-events: none`",
  },
  {
    id: 'overlay-sweep',
    path: /packages\/ui\/src\/primitives\/|apps\/web\/src\/components\/update-prompt\.tsx$/,
    doc: GOTCHAS,
    anchor: 'A floating layer that renders ABOVE the overlays must be SWEPT',
  },
  {
    id: 'smoke-tooltip-title',
    path: /apps\/web\/smoke\/.*\.smoke\.ts$/,
    doc: GOTCHAS,
    anchor: "The ui kit's TooltipHost rewrites a hovered control's `title`",
  },
  {
    id: 'persist-patch',
    path: /apps\/web\/src\/lib\/use-character-draft|apps\/web\/src\/components\/character\//,
    doc: GOTCHAS,
    anchor: 'Immediate-persist flows go through `useCharacterDraft.persistPatch`',
  },
  {
    id: 'scene-key-normalize',
    path: /apps\/web\/src\/lib\/rom\/(houdini-jobs|execute-jobs)\.ts$/,
    doc: GOTCHAS,
    anchor: 'A map keyed by `normalizeSceneKey` must normalize AT THE ACCESSOR',
  },
  {
    id: 'project-id-is-path',
    path: /apps\/web\/src\/lib\/rom\/storage\/projects\.ts$|apps\/web\/src\/routes\/projects/,
    doc: GOTCHAS,
    anchor: '`projectId` is the project FOLDER PATH everywhere',
  },
  {
    id: 'redos',
    path: /apps\/web\/src\/lib\/path-trim\.ts$|packages\/rom\/src\/dsa\.ts$/,
    doc: GOTCHAS,
    anchor: 'is a HIGH-severity CodeQL alert',
  },

  /* ---- caches, scans, job files ------------------------------------------- */
  {
    id: 'scan-cache-key',
    path: /apps\/web\/src\/lib\/rom\/houdini-project-cache\.ts$/,
    doc: GOTCHAS,
    anchor: 'A cache key must cover everything the cached ANSWER depends on',
  },
  {
    id: 'scan-answer-version',
    path: /apps\/web\/src\/lib\/rom\/houdini-project-cache\.ts$/,
    doc: GOTCHAS,
    anchor: '…and the QUESTION belongs in the key too',
  },
  {
    id: 'path-cache-rename',
    path: /apps\/web\/src\/lib\/rom\/houdini-project-cache\.ts$/,
    doc: GOTCHAS,
    anchor: 'A path-keyed cache is orphaned by a RENAME',
  },
  {
    id: 'job-file-claim',
    path: /apps\/web\/src\/lib\/rom\/api\/execute\.ts$/,
    doc: GOTCHAS,
    anchor: 'A CLOSING Daz can still claim the export job file',
  },
  {
    id: 'job-file-sweep',
    path: /apps\/web\/src\/lib\/rom\/api\/(execute|houdini|daz-scan)\.ts$/,
    doc: GOTCHAS,
    anchor: 'A `bulk-export` handoff leaves its claimed `running_…json` behind',
  },
  {
    id: 'daz-exe-identity',
    path: /apps\/desktop\/src\/daz\.rs$|apps\/web\/src\/lib\/rom\/storage\/settings\.ts$/,
    doc: GOTCHAS,
    anchor: 'Every Daz Studio major ships an executable called `DAZStudio.exe`',
  },

  /* ---- Houdini / hython --------------------------------------------------- */
  {
    id: 'multiparm-0based',
    path: /material_utils\.py$|houdini.*\.py$/,
    doc: GOTCHAS,
    anchor: 'DazToHue HDA multiparms are 0-BASED',
  },
  {
    id: 'multiparm-remove-order',
    path: /material_utils\.py$/,
    doc: GOTCHAS,
    anchor: '`removeMultiParmInstance(i)` takes the instance index',
  },
  {
    id: 'hython-run',
    command: /hython/,
    doc: GOTCHAS,
    anchor: 'A DazToHue bake with a MISSING layer texture reports SUCCESS',
  },
  {
    id: 'job-env-leak',
    path: /material_utils\.py$|headless_export\.py$/,
    doc: GOTCHAS,
    anchor: '`$JOB` is SCENE state saved inside the `.hip`',
  },

  /* ---- Unreal -------------------------------------------------------------- */
  {
    id: 'unreal-buildid',
    path: /apps\/web\/src\/lib\/unreal-install\.ts$|apps\/desktop\/src\/unreal_install\.rs$/,
    doc: GOTCHAS,
    anchor: 'Unreal decides a plugin fits by `BuildId` EQUALITY',
  },
  {
    id: 'unreal-engine-registry',
    path: /apps\/desktop\/src\/unreal_install\.rs$/,
    doc: GOTCHAS,
    anchor: 'can be MISSING an installed\n  engine',
  },

  /* ---- shell hazards ------------------------------------------------------- */
  {
    id: 'powershell-source-roundtrip',
    shell: 'PowerShell',
    command: /Get-Content|Set-Content|Out-File/,
    doc: CONVENTIONS,
    anchor: 'Never round-trip a source file through Windows PowerShell 5.1',
  },
  {
    id: 'unicode-line-terminators',
    path: /packages\/rom\/src\/dsa\.ts$|apps\/web\/src\/lib\/rom\/runtime\//,
    doc: GOTCHAS,
    anchor: 'Literal-char footgun when scripting edits',
  },

  /* ---- domain: the invariants the product IS ------------------------------ */
  {
    id: 'frame-math-invariant',
    path: /packages\/rom\/src\/frames\.ts$/,
    doc: DOMAIN,
    anchor: 'Frame numbers are never stored.',
  },
  {
    id: 'fps-30',
    path: /apps\/web\/src\/lib\/rom\/houdini-defaults\.ts$|apps\/desktop\/src\/poses\.rs$/,
    doc: DOMAIN,
    anchor: 'A frame number is only a pose at ONE rate.',
  },
  {
    id: 'runtime-version-owned',
    path: /packages\/rom\/src\/types\.ts$/,
    doc: DOMAIN,
    anchor: 'The `.dsa` runtime (versioned by',
  },
  {
    id: 'export-dir-derived',
    path: /apps\/web\/src\/lib\/scene-subfolder\.ts$/,
    doc: DOMAIN,
    anchor: 'The **export directory is DERIVED**',
  },
  {
    id: 'export-root-relocation',
    path: /apps\/desktop\/src\/exports\.rs$|apps\/web\/src\/lib\/rom\/api\/characters\.ts$/,
    doc: DOMAIN,
    anchor: 'A relocation MOVES the already-exported files',
  },
  {
    id: 'relocation-needs-refresh',
    path: /apps\/web\/src\/lib\/rom\/api\/(characters|generate)\.ts$/,
    doc: DOMAIN,
    anchor: 'A relocation reaches a LIBRARY through Tools',
  },
  {
    id: 'seed-character-folders',
    path: /apps\/web\/src\/lib\/rom\/storage\/characters\.ts$/,
    doc: DOMAIN,
    anchor: 'THREE folders are seeded into every new character',
  },
  {
    id: 'character-zip',
    path: /apps\/web\/src\/lib\/rom\/character-zip\.ts$/,
    doc: DOMAIN,
    anchor: 'One character as one self-contained archive',
  },
  {
    id: 'houdini-project-generate',
    path: /apps\/desktop\/src\/houdini\.rs$|apps\/web\/src\/lib\/rom\/api\/houdini\.ts$/,
    doc: DOMAIN,
    anchor: '**Generate Houdini project**',
  },
  {
    id: 'export-interrupt',
    path: /apps\/web\/src\/lib\/rom\/api\/execute\.ts$|packages\/rom\/src\/dsa\.ts$/,
    doc: DOMAIN,
    anchor: 'The flag is `EXPORT_CANCEL_FILE`',
  },
]
