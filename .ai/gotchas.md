# Gotchas — hard-won facts that are invisible in the code

Things that were learned by measurement or painful debugging. Verify against the
current code before relying on details, but assume the *lesson* still holds.

## Generation core

- **Frame math returns -1, not 0, for "no preset block"** — `presetEndFrame` is
  designed so the first custom pose lands at frame 0. Clamping to 0 introduces an
  off-by-one that `generate.test.ts` guards explicitly.
- **`mirrorGroup` flips word-initial Left/Right tokens plus the four side-marker
  case twins** (`_l`/`_L` suffix, `l_`/`L_` prefix — stock Daz JCMs use `_L`, G9
  bones use `l_`). Mid-word letters must survive: `CleftChin`, `Ball_Large`,
  `Curl_lower` are all test-pinned. A new marker pattern needs BOTH cases.
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
- **Per-scene override deltas merge SET-ONLY at runtime — disabling a preset block
  for a scene leaves the base's block keys stale on the config, and only the
  runtime's `bIncludeX` gate stops them leaking.** `buildSceneConfigMap` (`dsa.ts`)
  emits a scene's config as a whitelist-DIFF; the generated `sceneConfigLookupSnippet`
  applies it with `config[k] = delta[k]` — it can SET a key, never delete one. So a
  scene that turns a base-enabled preset OFF emits `bIncludeGP:false` while the base's
  `gpArtDirection`/`gpRomPath`/`presetFrames.gp` ride through unchanged. That is only
  safe because `DthWorkflow.dsa` dispatches each block builder under its flag
  (`if(options.bIncludeGP){ ApplyGP9(…) }`) and reads the block's `gpArtDirection`/
  `gpRomPath` INSIDE that builder — a stale key is never read while its `bIncludeX` is
  false. Two rules keep it that way: keep every block-scoped read behind its
  `bIncludeX` in the runtime, and keep all five `bIncludeJCM/FAC/DK/GP/Physics` in
  `SCENE_CONFIG_DIFF_KEYS` (they carry the OFF into the delta, which neutralizes the
  stale keys). A future runtime that reads a block field WITHOUT its `bIncludeX` gate
  would silently apply the base's value to a scene that disabled that block. Pinned by
  `scene-override.test.ts` "disabling a preset GEN for a scene now emits
  bIncludeGP:false".

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
- **"Clean" scene `.duf`s carry stray animation keys** (measured 2026-07-27 on the
  Ita_G9_GP doc assets): the JM Nipple product leaves 5 two-key channels on its
  graft's BONES (keys at frames 0 + 7; four value-flat, one actually changing) in
  every scene it's used in — while the Daz timeline shows nothing and
  `studio_scene_settings.animation_range` stays at its default. So a scene's
  timeline emptiness can NOT be judged from `scene.animations` max key time alone;
  `duf_scene` (poses.rs) counts only value-CHANGING channels on non-wearable node
  chains (a wearable's bones chain up through the conformed root before reaching
  the figure). The `animation_range` is stored in SECONDS and its default varies
  ([0,1] and [0,1.43] both observed on untouched scenes) — useless as a signal.
  The ROM runtime is immune to leftover RANGE (it `setTotalFrames`-resets), but
  leftover wearable keys do ride the export silently — tolerated, the whole doc
  pipeline was built on such scenes.

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
- **Every `@tauri-apps/plugin-fs` call needs its OWN `fs:allow-<cmd>` in
  `capabilities/default.json` — the ACL is per-command, not a blanket write grant.**
  Wide path scopes on `write-file`/`mkdir`/`remove` do NOT cover a sibling command:
  adding a new plugin-fs call (e.g. `copyFile`) without its `fs:allow-copy-file`
  permission throws `fs.copy_file not allowed. Permissions associated with this
  command: …` at runtime — but only in the built/`dev:desktop` app, since the ACL is
  compiled into the binary. No test layer catches it: the smoke `tauri-mock.ts` stubs
  each `plugin:fs|<cmd>` directly and never enforces capabilities, so vitest + smoke
  stay green while the real app is broken. This actually shipped — an audit PR switched
  the scene copy from a Rust command to plugin-fs `copyFile` and left copy dead until a
  rebuild grants the permission. When you add a plugin-fs verb, add the matching
  permission in the SAME change.
