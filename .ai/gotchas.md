# Gotchas — hard-won facts that are invisible in the code

Things that were learned by measurement or painful debugging. Verify against the
current code before relying on details, but assume the *lesson* still holds.

## Generation core

- **Export outputs are never housekept by the studio.** Everything under the
  character's export directory is written Daz-side at script run time (the
  Exporter Plugin's `.abc`/`.fbx`/`Reference Skeletons/`, the script-copied
  CSV). A layout change — renaming a scene's subfolder (which renames its
  export subfolder), or the runtime-v37 always-subfolder switch itself — only
  changes where FUTURE runs land; previous outputs stay at the old spot, so
  layouts can coexist until the user cleans up. Deliberate so far: exports are
  user deliverables (large, possibly open in Houdini) — don't auto-move/delete
  them without an explicit user action.

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

- **The DS6 Constant-keyframe workaround is dead — don't reintroduce it.** Runtime
  v17 stamped every ROM key CONSTANT on DS6 (a workaround for DS6 drifting Linear
  ROM keys). Rolled back in runtime v35: it didn't actually fix the drift and
  broke the DK9 ROM; mrpdean removed the same workaround from the DTH release
  (July 2026). Keys are LINEAR everywhere again, and the runtime no longer
  version-detects DS6 for interpolation.
- **A failed script `include()`/load logs nothing** in Daz Studio. Diagnose with a
  minimal probe `.dsa` that logs before/after the suspect statement.
- **`include()` must be top-level** in DS6 — a legacy include inside a function
  throws `URIError: Legacy Include` (regression-guarded in `generate.test.ts`).
- **`App.openFile(path, false)` replaces the current scene without a save
  prompt** — the generated per-character `Open_Scene` script warns the user first.
- **DS6 removed `DzContentMgr.saveScene`** (probe-measured 2026-07-30: calling it
  is a TypeError) — the script-side scene save-as moved to **`Scene.saveScene(path)`**,
  which saves silently and writes the `.tip.png` thumbnail beside the `.duf`.
  Generated scripts feature-detect (`typeof … == "function"`): the DS4
  content-manager call first, `Scene.saveScene` as the DS6 path (runtime v42 —
  the v40/v41 ROM-scene auto-save silently skipped on DS6 because of this,
  leaving `.ROM_Animations/` created but empty). Same removal family as
  `App.getExportMgr()`, which DS6 also dropped.
- **Command-line forwarding to a running Daz instance stops working once a scene
  is loaded** — full "open in running instance" automation isn't possible from
  scripts alone; that's why the studio ships an Open_Scene script instead.
- **Fast runtime test loop:** copying an updated `.DthUtils.dsa`/`.DthWorkflow.dsa`
  over the installed one in `<Daz library>/Scripts/DTH-Character-Studio/` and
  re-running the character's ROM script is enough — no app rebuild needed. (Only
  the dot-prefixed name needs matching; a runtime file that references no sibling
  runtime by name needs no `../../` rewrite either — see the install-rewrite rule
  above.) **Iterating twice within ONE `RUNTIME_VERSION` is where this bites:**
  `.dth-runtime-installed` still matches, so even a rebuilt app SKIPS the whole
  reinstall on save and keeps running the older bundled runtime — Tools → Refresh
  assets (which passes `force`) is what actually replaces it. A second fix inside
  the same unreleased version bump therefore looks like "my change had no effect".
- **A Daz Content Library tile is just a same-named PNG beside the file** —
  `<base name>.png` at **91×91** for the tile, `<base name>.tip.png` at **256×256**
  for the hover preview (both verified against the stock `Genesis 9.png` /
  `Genesis 9.tip.png`). No manifest, no metadata: Daz matches on NAME alone, so
  renaming a script without renaming its artwork silently reverts the tile to a
  broken-image placeholder. The studio bundles the four PNGs via Vite `?inline`
  (base64 data URLs — the app stays one self-contained binary, no asset fetch under
  the strict CSP) and `writeFile`s the decoded bytes in `copyRuntimeFiles`; they're
  folded into the runtime hash guard so a changed icon must take a
  `RUNTIME_VERSION` bump to reach existing installs, like any other runtime file.
