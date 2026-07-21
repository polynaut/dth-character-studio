# Gotchas — hard-won facts that are invisible in the code

Things that were learned by measurement or painful debugging. Verify against the
current code before relying on details, but assume the *lesson* still holds.

## Generation core

- **Frame math returns -1, not 0, for "no preset block"** — `presetEndFrame` is
  designed so the first custom pose lands at frame 0. Clamping to 0 introduces an
  off-by-one that `generate.test.ts` guards explicitly.
- **`mirrorGroup` only flips word-initial Left/Right** tokens — `CleftChin` must
  survive mirroring (test-pinned).
- **U+2028/U+2029 are line terminators to Daz's JS engine** — every string
  embedded in a generated `.dsa` goes through `dazJson`/`commentSafe` escaping. A
  shared character definition carrying one used to break the whole script.
- **Byte-identical output tests are the contract.** Refactors of `generate.ts`
  must not change a single output byte unless the change is the point (then the
  templates/tests move with it and `RUNTIME_VERSION` is bumped).
- **zod 4's `z.number()` already rejects `Infinity`/`-Infinity`/`NaN`** (verified
  against zod 4.3.6) — do NOT add `.finite()` (dead noise); the reject posture is
  pinned by tests in `types.test.ts` instead so a zod major bump can't silently
  regress it.
- **The validated G9 template ships label-less `GENGROUP` rows** (`GENGROUP,0,0,1`;
  `FACGROUP` has no label column at all) — an empty bones label is a VALID state
  for GEN custom groups. Only JCM/PHY groups require a driver bone, and
  `romValidationErrors` enforces exactly that split.

## Daz Studio integration (measured behavior)

- **A failed script `include()`/load logs nothing** in Daz Studio. Diagnose with a
  minimal probe `.dsa` that logs before/after the suspect statement.
- **`include()` must be top-level** in DS6 — a legacy include inside a function
  throws `URIError: Legacy Include` (regression-guarded in `generate.test.ts`).
- **`App.openFile(path, false)` replaces the current scene without a save
  prompt** — the generated per-character `Open_Scene` script warns the user first.
- **Command-line forwarding to a running Daz instance stops working once a scene
  is loaded** — full "open in running instance" automation isn't possible from
  scripts alone; that's why the studio ships an Open_Scene script instead.
- **Fast runtime test loop:** copying an updated `.DthUtils.dsa`/`.DthWorkflow.dsa`
  over the installed one in `<Daz library>/Scripts/DTH-Character-Studio/` and
  re-running the character's ROM script is enough — no app rebuild needed.

## Desktop / Tauri

- **Never create a webview window from a synchronous `#[tauri::command]`** — it
  deadlocks (white frozen window). Use `#[tauri::command(async)]` and
  `tauri::async_runtime::spawn` (the single-instance handler does this).
- **The Rust crate version (`apps/desktop/Cargo.toml`, `0.1.0`) is cosmetic.**
  The product version lives in `apps/desktop/package.json`
  (`tauri.conf.json` has `"version": "package.json"`); Changesets bumps only the
  npm side. `cargo test` printing `v0.1.0` is expected.
- **`Cargo.lock` pins `alloc-stdlib = 0.2.2` + `alloc-no-stdlib = 2.0.4`** — newer
  versions break brotli 8 via Tauri's asset compression. CI greps the lockfile to
  enforce the pins; don't `cargo update` them (see `docs/devops.md` for the
  re-pin command).
- **Tauri fs plugin scope quirks:** on Unix the `**` glob doesn't match hidden
  dot-folders unless `plugins.fs.requireLiteralLeadingDot: false` is set in
  `tauri.conf.json` (it is — creating `.dcsmeta/images` failed on macOS without it).
- **I/O-heavy commands must be `#[tauri::command(async)]`** or they freeze the
  window during long scans/installs.
- **NTFS is case-insensitive; byte-exact rel-path keys never converge.** Any
  HashMap keyed by relative path in a compare pipeline (install diff, dedup
  grouping, winner maps) must key on a Unicode-folded `rel_key()` — Windows
  preserves the DESTINATION's casing on overwrite, so a byte-exact lookup misses
  a case-variant installed file and re-copies it forever. Keep original casing in
  everything user-visible or written to disk (`fsutil.rs`).
