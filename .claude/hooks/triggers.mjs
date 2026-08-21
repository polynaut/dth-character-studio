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
 * Swept in full — every line read, the ACTION-TIED facts pulled out (the rest
 * are semantic and stay doc-only): the `gotchas-*.md` set (~90 measured facts;
 * `gotchas.md` is now the index), the `domain-*.md` pair (`domain.md` likewise),
 * `.ai/architecture.md`, `.ai/release.md`, `.ai/docs-site.md`.
 * Swept partially: `.ai/conventions.md` (Repo mechanics), `.ai/testing.md`
 * (the SMOKE_PORT collision and the mock's `stat` contract only), `CLAUDE.md`
 * (the character-schema ritual only — it is the short version of the five
 * above, so triggering off the rest of it would mostly duplicate them; what is
 * worth taking is anything it states that no `.ai/` page does).
 *
 * So a silent tool call means "no trigger matched", NEVER "nothing is known
 * about this". The injected text says so too, on purpose: a half-populated
 * table that reads as exhaustive is worse than no table, because it teaches the
 * reader that absence of a warning is evidence of safety.
 *
 * `node .claude/hooks/inject-gotchas.mjs --audit` fails on any anchor that no
 * longer resolves, and CI runs it on every PR (validate-pull-request.yml)
 * alongside `inject-gotchas.test.mjs`. That is deliberate and load-bearing: the
 * ritual "run the audit after a doc rewrite" was already written down here, and
 * a doc CORRECTION still slipped past it and killed a trigger for days. The
 * repo's standing answer to a rule that gets skipped is the one it reached for
 * with branch tracking — make it a check, not a reminder.
 *
 * ## Anchor on what will not be edited
 *
 * An anchor is a verbatim substring, so it inherits every reason the doc has to
 * change. Keep out of it anything the doc EXPECTS to revise — counts above all:
 * `**FFI surface: 52 commands**` went stale the moment someone did what that
 * very sentence asks ("count it, don't trust it") and corrected it to 54, and
 * the fact stopped being injected with nothing on screen to say so. A pinned
 * dependency version is the same shape (`cargo-pins`), and so is a LINE WRAP:
 * an anchor spanning a newline bakes in where the sentence happens to break
 * today, so re-flowing the paragraph breaks it (`unreal-engine-registry`).
 * Keep anchors to one line, and prefer the shortest phrase that is still
 * unique — shortening trades a STALE failure (says nothing) for an AMBIGUOUS
 * one (hands back the WRONG bullet, confidently), which is only a good trade
 * because the audit above catches it in CI rather than whenever someone
 * remembers to look.
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

const GOTCHAS_CORE = '.ai/gotchas-core.md'
const GOTCHAS_DAZ = '.ai/gotchas-daz.md'
const GOTCHAS_DESKTOP = '.ai/gotchas-desktop.md'
const GOTCHAS_WEB = '.ai/gotchas-web.md'
const GOTCHAS_RELEASES = '.ai/gotchas-releases.md'
const CONVENTIONS = '.ai/conventions.md'
const TESTING = '.ai/testing.md'
const DOMAIN_ROM = '.ai/domain-rom.md'
const DOMAIN_EXPORTER = '.ai/domain-exporter.md'
const ARCH = '.ai/architecture.md'
const RELEASE = '.ai/release.md'
const DOCSSITE = '.ai/docs-site.md'

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
    /* `main` as a whole REF, not as a substring of one: `HEAD:fix/main-menu`
       must not match. A false positive is not free here — it burns the
       once-per-session slot, so the real `git push … main` later goes silent. */
    command: /(?:^|[;&|(\n])\s*git(?:\s+\S+)*\s+push\b[^;&|\n]*[\s:]main(?:\s|$)/,
    doc: CONVENTIONS,
    anchor: '**`main` is PR-only**',
  },
  {
    id: 'releases-immutable',
    command: /gh\s+release\s+(create|edit|delete|upload)/,
    doc: GOTCHAS_RELEASES,
    anchor: 'GitHub releases are immutable',
  },
  {
    id: 'release-pat',
    command: /gh\s+release\s+create|gh\s+workflow\s+run\s+\S*release/i,
    doc: GOTCHAS_RELEASES,
    anchor: 'cannot create releases on this repo',
  },
  {
    id: 'version-pr-checks',
    command: /gh\s+run\s+(rerun|watch|list)|gh\s+pr\s+checks/,
    doc: GOTCHAS_RELEASES,
    anchor: "The version PR's checks sat `action_required`",
  },

  /* ---- running the gates -------------------------------------------------- */
  {
    // The effort down-ratchet, at the moment it is about to be violated: a
    // full-suite run mid-session is exactly what the scoped-gate table exists
    // to replace. Fires once, never blocks — the pre-PR full gate is legit.
    id: 'scoped-gates',
    command: /pnpm\s+-r\s+(?:test|typecheck)\b/,
    doc: TESTING,
    anchor: 'The FULL local gate',
  },
  {
    id: 'smoke-port',
    command: /\bsmoke\b|playwright\s+test/,
    unless: /SMOKE_PORT/,
    doc: TESTING,
    anchor: '**A local smoke result can be a LIE if another checkout holds the port.**',
  },
  {
    id: 'smoke-mock-mtime',
    path: /apps\/web\/smoke\/(tauri-mock|fixtures)\.ts$/,
    doc: GOTCHAS_WEB,
    anchor: "`tauri-mock`'s `stat` must return a **`Date`**",
  },
  {
    id: 'lint-decisions',
    command: /pnpm\s+lint|oxlint/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'The lint tree is at ZERO warnings',
  },
  {
    id: 'cargo-fmt',
    command: /cargo\s+fmt/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'There is NO `cargo fmt` gate',
  },
  {
    id: 'cargo-pins',
    command: /cargo\s+update/,
    doc: GOTCHAS_DESKTOP,
    // NOT the pinned version — the pin exists to be re-pinned (CLAUDE.md says so
    // outright), so the number is the one part of this line expected to change.
    anchor: '`Cargo.lock` pins `alloc-stdlib',
  },

  /* ---- the pure core ------------------------------------------------------ */
  {
    id: 'character-schema',
    // The one fact anchored in CLAUDE.md: the ritual lives there and in
    // migrate.ts's own header, nowhere under `.ai/`. Extracting it beats a
    // `note` copy — that copy existed, and was already a paraphrase drifting
    // from the bullet it came from.
    path: /packages\/rom\/src\/(types|migrate)\.ts$/,
    doc: 'CLAUDE.md',
    anchor: '**Character-schema changes:**',
  },
  {
    id: 'byte-identical-output',
    path: /packages\/rom\/src\/(generate|dsa|frames)\.ts$|packages\/rom\/src\/templates\//,
    doc: GOTCHAS_CORE,
    anchor: 'Byte-identical output tests are the contract',
  },
  {
    id: 'generator-emit',
    path: /packages\/rom\/src\/(dsa|generate|frames)\.ts$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'A version bump makes a refresh RUN; it does not make a migration HAPPEN',
  },
  {
    id: 'runtime-dsa',
    path: /apps\/web\/src\/lib\/rom\/runtime\//,
    doc: GOTCHAS_DAZ,
    anchor: '**Fast runtime test loop:**',
  },
  {
    id: 'runtime-include',
    path: /apps\/web\/src\/lib\/rom\/runtime\/.*\.dsa$/,
    doc: GOTCHAS_DAZ,
    anchor: 'A hidden runtime `.dsa` must never `include()` a sibling runtime by name',
  },

  /* ---- the native boundary ------------------------------------------------ */
  {
    id: 'rust-command',
    path: /apps\/desktop\/src\/.*\.rs$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'Never create a webview window from a synchronous',
  },
  {
    id: 'rust-io-async',
    path: /apps\/desktop\/src\/.*\.rs$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'I/O-heavy commands must be `#[tauri::command(async)]`',
  },
  {
    id: 'ntfs-case',
    path: /apps\/desktop\/src\/(fsutil|dedup|install|junction|unreal_install)\.rs$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'NTFS is case-insensitive; byte-exact rel-path keys never converge',
  },
  {
    id: 'window-lock-io',
    path: /apps\/desktop\/src\/windows\.rs$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'Never do filesystem I/O (especially `fs::canonicalize`) while holding',
  },
  {
    id: 'plugin-fs-acl',
    path: /apps\/desktop\/capabilities\/|tauri\.conf\.json$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'Every `@tauri-apps/plugin-fs` call needs its OWN',
  },
  {
    id: 'ffi-mirror',
    path: /apps\/web\/src\/lib\/rom\/api\/native-types\.ts$|contracts\//,
    doc: GOTCHAS_DESKTOP,
    anchor: 'A JS mirror of a Rust decision must be pinned by the SAME test cases',
  },

  /* ---- the web app -------------------------------------------------------- */
  {
    id: 'route-file',
    path: /apps\/web\/src\/routes\/.*\.tsx$/,
    doc: GOTCHAS_WEB,
    anchor: '`routeTree.gen.ts` is generated',
  },
  {
    id: 'settings-field',
    path: /apps\/web\/src\/(routes\/settings|lib\/rom\/storage\/settings)\.tsx?$/,
    doc: GOTCHAS_WEB,
    anchor: 'Settings saves merge by baseline',
  },
  {
    id: 'react-table-stable',
    path: /apps\/web\/src\/components\/character\/(group-card|rom-sections)\.tsx$/,
    doc: GOTCHAS_WEB,
    anchor: "`useReactTable`'s `data` must be referentially stable",
  },
  {
    id: 'overlay-primitives',
    path: /packages\/ui\/src\/primitives\/(modal|side-panel|overlay-sweep|tooltip)/,
    doc: GOTCHAS_WEB,
    anchor: "Radix's modal `Dialog` sets `pointer-events: none`",
  },
  {
    id: 'overlay-sweep',
    path: /packages\/ui\/src\/primitives\/|apps\/web\/src\/components\/update-prompt\.tsx$/,
    doc: GOTCHAS_WEB,
    anchor: 'A floating layer that renders ABOVE the overlays must be SWEPT',
  },
  {
    id: 'info-popup-height',
    path: /packages\/ui\/src\/primitives\/info-popup/,
    doc: GOTCHAS_WEB,
    anchor: 'An InfoPopup longer than the room under its "i"',
  },
  {
    id: 'smoke-tooltip-title',
    path: /apps\/web\/smoke\/.*\.smoke\.ts$/,
    doc: GOTCHAS_WEB,
    anchor: "The ui kit's TooltipHost rewrites a hovered control's `title`",
  },
  {
    id: 'persist-patch',
    path: /apps\/web\/src\/lib\/use-character-draft|apps\/web\/src\/components\/character\//,
    doc: GOTCHAS_WEB,
    anchor: 'Immediate-persist flows go through `useCharacterDraft.persistPatch`',
  },
  {
    id: 'scene-key-normalize',
    path: /apps\/web\/src\/lib\/rom\/(houdini-jobs|execute-jobs)\.ts$/,
    doc: GOTCHAS_WEB,
    anchor: 'A map keyed by `normalizeSceneKey` must normalize AT THE ACCESSOR',
  },
  {
    // The finish report's failure count is a SUM of channels that dedupe by
    // scene. Anyone touching it is one un-deduped `+ n` away from reporting a
    // healthy scene as failed and dropping its continuation.
    id: 'export-finish-count',
    path: /apps\/web\/src\/components\/character\/dth-export\.tsx$|apps\/web\/src\/lib\/rom\/api\/execute\/run-state\.ts$/,
    doc: GOTCHAS_WEB,
    anchor: "A finish report's failure count is a SUM of deduped channels",
  },
  {
    // Editing the death reason without this fact re-invents the bug it fixed:
    // quoting the newest error-shaped line the run demonstrably survived.
    id: 'houdini-death-reason',
    path: /apps\/web\/src\/lib\/rom\/houdini-jobs\.ts$/,
    doc: GOTCHAS_WEB,
    anchor: 'A dead hython can exit with NOTHING',
  },
  {
    // Judging a Daz export from any channel ABOVE the disk is judging a liar.
    id: 'daz-export-landed',
    path: /apps\/web\/src\/lib\/rom\/api\/houdini\.ts$/,
    doc: GOTCHAS_DAZ,
    anchor: 'A Daz-side script the engine kills at the C++ level',
  },
  {
    // Every hand-written animation in the app lives in this one file, and the
    // implicit-keyframe rule bites silently — the animation still LOOKS right.
    id: 'keyframe-implicit-zero',
    path: /apps\/web\/src\/styles\.css$/,
    doc: GOTCHAS_WEB,
    anchor: 'A `@keyframes` property declared only at `100%` animates for the WHOLE',
  },
  {
    // The run's task list drops finished rows on a timer. Both the memory and
    // the "don't assert on a transient" half are easy to walk straight into —
    // and the second half is a hazard for the SMOKE specs, not the panel, so
    // the path has to reach them or the note never fires where it is needed.
    id: 'task-row-retire',
    path: /apps\/web\/src\/components\/character\/export-pipeline-panel\.tsx$|apps\/web\/smoke\/.*\.smoke\.ts$/,
    doc: GOTCHAS_WEB,
    anchor: 'A row that retires from a live list needs MEMORY',
  },
  {
    id: 'project-id-is-path',
    path: /apps\/web\/src\/lib\/rom\/storage\/projects\.ts$|apps\/web\/src\/routes\/projects/,
    doc: GOTCHAS_WEB,
    anchor: '`projectId` is the project FOLDER PATH everywhere',
  },
  {
    id: 'redos',
    path: /apps\/web\/src\/lib\/path-trim\.ts$|packages\/rom\/src\/dsa\.ts$/,
    doc: GOTCHAS_RELEASES,
    anchor: 'is a HIGH-severity CodeQL alert',
  },

  /* ---- caches, scans, job files ------------------------------------------- */
  {
    id: 'ci-cache-scope',
    path: /\.github\/workflows\/[^/]+\.ya?ml$/,
    doc: GOTCHAS_RELEASES,
    anchor: 'A CI cache saved from a PR run is invisible to every OTHER PR',
  },
  {
    id: 'scan-cache-key',
    path: /apps\/web\/src\/lib\/rom\/houdini-project-cache\.ts$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'A cache key must cover everything the cached ANSWER depends on',
  },
  {
    id: 'scan-answer-version',
    path: /apps\/web\/src\/lib\/rom\/houdini-project-cache\.ts$/,
    doc: GOTCHAS_DESKTOP,
    anchor: '…and the QUESTION belongs in the key too',
  },
  {
    id: 'path-cache-rename',
    path: /apps\/web\/src\/lib\/rom\/houdini-project-cache\.ts$/,
    doc: GOTCHAS_RELEASES,
    anchor: 'A path-keyed cache is orphaned by a RENAME',
  },
  {
    id: 'job-file-claim',
    path: /apps\/web\/src\/lib\/rom\/api\/execute\.ts$/,
    doc: GOTCHAS_DAZ,
    anchor: 'A CLOSING Daz can still claim the export job file',
  },
  {
    id: 'job-file-sweep',
    path: /apps\/web\/src\/lib\/rom\/api\/(execute|houdini|daz-scan)\.ts$/,
    doc: GOTCHAS_DAZ,
    anchor: 'A `bulk-export` handoff leaves its claimed `running_…json` behind',
  },
  {
    id: 'daz-exe-identity',
    path: /apps\/desktop\/src\/daz\.rs$|apps\/web\/src\/lib\/rom\/storage\/settings\.ts$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'Every Daz Studio major ships an executable called `DAZStudio.exe`',
  },

  /* ---- Houdini / hython --------------------------------------------------- */
  {
    id: 'multiparm-0based',
    path: /material_utils\.py$|houdini.*\.py$/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'DazToHue HDA multiparms are 0-BASED',
  },
  {
    id: 'multiparm-remove-order',
    path: /material_utils\.py$/,
    doc: GOTCHAS_DESKTOP,
    anchor: '`removeMultiParmInstance(i)` takes the instance index',
  },
  {
    id: 'hython-run',
    command: /hython/,
    doc: GOTCHAS_DESKTOP,
    anchor: 'A DazToHue bake with a MISSING layer texture reports SUCCESS',
  },
  {
    id: 'job-env-leak',
    path: /material_utils\.py$|headless_export\.py$/,
    doc: GOTCHAS_DESKTOP,
    anchor: '`$JOB` is SCENE state saved inside the `.hip`',
  },

  /* ---- Unreal -------------------------------------------------------------- */
  {
    id: 'unreal-buildid',
    path: /apps\/web\/src\/lib\/unreal-install\.ts$|apps\/desktop\/src\/unreal_install\.rs$/,
    doc: GOTCHAS_RELEASES,
    anchor: 'Unreal decides a plugin fits by `BuildId` EQUALITY',
  },
  {
    id: 'unreal-engine-registry',
    path: /apps\/desktop\/src\/unreal_install\.rs$/,
    doc: GOTCHAS_RELEASES,
    // Single line on purpose: spanning the wrap baked the doc's line break and
    // its 2-space continuation indent into the anchor, so re-flowing the
    // sentence — adding one word earlier in it — would have killed this too.
    anchor: 'can be MISSING an installed',
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
    doc: GOTCHAS_WEB,
    anchor: 'Literal-char footgun when scripting edits',
  },

  /* ---- domain: the invariants the product IS ------------------------------ */
  {
    id: 'frame-math-invariant',
    path: /packages\/rom\/src\/frames\.ts$/,
    doc: DOMAIN_ROM,
    anchor: 'Frame numbers are never stored.',
  },
  {
    id: 'fps-30',
    path: /apps\/web\/src\/lib\/rom\/houdini-defaults\.ts$|apps\/desktop\/src\/poses\.rs$/,
    doc: DOMAIN_ROM,
    anchor: 'A frame number is only a pose at ONE rate.',
  },
  {
    id: 'runtime-version-owned',
    path: /packages\/rom\/src\/types\.ts$/,
    doc: DOMAIN_ROM,
    anchor: 'The `.dsa` runtime (versioned by',
  },
  {
    id: 'export-dir-derived',
    path: /apps\/web\/src\/lib\/scene-subfolder\.ts$/,
    doc: DOMAIN_EXPORTER,
    anchor: 'The **export directory is DERIVED**',
  },
  {
    id: 'export-root-relocation',
    path: /apps\/desktop\/src\/exports\.rs$|apps\/web\/src\/lib\/rom\/api\/characters\.ts$/,
    doc: DOMAIN_EXPORTER,
    anchor: 'A relocation MOVES the already-exported files',
  },
  {
    id: 'relocation-needs-refresh',
    path: /apps\/web\/src\/lib\/rom\/api\/(characters|generate)\.ts$/,
    doc: DOMAIN_EXPORTER,
    anchor: 'A relocation reaches a LIBRARY through Tools',
  },
  {
    id: 'seed-character-folders',
    path: /apps\/web\/src\/lib\/rom\/storage\/characters\.ts$/,
    doc: DOMAIN_EXPORTER,
    anchor: 'THREE folders are seeded into every new character',
  },
  {
    id: 'character-zip',
    path: /apps\/web\/src\/lib\/rom\/character-zip\.ts$/,
    doc: DOMAIN_ROM,
    anchor: 'One character as one self-contained archive',
  },
  {
    id: 'houdini-project-generate',
    path: /apps\/desktop\/src\/houdini\.rs$|apps\/web\/src\/lib\/rom\/api\/houdini\.ts$/,
    doc: DOMAIN_EXPORTER,
    anchor: '**Generate Houdini project**',
  },
  {
    id: 'export-interrupt',
    path: /apps\/web\/src\/lib\/rom\/api\/execute\.ts$|packages\/rom\/src\/dsa\.ts$/,
    doc: DOMAIN_ROM,
    anchor: 'The flag is `EXPORT_CANCEL_FILE`',
  },

  /* ---- architecture: boundaries that bite when crossed -------------------- */
  {
    id: 'ui-kit-no-tauri',
    path: /packages\/ui\/src\//,
    doc: ARCH,
    anchor: '**No Tauri / router / filesystem imports**',
  },
  {
    id: 'ffi-surface',
    path: /apps\/desktop\/src\/lib\.rs$/,
    doc: ARCH,
    // NOT the count — the doc states it as a number it expects to be re-verified
    // and corrected, and the anchor died the first time someone did (52 → 54).
    anchor: '**FFI surface:',
  },
  {
    id: 'which-daz-launches',
    path: /apps\/desktop\/src\/daz\.rs$/,
    doc: ARCH,
    anchor: '**Which Daz `launch_daz_studio` starts has two answers',
  },
  {
    id: 'window-title',
    path: /apps\/desktop\/src\/windows\.rs$/,
    doc: ARCH,
    anchor: "A project window's **native title is",
  },
  {
    id: 'character-meta-dir',
    path: /apps\/web\/src\/lib\/rom\/storage\/projects\.ts$/,
    doc: ARCH,
    anchor: '`.dcsmeta/characters/<library-relative character folder>/`',
  },
  {
    id: 'detected-files',
    path: /apps\/web\/src\/lib\/rom\/detected-files\.ts$/,
    doc: ARCH,
    anchor: '**The rule is pure subtraction**',
  },
  {
    id: 'product-scan-store',
    path: /apps\/web\/src\/lib\/rom\/character-products\.ts$/,
    doc: ARCH,
    anchor: '**The results are per SCENE, in `products.json`.**',
  },

  /* ---- the release train --------------------------------------------------- */
  {
    id: 'never-tag-by-hand',
    command: gitCmd('tag'),
    doc: RELEASE,
    anchor: 'Fully automated — **never tag or publish by hand**',
  },
  {
    id: 'empty-changeset-blocks-release',
    path: /\.changeset\/.*\.md$/,
    doc: RELEASE,
    anchor: '**orphaned empty changesets block releasing.**',
  },
  {
    id: 'bundled-runner',
    path: /scripts\/fetch-runner\.mjs$/,
    doc: RELEASE,
    anchor: '**Bundled Runner plugin**',
  },
  {
    id: 'release-pat-expiry',
    command: /gh\s+run\s+rerun.*publish|gh\s+workflow\s+run\s+release/i,
    doc: RELEASE,
    anchor: "**If publish fails with 403/401: check the PAT's expiry first.**",
  },

  /* ---- the docs site ------------------------------------------------------- */
  {
    id: 'guide-hash-slug',
    path: /docs\/guide\/.*\.md$/,
    doc: DOCSSITE,
    anchor: '**An `&` in a heading slugifies to `-amp-`, not `-`.**',
  },
  {
    id: 'guide-nav-placement',
    path: /docs\/guide\/.*\.md$/,
    doc: DOCSSITE,
    anchor: '**NAV placement**',
  },
  {
    id: 'site-not-linted',
    path: /site\/.*\.(js|css|html)$/,
    doc: DOCSSITE,
    anchor: 'Heads-up: `pnpm lint` covers only `apps packages`',
  },
]