- **Artwork for a GENERATED script has to survive the stale-artifact sweep.**
  `generateCharacterFiles` sweeps the character's script folder by listing every
  name the character COULD have and removing what wasn't just written — and
  `<script>.png`/`.tip.png` are on that list, so unless `writeScriptIcons`'
  return value is folded into the written set, the sweep deletes the tiles the
  line above just wrote. That two-way listing is also what retires them
  correctly: turn the split export off and `Export_<base>.png` goes with
  `Export_<base>.dsa`. Which art a script gets is decided in the PURE core (the
  `icon` tag on a `GeneratedFile`) because it follows a rule the core owns —
  `ROM_<base>.dsa` is one file name for two different scripts, one that also runs
  the export and one that doesn't — while the bytes stay in the host
  (`storage/script-icons.ts`, keyed by the `ScriptIcon` union so the map can't
  drift from the tags).
- **A hidden runtime `.dsa` must never `include()` a sibling runtime by name.**
  `copyRuntimeFiles` blindly rewrites every `"<Dep>.dsa"` string inside a
  RUNTIME_FILES entry to `"../../.<Dep>.dsa"` — correct for an include resolved from
  a character script two levels down, fatal for the same file included by a VISIBLE
  root-level script (`Build_Genesis_Index.dsa`, `Scan_Frames.dsa`), which lives at
  the runtime root. So the visible wrapper does the includes, in dependency order
  (`.DthUtils.dsa` first, then the scanner), and the scanner just calls the utils
  functions as globals. The rewrite is string-blind: even a double-quoted runtime
  filename in a COMMENT gets repointed.
- **The stock figure/graft content paths are not what you'd guess** (measured
  2026-07-29 against a real "My DAZ 3D Library"): the G8 base figures are
  `People/Genesis 8 <Sex>/Genesis 8 Basic <Sex>.duf` (not `Genesis 8 <Sex>.duf`), and
  **Genesis 8.1 installs INTO the Genesis 8 folder** —
  `People/Genesis 8 Female/Genesis 8.1 Basic Female.duf`. G3 and G9 are the plain
  names (`People/Genesis 3 Female/Genesis 3 Female.duf`, `People/Genesis 9/Genesis 9.duf`).
  The G9 geografts are **wearable** presets (so the target figure must be SELECTED
  before `openFile`), and they are third-party — they reship under new names and
  folders, so `Build_Genesis_Index` does NOT trust a path for them (see the scored
  glob below).
- **A name glob for a geograft product finds the OTHER GENERATIONS' versions too, so
  the pick has to be generation-scored.** Measured over a full library (14,902 `.duf`
  under `People`, 2026-07-29): `*Dicktator*` also returns
  `People/Genesis 8 Male/Anatomy/Dicktator v3/1_Dicktator Genitalia 0.3.duf`, and
  `*Golden*Palace*` returns `…/Genesis 8 Female/Anatomy/Golden Palace v2/1-GoldenPalace_Genitalia_v2.duf`
  — fitting either to a Genesis 9 figure would be wrong. `dthPickAsset` therefore
  scores candidates with the generation term DOMINANT (`genesis 9` +100 vs
  `genesis 2..8` −100) over the completeness terms (`smart` +50, `graft|genitalia`
  +20), rejects the neighbours outright by name (`DTH_PICK_REJECT`: shells, UV fixes,
  rigidity, material/pose/shape presets, hair loaders), and requires a POSITIVE
  score — so a library with only the G8 products resolves to nothing and reports "not
  installed" instead of loading the wrong graft. Ties break on shorter file name then
  shorter path, never on directory-listing order. The ranking is CI-pinned against
  that measured candidate set in `runtime.test.ts`, which loads the `.dsa` itself via
  `new Function` (the runtime is plain ECMAScript — it only touches Daz APIs from
  inside functions, which makes its pure logic directly unit-testable).