- **I/O-heavy commands must be `#[tauri::command(async)]`** or they freeze the
  window during long scans/installs.
- **NTFS is case-insensitive; byte-exact rel-path keys never converge.** Any
  HashMap keyed by relative path in a compare pipeline (install diff, dedup
  grouping, winner maps) must key on a Unicode-folded `rel_key()` — Windows
  preserves the DESTINATION's casing on overwrite, so a byte-exact lookup misses
  a case-variant installed file and re-copies it forever. Keep original casing in
  everything user-visible or written to disk (`fsutil.rs`). The rule covers more
  than map keys: destination lock striping (`lock_stripe`) and path-identity
  compares (`same_project_path`, the dedup source rails) must fold the same way —
  and with Unicode `to_lowercase()`, not `eq_ignore_ascii_case` (Ärger/ärger).
  It reaches the WEB layer too: any "delete what wasn't just written" sweep must
  filter case-insensitively (`removalSweepNames`, api/generate.ts) — `exists`/
  `remove` resolve case-insensitively on Windows, so a case-sensitive filter on a
  case-only rename deletes the very file just written.
- **There is NO `cargo fmt` gate and no rustfmt.toml** — the crate is
  deliberately written in a wider style than default rustfmt, and
  `cargo fmt --check` fails on the untouched tree. CI enforces clippy
  (`-D warnings`) + `cargo test --locked` only. Never run `cargo fmt` (it would
  reformat the whole crate); match the surrounding hand style.