- **Rust std reports NTFS junctions as symlinks** (`file_type().is_symlink()`
  true, `is_dir()` false). All fs walkers share `fsutil::walk_dir` with one
  explicit dir-link policy (link = leaf, counted) — a hand-rolled walker that
  forgets this either escapes into the junction target or `fs::copy`s a reparse
  point and fails the whole step.
- **A window-label reservation races the async `build()`** — webview registration
  lags by hundreds of ms, so "reservation present, window absent" is only provably
  stale while holding a creation lock across find→build (`PROJECT_WINDOW_LOCK`,
  like `HOME_WINDOW_LOCK`). Take that lock ONLY on worker threads and never hold
  the map mutex across the build (a main-thread `active_project_file` waits on it).
- **tauri-build's default Windows manifest is ONLY the Common-Controls
  dependency.** Overriding via `WindowsAttributes::app_manifest`
  (`apps/desktop/windows-app-manifest.xml`) must reproduce it verbatim; our
  override adds `<longPathAware>`, which is **inert unless the machine-wide
  `LongPathsEnabled` registry bit is set** — which is why the walkers ALSO count
  unreadable entries (`read_errors`) and dedup refuses to quarantine any group
  whose scan was incomplete.

## Web app

- **`useReactTable`'s `data` must be referentially stable.** A derived rows array
  built inline in render (the override grid's merged `displayPoses`) fed the
  table a new identity every render and — once a row's content actually differed —
  tipped React into an **endless synchronous re-render loop** that hard-froze the
  window (~9,500 self-renders in 5s, no error, no yield). jsdom tests never catch
  it; only the browser smoke did. Memoize derived table data AND keep the memo's
  inputs stable (memoized Maps, shared `EMPTY_…` constants instead of fresh `[]`
  per call) — see `group-card.tsx` `displayPoses` / `rom-sections.tsx`
  `overriddenById`.
- **The ui kit's TooltipHost rewrites a hovered control's `title` into
  `data-tooltip` + `aria-label`.** Playwright `getByTitle` therefore silently
  stops matching any control the test already hovered/clicked — locate by ROLE
  (accessible name survives the rewrite). Documented in
  `apps/web/smoke/override.smoke.ts`.
- **`behavior: 'smooth'` scrolling degrades to an instant jump** when Windows'
  reduced-motion setting is on (WebView2 honors `prefers-reduced-motion`).
  Deliberate glides are rAF-driven instead — `smoothScrollToTop` in the character
  route (wheel/touch cancels it).
- **`routeTree.gen.ts` is generated** — adding/removing a route *file* requires
  `pnpm generate-routes`; forgetting it is a silent 404. Its import ORDER follows
  the installed router-cli version: after a tooling bump the dev-server watcher
  rewrites it with a different ordering — **commit the regenerated file** (it's
  the new canonical output; restoring the old one just fights the watcher, which
  can even re-dirty it fast enough to block a `git pull` while `pnpm dev` runs).
- **Settings saves merge by baseline** — only fields changed on that page win,
  the rest re-read from disk (multi-window safety). A new settings field must be
  added to `studioSettingsSchema` AND covered by the page's `dirty` flag, or its
  value never reaches disk.
- **Character page sticky stack:** the character header (`sticky top-0`), ROM
  section titles (`top-[128px]`) and pose-table column headers (`top-[176px]`)
  overlap screenshots/crops — the guide-screenshot suite compensates per shot.
- **Immediate-persist flows go through `useCharacterDraft.persistPatch` — never a
  bare `saveCharacter` + settle from a component.** The audited bug class: scene/
  Houdini-link, avatar, and product-store flows persisted without `validate()`,
  without the `saving` single-flight, without regenerating artifacts, then wiped
  the dirty signal — silently committing invalid drafts with stale artifacts.
  `persistPatch` owns all of it (guards → optimistic patch → persist → regenerate
  → interim-edit-safe settle → rollback of exactly the patched fields on failure);
  side-effecting steps (file copies/moves) belong INSIDE its async patch producer
  so they run only past the guards. The form stays editable during a save, so
  `save()` snapshots the draft and only replaces it on settle if unchanged
  (`settleAfterSave`) — otherwise interim keystrokes are reverted. The hook has
  its own test suite (`use-character-draft.test.tsx`) — extend it with any new
  settle semantics.
- **`readManifest` throws on a CORRUPT `.dcsp`** (an existing file that won't
  parse) rather than returning defaults — else the next save writes defaults over
  the real settings, and `fetchProject` can never 404. It also throws a typed
  **`ProjectUnreachableError`** for a MISSING/OFFLINE project folder (an offline
  network share must not render as a phantom empty project); only an EXISTING
  folder without a `.dcsp` still reads defaults. Every multi-project loop over
  recents must therefore try/catch per project (findCharacterAcrossProjects/
  fetchAllCharacters/sweepTargets do).
- **Radix's modal `Dialog` sets `pointer-events: none` on `<body>`, and
  `document.elementsFromPoint` skips pointer-events-disabled elements** — so a
  modal Radix overlay silently breaks `lib/file-drop.ts`'s drop-through
  hit-testing. That's why `SidePanel` is built from the `radix-ui/internal`
  primitives (`FocusScope` + `DismissableLayer` — the exact pieces Dialog
  composes) instead of Dialog itself. Related: `DismissableLayer`'s Escape is a
  document-CAPTURE listener, so a component swallowing Escape via React
  `stopPropagation` (MultiSelect) cannot block a surrounding Radix layer's
  dismissal.
- **`role="combobox"` removes an input from `getByRole('textbox')` queries** —
  after the morph-autocomplete a11y work, tests locate those cells by
  `combobox`/`option` roles (rom-sections tests hit this).
- **The shell.open scope regex is anchored by the PLUGIN, not the config.**
  `tauri-plugin-shell` wraps the configured `plugins.shell.open` validator as
  `^{validator}$` before compiling (see the plugin's `lib.rs`), so the app's
  pattern in `tauri.conf.json` need not carry `^…$` — and an audit that reads only
  the `is_match` call in the plugin's `scope.rs` will wrongly conclude it's
  unanchored. It is anchored: only URLs, the allow-listed extensions, and
  trailing-separator folder paths match — NOT arbitrary `.exe`. The real residual
  is that `.dsa` IS allow-listed (it must be, to open a generated ROM script), and
  a `.dsa` executes in Daz — so `openNoteMedia`/attachments keep their OWN
  extension allowlist rather than trusting the broad shell scope.
- **A `.duf` frame count is deterministic per file version** — `measureFrames`
  caches it by `path|mtime:size`, so hover-preloads/generation don't re-parse tens
  of MB of DSON JSON. Resolved avatar data URLs cache by their content-versioned
  filename. Both are self-invalidating; follow this pattern, don't add TTLs.
- **Literal-char footgun when scripting edits:** writing a raw U+2028/U+2029 (or a
  NUL) via an editor tool that decodes `\uXXXX` escapes lands a real control byte in
  the source (grep then reports "binary file"; a raw U+2028 can even break the JS
  parse, since it's a line terminator there too). Emit the escape-sequence TEXT
  instead (author `\\u2028` so the file receives the escape sequence as text), or do the
  replace with a `String.fromCharCode`-based Node script. A printable delimiter like
  `|` (illegal in Windows paths) is a safe cache-key separator — never a NUL.
  or a `String.fromCharCode`-based replace; a printable separator like `|` (illegal
  in Windows paths) is a safe cache-key delimiter.

## Releases

- **GitHub releases are immutable** (since v0.44.7): a published release and its
  `latest.json` cannot be edited afterward. Never hand-publish without being sure
  `latest.json` is right — a broken one can't be fixed in place.
- **`github-actions[bot]` cannot create releases on this repo** (403 "Resource
  not accessible by integration" despite `contents: write`). The publish job runs
  on the `RELEASE_PAT` secret — if publishing ever 403s/401s again, **check the
  PAT's expiry first** before diagnosing anything else. See `.ai/release.md`.