- **Load the geograft's SMART preset, not its `00-Manual Setup` graft — only the
  Smart one brings the geoshells.** Measured by reading the DSON (2026-07-29):
  `00-Manual Setup/2-Golden Palace Graft.duf` and `00-Manual Setup/1-Dicktator.duf`
  add the graft node alone, while `2a-Golden Palace Smart_Vanilla.duf` also adds
  `GoldenPalace_G9_Shell_Minora`/`_Shell_Majora` and `1-Dicktator_Smart.duf` adds
  `DicktatorG9_Shell`/`DicktatorG9_ForeskinShell`. Every one of those nodes declares
  `parent: "name://@selection:"`, so with the figure selected at load time the shells
  become CHILDREN of the figure and `getNodeChildren(true)` scans them — pick the
  manual graft and the shells are simply absent from the scene (that shipped in the
  first cut of the index builder, and shows up as "no geoshells under the figure").
  The Smart preset also rigs slightly more bones (`l_shin`/`r_shin`/`spine2`), so it
  yields a richer bone index too.
- **A geograft cannot be detected through the DS6 script API — read the GEOSHELL's
  surface labels instead.** Measured 2026-07-31 (DS 6.0, Genesis 9 + Golden Palace +
  STX nipples/navel, probe dump of all 576 nodes): `DzFigure.isGraftingActive()` and
  `DzFacetMesh.getGraft()` are **not exposed to DAZ Script** at all, and a geograft is
  otherwise indistinguishable from any other fitted `DzFigure` — `Genesis9Tear`,
  `Genesis9Eyes` and `Genesis9Mouth` report the same `getFollowTarget()` as the grafts
  do. What IS legible: a geoshell node is class **`DzGeometryShellNode`** (its geometry
  is `DzShellDummyFacetGeometry`), and it carries one `DzBoolProperty` per surface at
  path **`/Shell/Visibility/Surfaces`**, named `material_group_<label>_vis`, where
  `<label>` is `<graftNodeName>_<materialName>` for a graft-contributed surface
  (`stx_gen_9_nipples_feminine_Body`) and the bare `<materialName>` for the figure's
  own (`Body`, `Head`, `Legs`…). So the shell's own property list names every graft on
  the figure — that's how `DthShellSurfaces.dsa` identifies them. Note the shell's
  `/Shell` > `Shell Node` property points at the shelled FIGURE (`Genesis9`), never at
  the graft the shell belongs to, so "whose shell is this" needs the product-family
  match (with a name-prefix fallback) that module does.
- **Fitting a geograft turns its surfaces ON in every geoshell already on the figure**
  (same measurement). Add STX nipples/navel to a figure that already has the Golden
  Palace shells and the shell renders over the new graft — the fix is to switch those
  rows off on the GP/DK shells, which is what the bundled `Fix_Graft_Shell_Surfaces`
  script does. Only genital-graft shells are in scope: a tattoo or skin-overlay shell
  legitimately WANTS the graft surfaces on, so a blanket sweep over every
  `DzGeometryShellNode` would break those.