- **A JS mirror of a Rust decision must be pinned by the SAME test cases on both
  sides** — the UI's `genesisRank`/`conflictWinner` (dedup-report-list) diverged
  from the Rust install THREE separate times: last-vs-first digit run, u32
  overflow (Rust `parse().unwrap_or(0)` saturates, JS `Number()` doesn't), and
  path ordering. If a rule lives on both sides of the FFI, its tests do too —
  with fixtures that exercise the divergent shapes, not just happy pairs.
- **Rust `Path` ordering is COMPONENT-wise, not full-string.** At a fork where
  one side ends a component (`…/_genesis 8/…` vs `…/_genesis 8.1/…`) the string
  compare sees `.` (0x2E) < `/` (0x2F) and picks the OTHER order (verified
  empirically). A JS mirror of any Rust path-ordered decision must split on
  separators and compare per component; same-parent test fixtures cannot catch
  this — the twin cases must fork across different parent folders.
- **Rust std reports NTFS junctions as symlinks** (`file_type().is_symlink()`
  true, `is_dir()` false). All fs walkers share `fsutil::walk_dir` with one
  explicit dir-link policy (link = leaf, counted) — a hand-rolled walker that
  forgets this either escapes into the junction target or `fs::copy`s a reparse
  point and fails the whole step. The policy also applies to a link AS the
  operation's root: `is_dir()` FOLLOWS links, so a mover must check
  `symlink_metadata` first and move the reparse point itself (cross-volume:
  refuse) — or it deep-copies the target's gigabytes and deletes the link.
- **Dedup's containment rails must cover source ↔ source, not just
  quarantine ↔ source** — the same folder listed twice (case variant) makes
  every asset an exact dup of ITSELF, and a source nested in another source is
  scanned once as a source and once as its parent's "asset"; either way apply
  would quarantine the only real copy. Sources are canonical-folded + deduped
  and nesting is a hard pre-scan error (test-pinned in `dedup.rs`).
- **Never do filesystem I/O (especially `fs::canonicalize`) while holding
  `PROJECT_WINDOW_LOCK` or the windows-map mutex** — the sync main-thread
  `active_project_file` waits on that mutex, and canonicalize on an offline
  SMB path blocks for the network timeout (seconds to ~30s), freezing every
  window. Precompute path keys BEFORE locking: each `ProjectMapping` stores
  its Unicode fold + canonical fold at insert time, so the in-lock find is
  pure string compares (`windows.rs`).
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
- **The guide SITE build (`scripts/build-guide-site.mjs`) is a separate pipeline
  from the screenshot suite's coverage guard.** Each guide asset dir
  (`screenshots/`, `clips/`, `gifs/`) must be BOTH `cpSync`'d into `site/guide/`
  AND reference-guarded. This shipped broken: `clips/` (animated `.webp`
  interaction clips) was referenced and coverage-checked but never copied, so
  `path-chip-copy.webp` 404'd **only on the deployed Pages site** — `pnpm build:guide`
  and the vitest coverage test both stayed green because they read `docs/guide`, not
  the built output. The build now re-checks the referenced sets against the OUTPUT
  (`site/guide/`), so a dropped or mis-pathed copy step fails the build. Adding a new
  guide asset dir needs its own `cpSync`; the output check then covers it.
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
  settle semantics. Round-two refinements: the baseline settles the moment the
  PERSIST lands (a generate failure warns and never rolls back a landed save),
  the pre-patch snapshot is taken AFTER the async producer resolves (edits typed
  during a slow producer survive), and even the inline rename rides persistPatch
  (`previousName`/`rethrow` options) — no flow holds save state by hand.
- **`Number('') === 0`, not `NaN`** — a numeric input that commits on blur via
  `Number(draft)` silently commits 0 when the user clears the field; an
  empty/whitespace draft must revert instead (NumberField, test-pinned).
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
  document-CAPTURE listener, so React `stopPropagation` (bubble phase) can never
  block a surrounding Radix layer's dismissal. The working counter (MultiSelect):
  a WINDOW-level capture listener registered while the widget is open — capture
  visits window before document, beating Radix regardless of registration order.
  An IME-cancel Escape (`isComposing`) must be CLAIMED there too —
  `stopImmediatePropagation` with no `preventDefault` and no action — or it
  falls through and closes the surrounding dialog mid-composition (Radix checks
  only `event.key`).
- **floating-ui's `useFocus` must stay enabled while an InfoPopup is pinned**
  (its escape-key handler arms the block-focus guard that stops the
  return-focus from re-peeking the popup) — but that also leaves its reference
  BLUR-close live, so `handleOpenChange` must ignore closes with
  `reason === 'focus'` while pinned, or Shift+Tabbing out silently drops the
  pin. Gating the hook off while pinned reintroduces the Escape re-peek loop;
  both edges are test-pinned in `info-popup.test.tsx` (with a switchable
  `:focus-visible` stub — a permanently-mouse stub masks the re-peek bug).
- **`role="combobox"` removes an input from `getByRole('textbox')` queries** —
  after the morph-autocomplete a11y work, tests locate those cells by
  `combobox`/`option` roles (rom-sections tests hit this). The JCM **bone** field
  (`bone-name-cell.tsx`) is a second such combobox — same query rule applies.
- **The `Scan_Morphs_<Genesis>` index feeds TWO autocompletes, from ONE file.**
  `DthScanMorphs.dsa` writes `morphs_<G>.json` (in app-data) with both a `morphs`
  array (morph dials) and, since index version 2 / RUNTIME_VERSION 34, a `bones`
  array (every `DzBone`'s `{ name, label }`). `fetchMorphIndex`/`fetchBoneIndex`
  read the two arrays from that same file, cached separately. Bones are otherwise
  skipped by the morph scan (they carry no morph dials). An old (v1) or
  never-scanned file just yields empty lists — re-run Scan_Morphs in Daz.
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
- **An `overflow-x-auto` rail clips its descendants to the PADDING box** (and
  forces `overflow-y` to `auto`). Anything a child draws OUTSIDE its own border —
  a Tailwind `ring` (box-shadow) or a negative-offset overlay like a hover-✕ — is
  cut off at the rail's first/last item, and can spawn a stray vertical scrollbar.
  Reserve rail padding equal to the overshoot: the docked scene/Unreal docks use
  `px-1.5 py-2` so the selected card's ring and the corner ✕ stay inside the clip
  region (`scene-footer.tsx` / `unreal-projects-field.tsx`). Playwright's overlay
  scrollbars hide the vertical half of this — assert the visible geometry (ring
  edge vs rail box, `scrollHeight <= clientHeight`), not just element presence.
- **`scrollbar-gutter: stable` on the root stops a viewport-fixed `inset-x-0` bar
  from reaching the window edge.** The reserved gutter sits outside the fixed
  element's containing block, so on a scrollbar-LESS page a docked footer lands a
  scrollbar-width short (measured 1265 vs a 1280 viewport), leaving an empty strip
  the bar can't cover. Dropped `stable` so the docks reach the edge — the accepted
  trade-off is the ~1-scrollbar sideways nudge between a tall tab and a short one
  that the reservation used to hide. `width: 100vw` "fixes" the gap in Playwright's
  overlay-scrollbar harness but re-introduces the classic 100vw horizontal-scroll
  bug under real (Windows/WebView2) scrollbars — measure both states before trusting a fix.
- **A CSS `scale`/`transform: scale()` rasterises the element at its LAYOUT size,
  then GPU-upscales that texture** — so an image shown via an up-scale is soft /
  aliased even from a high-res source. The header avatar rested at `scale: 1.55`
  (204px laid out → a 204px texture stretched to ~316px). Fix: lay the element out
  at the painted size (316px) and rest at `scale: 1` so the browser resamples the
  768px source straight to size; animate the zoom FROM 1 (see `editor-header.tsx`
  + `dth-avatar-zoom`). Two traps when sizing an `<img>` up: Tailwind preflight's
  `img { max-width: 100% }` silently CAPS an explicit width back to the container
  (needs `max-w-none`), and a `%` width on the replaced `<img>` was ignored
  outright — use fixed px. Verify with computed `getBoundingClientRect`, not the eye.
- **Hand the webview a large image to shrink and its edges ALIAS, not just soften.**
  The header avatar (a 256px Daz tip xBRZ-upscaled to a 768px master with hard
  edges) looked jagged when the browser scaled 768 down to the ~208px painted size
  in the composited scroll layer — the GPU path doesn't low-pass hard edges. The fix
  is to pre-resize server-side to the EXACT painted size × the screen DPR with a real
  low-pass and paint 1:1: a Rust `image`-crate **Lanczos3** pass (`downscale_avatar_png`
  in `avatar.rs`) returning raw PNG bytes (`tauri::ipc::Response` → an ArrayBuffer, not
  a JSON number array), resolved by `resolveImageSrcAtSize` and requested via
  `Avatar renderPx`. A canvas `imageSmoothingQuality:'high'` pass is NOT good enough
  here — it came out mushy; Lanczos was the one that read crisp. Diagnostic tell: if a
  static side-by-side shows the browser downsample ≈ a hand pass, the defect is
  aliasing (missing low-pass), not the resample quality.

## Releases

- **GitHub releases are immutable** (since v0.44.7): a published release and its
  `latest.json` cannot be edited afterward. Never hand-publish without being sure
  `latest.json` is right — a broken one can't be fixed in place.
- **`github-actions[bot]` cannot create releases on this repo** (403 "Resource
  not accessible by integration" despite `contents: write`). The publish job runs
  on the `RELEASE_PAT` secret — if publishing ever 403s/401s again, **check the
  PAT's expiry first** before diagnosing anything else. See `.ai/release.md`.
