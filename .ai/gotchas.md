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
- **Immediate-persist flows must not settle from disk while the draft is dirty.**
  The editor's rename / avatar / scene-link flows save immediately; a settle that
  replaces draft+baseline with an on-disk read (which lacks unsaved edits) silently
  discards them AND clears `dirty`, so the unsaved-changes guard never fires. Use
  `syncPersisted` (merge only the changed fields) for these, never `settle`; the
  scenes-folder move was the bug (it read from disk). The form also stays editable
  during a save, so `save()` snapshots the draft and only replaces it on settle if
  it's unchanged (`settleAfterSave`) — otherwise interim keystrokes are reverted.
- **`readManifest` throws on a CORRUPT `.dcsp`** (an existing file that won't
  parse) rather than returning defaults — else the next save writes defaults over
  the real settings, and `fetchProject` can never 404. A MISSING `.dcsp` still
  returns defaults. Every multi-project loop over recents must therefore
  try/catch per project (findCharacterAcrossProjects/fetchAllCharacters/
  projectsForSweep do).
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