- **`DzContentMgr.findFile(rel, DzContentMgr.AllDirsAndCloud)` is the supported way
  to resolve a content-relative path** (confirmed against Daz's own shipped scripts
  under `data/resources/Lesson Strips`, which use exactly that two-arg form). Content
  ROOTS are less certain, so the index builder derives one guaranteed root from its
  own install location (`<lib>/Scripts/DTH-Character-Studio` → `<lib>`) and treats
  the `getNumContentDirectories()`/`getContentDirectoryPath(i)` enumeration as
  typeof-guarded extra. `DzNewAction` is NOT a scriptable "clear the scene" — it opens
  the New Scene dialog; use `Scene.clear()` (guarded, with a remove-every-root-node
  fallback).
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
- **Apps launched via the shell plugin's `open()` inherit the STUDIO's process
  environment** — not the user session's. Measured 2026-07-30: a `.hiplc`
  opened from the studio started Houdini WITHOUT the DazToHue shelf (Houdini
  resolved its preferences dir from leaked `HOME`/`HOUDINI_*` of the studio's
  parent shell), while an Explorer double-click was fine. Fix: `shell_open_file`
  (shellopen.rs) delegates the open to `explorer.exe <file>` — the child is
  then spawned by the SHELL with the pristine session environment, identical
  to a double-click by construction. `openScene` (attachments.ts) routes
  file opens through it (shell-plugin fallback); URL opens keep the plugin.
  FOOTGUN: explorer.exe accepts BACKSLASH paths only — a '/'-joined path
  makes it silently open a folder window instead of the file's association
  (shell_open_file converts before spawning).
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
- **The DTH Exporter is only scriptable in Daz Studio 6.** Driving it needs
  `MainWindow.getActionMgr().findAction("DazToHueExporterAction")` →
  `doExport(dir, name, referenceFrames, saveSettings)` — introduced with the DS6
  exporter plugin 1.8.1. The **Daz Studio 4 build has no scripted export at
  all**: measured on a DS4 install whose exporter dialog reports 2.0.1, its
  action is class `ExporterAction` / name `DazToHue_Action` (so the class lookup
  misses it entirely), carries 28 methods that are all inherited DzAction/QAction
  members, and a sweep of ALL 912 registered actions plus the global script scope
  found no `doExport*` anywhere. `trigger()` only opens the dialog.
  Consequences: (1) never treat finding the action as proof it can export — gate
  on `typeof doExport == "function"`; (2) the DLL version is no guide, the DS4
  build stamps FileVersion 1.0.0.1 while reporting 2.0.1 in its UI, and the DS6
  build has no version resource at all; (3) automated export — the ROM script's
  export block and the whole bulk DTH Export flow — is DS6-only, even though the
  Runner plugin itself does load in DS4.
- **Creating a directory link on Windows: junction, not symlink.** A junction
  (`IO_REPARSE_TAG_MOUNT_POINT`) needs NO elevation; a directory SYMLINK needs
  `SeCreateSymbolicLinkPrivilege` (admin) or Developer Mode plus
  `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE`, so `std::os::windows::fs::
  symlink_dir` simply fails for an unelevated studio. std has no junction API at
  all — `junction.rs` writes the reparse point itself via
  `FSCTL_SET_REPARSE_POINT` (substitute name wants the NT `\??\` prefix; the
  declared name lengths EXCLUDE their NUL terminators). The price: a junction
  can only target a LOCAL absolute path — never UNC or a mapped network drive.
- **`fs::remove_dir_all` on a folder CONTAINING a junction removes the link, not
  the target's files** (measured on this repo's Windows, Rust std). That is what
  makes the `dth-exports` junction safe to place inside a Houdini project folder
  the user may delete. Do NOT assume the same of other tools: PowerShell's
  `Remove-Item -Recurse` has historically recursed through reparse points, and
  `p4 clean` / `reconcile -d` may treat the junction as an untracked extra. The
  studio's answer is not to trust any of them — the junction carries no data and
  is recreated on the next Generate project.
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
- **Windows refuses to rename a DIRECTORY while any file INSIDE it is open in
  another process** — `ERROR_ACCESS_DENIED (os error 5)`, not the sharing
  violation you'd expect, and it names neither the open file nor the process.
  A character-folder rename hits this constantly: the linked `.duf` is usually
  still open in Daz Studio. Measured from a report on a Perforce workspace; the
  studio itself was NOT the holder (scene previews and avatars are `readFile`'d
  into data URLs — `api/avatars.ts` — so the webview keeps no handle, and the
  Rust crate has no watcher and never `set_current_dir`s). Detection keys off
  the `(os error 5|32)` suffix, never the message text: `std::io::Error`'s
  wording is localized by Windows, so "Access is denied" only appears on an
  English install (`isLockedPathError`, `storage/fs.ts`). Transient holders (AV,
  search indexer) clear within a few hundred ms, so `renameWithRetry` absorbs
  them; a persistent one gets the mapped "close it in Daz Studio" message from
  `renameCharacterPath` (`storage/characters.ts`). The rename is the FIRST write
  in `saveCharacter`, so a failure aborts the save cleanly — never half-renamed.

## Web app

- **A `disabled` button still RECEIVES pointer events in Chromium** — only
  click/activation is suppressed. So `fieldset[disabled]` does NOT stop
  dnd-kit's `onPointerDown` drag handles: a read-only ROM section stayed
  reorderable until the fieldset's read-only classes added
  `[&_button]:pointer-events-none` (the forbidden cursor survives — a
  pointer-events-none element takes its ancestor's cursor). Any future
  pointer-listener control inside the read-only fieldset needs the same
  treatment (`rom-sections.tsx`).
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
- **A map keyed by `normalizeSceneKey` must normalize AT THE ACCESSOR — never
  trust callers to.** `sceneDthPath` looked up `sceneExportFolderRel`'s
  lowercase-keyed map with the caller's raw scene path; the export dialog passes
  the character's STORED paths, and every real Windows path has a capital letter
  in it, so every lookup missed — "Export too" built an empty job and died on
  "none of these scenes has an export path" on every real run. The pure tests
  stayed green the whole time because they fed themselves pre-normalized keys,
  the one spelling no real caller ever uses — which is exactly how it shipped
  broken (#637, fixed in #641). Apply the fold inside the accessor
  (`sceneDthPath`/`buildHoudiniJob` do now) and give any normalized-key lookup
  at least one RAW-spelling test case (`houdini-jobs.test.ts` pins both).
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
- **The click that re-focuses the app window must never backdrop-dismiss an
  overlay** — with a dialog open and the native window unfocused, the user's
  click back into the app often lands on the backdrop. Both kit overlays route
  `onPointerDownOutside` through `packages/ui/src/refocus-click.ts` (a
  blur/focus/pointerdown state machine — identity-marks the first pointerdown
  after a window blur if it lands within 400 ms of the `focus` event, or before
  it); any new dismissable overlay must do the same. Measured Radix detail:
  modal `Dialog` DEFERS the outside dismiss to the *click* after the
  pointerdown (`deferPointerDownOutside`), but `detail.originalEvent` is still
  the pointerdown — so the identity guard works for both, and a jsdom test must
  fire `pointerDown` **and** `click` to dismiss a Dialog (SidePanel's bare
  `DismissableLayer` dismisses on pointerdown alone).
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
- **The `Build_Genesis_Index` index feeds TWO autocompletes, from ONE file per
  generation.** `DthScanMorphs.dsa` writes `morphs_<G>.json` (in app-data) with both
  a `morphs` array (morph dials) and, since index version 2 / RUNTIME_VERSION 34, a
  `bones` array (every `DzBone`'s `{ name, label }`). `fetchMorphIndex`/`fetchBoneIndex`
  read the two arrays from that same file, cached separately. Bones are otherwise
  skipped by the morph scan (they carry no morph dials). An old (v1) or
  never-scanned file just yields empty lists — re-run Build_Genesis_Index in Daz.
  Since runtime v39 ONE run writes all four generations (index `version: 3`, with a
  `figures` array naming what was scanned); the readers only ever look at `morphs` +
  `bones`, so the metadata is free to change. The BUILD path owns the scene — it
  clears between generations and again after the last one (v41), so a run ends
  empty; the "scan the open scene" branch must never clear, it is the user's own
  scene and the only way third-party grafts/clothing get indexed.
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
- **`beforeBuildCommand` runs with CWD = `apps/desktop`** (the tauri config
  dir), not the repo root — a ROOT package.json script must be invoked as
  `pnpm -w <script>` or pnpm resolves it recursively and fails with
  "Command not found" (broke the v0.51.0 release build; the PR-CI rust job
  never runs the hook, so only a real release surfaces it).
- **`process.exit()` in a Node script that used `fetch` can crash on Windows**
  (Node 24 libuv assertion `!(handle->flags & UV_HANDLE_CLOSING)`, exit
  0xC0000409) — undici's handles are still winding down. Let the script end
  naturally instead (measured in scripts/fetch-runner.mjs's skip path).
- **tauri-build hard-fails on a `bundle.resources` glob that matches nothing**
  — a gitignored, build-time-staged resource dir needs a build.rs seed (see
  the dth-runner placeholder in apps/desktop/build.rs) or plain
  `cargo check`/`clippy` breaks on fresh clones and CI.
