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

- **The DAZ Install Manager already knows every Daz path, and stores them at a
  FIXED location — never search the disk for DIM.** Measured on DIM 1.4.1.96
  (2026-08-07), three plain INI files under `%APPDATA%/DAZ 3D`
  (`configDir()` in Tauri; `BaseDirectory.Config = 3`), independent of where DIM
  itself was installed:
  - `dzInstall.ini` → `[General] InstalledApplications` (space-separated keys)
    + `[ApplicationPath] dzStudio6InstallDir-64=C:/Program Files/DAZ 3D/DAZStudio6`.
    This is how the studio tells DS4 from DS6 without probing Program Files.
  - `InstallManager/Settings/AppSettings.ini` → `CurrentUser`, which NAMES the
    next file. It is the account TITLE, not the literal "Account".
  - `InstallManager/UserAccounts/<CurrentUser>.ini` → `CurInstallPath` (the
    library), `OverrideManifestDir`, `DownloadPath`, `Software64Path`, and
    `[InstallPaths]` as a Qt list (`size=N`, `<i>\InstallPath`).
  Three traps, each paid for: (1) **`Override*` keys only exist once the user
  changed them** — absence is the DEFAULT install, whose manifests live under
  Public Documents, so absence must not read as "not configured"; (2) a second
  section (`[ApplicationTags]`) carries its own `size=`, so a section-blind INI
  parse reads 37 content libraries; (3) **the account INI holds the user's
  credentials** (`Account=<256 hex>` next to `RememberPassword=true`), which is
  why `parseDimAccountIni` is a named whitelist and has a test asserting the
  blob never escapes. Parsing lives in `apps/web/src/lib/daz-install.ts` (pure,
  unit-tested), the file-finding in `lib/rom/api/daz-install.ts`. DIM keeps
  listing an app it has uninstalled, so every card is checked against the disk.
- **SideFX registers every Houdini install — read the registry, don't probe
  Program Files.** Measured 2026-08-07 on a machine with two installs:
  `HKLM\SOFTWARE\Side Effects Software\Houdini` holds one REG_SZ per version,
  value NAME = the four-part version, DATA = the install folder:
  `20.5.0.864 → C:\Program Files\Side Effects Software\Houdini 20.5.864\`.
  Three traps: (1) the same key carries **non-version values** (`LicenseServer`),
  so filter by `<n>.<n>.<n>.<n>` shape; (2) the data ends with a **trailing
  backslash** every TS-side join/compare assumes away; (3) the registry version
  is NOT the folder's spelling — `22.0.0.368` vs `Houdini 22.0.368`, the third
  component dropped — so never derive one from the other. Reading it is the only
  reason `houdini_install.rs` is native (windows-sys + `Win32_System_Registry`,
  no new crate); pairing/ordering is TS in `lib/houdini-install.ts`.
  **The prefs folder lives in TWO possible roots.** `houdini<major>.<minor>` was
  found under BOTH the (redirected) Documents folder `D:/User Data/Documents`
  and `%USERPROFILE%` on the same machine — Houdini falls back to home — so a
  detection that knows only `documentDir()` pairs half the installs with
  nothing. Documents wins when both hold the same release. And a prefs folder
  can outlive its install (`houdini21.0` with no Houdini 21 registered), so an
  orphan is reported, never treated as an install.
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
  prompt** — relied on by both open-in-running-Daz paths: the forwarded one-shot
  `.dsa` bridge (`api/attachments.ts` `openSceneInRunningDaz`) and the Runner's
  `open-scene` job (`api/execute.ts`). The per-character `Open_Scene` script
  that once wrapped this with a warning dialog was removed at runtime v22.
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
  scripts alone. Forwarding a `.dsa` still works, so opening a scene in a
  running Daz goes through a forwarded one-shot script bridge
  (`api/attachments.ts`) or the Runner plugin's `open-scene` job
  (`api/execute.ts`) — the per-character `Open_Scene` script this bullet used
  to name was removed at runtime v22.
- **A CLOSING Daz can still claim the export job file on a final poll tick**
  (measured 2026-08-03 via the DTH Export flow): quit Daz, hand a batch off
  right after — the lingering process's Runner poll can still fire, rename
  `dth_exporter_jobs.json` to `running_…` (the rename IS the claim) after the
  studio's ~10s pickup wait already gave up, then exit without running a row.
  Nothing ever polls for the `running_` name, so that batch is orphaned
  forever unless the studio takes it back. Hence the studio-side RECLAIM
  (`launchDazForPendingJobs` → one atomic `rename` back to pending, gated by
  `isReclaimableBatch`: bulk-export + progress 0 + every row pending, and only
  once the process is GONE) — owned by exactly ONE code path. The export
  watch (`fetchExportRunProgress`) only DETECTS the state and reports
  'pending' for it, never deletes/reports 'dead': its 2.5s tick otherwise
  races the wait-modal's 1s tick and deletes the very batch being rescued —
  and a 'dead' report disarms the run, silently dropping the finish toast and
  the "Export too" continuation. Two corollaries: "the pending file
  disappeared" NEVER means "claimed and not my problem"; and the wait-for-close
  modal may only stand down once the claimed batch shows real work
  (`exporterJobsWorking`) — a live Daz stuck on a modal Save prompt claims
  late and looks identical to the closing claim until its first row mark.
- **A `bulk-export` handoff leaves its claimed `running_…json` behind unless
  something watches it to 100** (measured 2026-08-10, first live Import-from-Daz-scene
  run): the Runner renames the job file and marks it done, but DELETING the
  finished file is the STUDIO's side of the contract, and the only thing doing
  it is the export flow's progress watch. Any new flow that reuses the
  `bulk-export` type without arming that watch — the headless frame scan does —
  must sweep the file itself, and only at `progress: 100` (a live batch's file
  belongs to its own run). `fetchSceneScanProgress` → `clearFinishedJobFile` is
  the pattern; `sweepFinishedOpenScene` is the same job for `open-scene`.
- **A `bulk-export` batch resets Daz to an EMPTY SCENE when it finishes**, so a
  silent run looks from the outside exactly like nothing happened: no dialog
  (by design — a modal would block a runner nobody is watching), and the scene
  it just opened is gone again. Not a defect, but every UI on top of this type
  has to say so, or the user concludes the feature is broken while it is
  working. (`open-scene` is the exception — the Runner skips the reset for that
  type.)
- **Every writer of the single global job file needs the claim-wait, not just
  the exists-check.** The exists-checks refuse to clobber someone else's batch;
  they do nothing about a batch NOBODY takes — a Daz running without the Runner
  plugin, or one shutting down. Its pending file then blocks every later export
  and scan with "a batch is waiting for Daz Studio", with no abort in sight.
  The rule: after `assertHandoffOwned`, when Daz was already running, poll
  `OPEN_SCENE_PICKUP_TIMEOUT_MS` for the rename and take the file back when it
  never comes (`openSceneInRunningDaz`, `startProjectScan`, `startSceneScan`).
  When the studio LAUNCHED Daz itself the wait can't apply — a cold start
  outlasts it — so that path owes the user an abort instead
  (`abortProjectScanRun`, `abortSceneScan`), including on dialog dismissal.
- **A destructive confirm built on a focus-refreshed readout is confirming a
  SNAPSHOT, not the file.** `useRefetchOnFocus` re-reads on mount and window
  focus — and nothing else — so a readout stays as it was for as long as the
  window keeps focus. That is fine for anything descriptive, and wrong the
  moment a warning computed from it is the only guard on an irreversible
  action: the job-file readout in Settings → App Data can say "written, never
  claimed" (no amber warning) while the Runner has since renamed the file
  INSIDE Daz and started working it, and the delete then takes a live batch
  away. The fix that generalizes: hash what was shown
  (`exporterJobFilesSignature` — state only, never age, which ticks and
  decides nothing), pass it to the destructive call, and have that call
  re-read and refuse on a mismatch (`ExporterJobFilesChangedError`). Re-read
  when ARMING the confirm too, so the warning being weighed is current.
  Applies to any future "show state → confirm → mutate" pair over a file
  something outside the app writes.
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
  `node:vm` `runInNewContext` (the runtime is plain ECMAScript — it only touches Daz
  APIs from inside functions, which makes its pure logic directly unit-testable).
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
- **Stripping a scene's animation from script WORKS — verified live 2026-08-07**
  on a real old ROM scene (`Kill_Animation` / `DthKillAnimation.dsa`, its first
  run in Daz). The scene came back character-only with a 0–30 timeline and was
  accepted by the add-scene check. Two things the design got right, and one that
  stays unknown:
  - **`Scene.setTime(0)` BEFORE deleting** is load-bearing, not hygiene: a
    property with no keys keeps the value it currently evaluates to, so clearing
    keys while the scene sits at frame 250 would bake a ROM pose in as the
    scene's rest state.
  - **Bones and morphs need separate walks.** ROM rotation lives on the figure's
    BONES (child nodes — `Scene.getNodeList()` alone never reaches them; use
    `getNodeChildren(true)`), and morph values live on the modifiers'
    `getValueControl()`, which is NOT in `getPropertyList()`. Miss either and
    the scene still fails the timeline check. Same split `DthScanFrames.dsa`
    makes, for the same reason.
  - **Which deletion route ran is still unmeasured.** The script tries
    `DzProperty.deleteAllKeys()` and falls back to descending `deleteKey(i)`
    (deleting a key renumbers the ones after it), and does not report which one
    took — so "it works" confirms the PAIR, not `deleteAllKeys()` on its own.
    Keep both, and keep the read-back that turns a wrong assumption into a named
    failure rather than a silently still-animated scene.

## Desktop / Tauri

- **Never create a webview window from a synchronous `#[tauri::command]`** — it
  deadlocks (white frozen window). Use `#[tauri::command(async)]` and
  `tauri::async_runtime::spawn` (the single-instance handler does this).
- **Houdini runs a `456.py` on HOUDINI_SCRIPT_PATH for the startup EMPTY scene
  too, not only for a loaded `.hip`** — measured 2026-08-11 on the first
  headless "Export too" run: hython started, the empty initial scene triggered
  the studio's 456.py, the job was consumed against zero nodes ("nothing to
  export" in 2 s), the env popped, and `closeWhenDone` exited the process
  before the bootstrap ever loaded the real project. The headless launch
  therefore never touches HOUDINI_SCRIPT_PATH; `headless_export.py` loads the
  scene and execs `456.py` itself, exactly once. Any future script that hooks
  scene loads via that variable must expect the empty-scene call.
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
- **DazToHue HDA multiparms are 0-BASED** — `multiParmStartOffset()` returns
  `0`, not Houdini's usual `1`. Measured 2026-08-06 on DazToHue 2.5 / Houdini
  22.0 across the material node's `material`, `material_uv_channel` and
  `material_texture_baker` blocks. A `range(1, count + 1)` loop therefore drops
  instance 0 AND reads one past the end — which looks like real data (a
  "missing" trailing baker) rather than an error. ALWAYS read the offset from
  the parm; never count from 1. Same 0-based convention as the ROM frame math,
  by coincidence rather than by contract, so don't infer one from the other.
- **The repo's ~250 lint warnings are DECISIONS, not debt** — `.oxlintrc.json`
  documents why each rule is advisory (sequential awaits are deliberate fs
  ordering, `__TAURI_*` globals are the Tauri contract, the react-markdown
  component maps are nested by design). Don't "clean them up". What that volume
  *does* break is noticing a NEW one, so `pnpm lint:budget` pins the count PER
  RULE in `.lint-baseline.json` and CI fails when it grows. Adding an
  intentional instance = bump the baseline in the SAME commit
  (`pnpm lint:budget:update`), which forces the judgement to be made rather than
  absorbed.
- **"A `.hip` always holds absolute paths" is FALSE — the real constraint is
  `$JOB`.** A Houdini project can be authored entirely relative, and the
  studio's own Generate project does exactly that (`$JOB/<houdiniSubdir>/
  daz-export/…`). Moving one safely needs BOTH: every reference relative, AND
  its `$JOB` project folder travelling with it. The studio links Houdini
  projects in place rather than copying them because it can guarantee neither
  property for a `.hip` authored elsewhere — not because relative authoring is
  impossible. Corrected 2026-08-06 (the earlier wording came from a workflow
  that happened to use absolute refs); state the reason this way, or the next
  reader concludes movable Houdini projects can't exist.
- **A version bump makes a refresh RUN; it does not make a migration HAPPEN.**
  The export-root move bumped `RUNTIME_VERSION`, which is necessary — no
  bump, no refresh, nothing regenerates. It is not sufficient, and the failure is
  silent in the worst way: the refresh regenerates from the STORED path, so it
  re-emitted the old folder, stamped the new version, and cleared the staleness
  that was the only sign anything was owed. The character then reads as fully up
  to date on a root it never moved off. **Ask two questions, not one:** does the
  bump make the sweep visit this character (version), and does the sweep contain
  code that performs the migration (wiring)? They are answered in different files
  — `RUNTIME_VERSION` in `packages/rom/types.ts`, the wiring in `refreshAllAssets`
  — and the second is the one that gets forgotten. A migration that only hangs
  off the character SAVE reaches the characters the user happens to open.
- **A cache key must cover everything the cached ANSWER depends on, not just the
  file it was read from.** The Houdini scan store is keyed on `<hip>|<mtime>`,
  and one third of its answer (`refs.broken` — do the files the import paths name
  exist?) is about files that are not the `.hip`. The export-root move
  relocated every one of them without touching a single `.hip`, so the store
  would have kept serving "all resolve" for exactly the projects the move broke,
  until the user happened to re-save one in Houdini. The export root is in
  `scanKey` now. The general shape: when a cached verdict is about the RELATION
  between a file and its surroundings, the surroundings belong in the key.
- **…and the QUESTION belongs in the key too.** Same store, measured
  2026-08-12: adding `imports` (which `.dth` each network imports) taught the
  scan to answer something new, but the key still described only the inputs —
  so every existing entry stayed "fresh" while answering the new question with
  an empty list. The reader treats empty as "not known" (correctly — an
  unscanned project must never be dropped on ignorance), so the feature was
  dead on every machine that had ever scanned, with no way out: no `.hip`,
  export root or HDA had changed. `SCAN_ANSWER_VERSION` is a component of
  `scanCacheKey` now — **bump it whenever the scan starts reporting a new
  field.** A new field is a new question, and a cache that can't tell the
  question changed will serve the old answer forever.
- **Two sides comparing "the same" path can normalize differently — so a
  no-match is not evidence.** 456.py folds `.dth` import paths through
  `os.path.realpath` (mapped drive → UNC, the retired junction spellings old
  `.hip`s still store); the cached scan's `_scene_dth_imports` uses
  `os.path.normpath` (a stored verdict must not bake one machine's mount
  layout in) and the TS `sceneDthPath` resolves nothing physical at all. Two
  spellings the RUN happily folds together therefore compare unequal in the
  DTH Export dialog. The rule that reads them (`hipsForSelectedScenes`) only
  drops a project on a POSITIVE match against a deselected scene; "matches
  nothing" keeps whatever is ticked. The general shape: when a comparison
  crosses a normalization boundary, only a match carries information — a
  mismatch is indistinguishable from a vocabulary difference, and acting on it
  is ignorance wearing knowledge's clothes.
- **One global side-channel file needs clearing by every writer of the thing it
  describes, not just the one that fills it.** `export-progress.log` is a
  single app-data file and the poll serves it to whatever batch is live — but
  only the export handoff truncated it, so a project scan or a scene ROM build
  (both `bulk-export` job files, both adopted for display by every character
  editor) rendered the FINISHED export's percent, scene and log tail as their
  own progress. `resetExportProgressLog` runs at all four handoffs now; only
  one of them also arms `progressLogPath`.
- **A plan that also GATES a button has to count everything the action fixes.**
  `planRepath` decides both what the Utils repath would do and whether the button
  is clickable (empty `targets` = disabled). It counted absolute-collapsible and
  broken refs but not `hipRelative`, and the scan couldn't produce `broken` for a
  moved export root — so two different classes of project sat behind a greyed-out
  button while the card's own badge told the user to press it. Both were found by
  reading the gate, not by using it, because the symptom is a UI that says
  everything is fine. When a "what would this do" summary doubles as a
  precondition, every branch the run can take must be represented in it.
- **The DazToHue HDA has its own "Linking" feature, and it is a LIVE MIRROR —
  not a copy.** `DazToHueShared.do_link_to_source` rewrites every linkable parm
  of the target to `ch("<source>/<parm>")` / `chs(...)` (plus `opmultiparm` for
  multiparm children), so the target follows the source. Measured limits: it
  refuses unless both nodes are **on the same network level** (same parent, same
  file) and the **same type**, and it calls `hou.ui.displayMessage`, so it
  cannot run headless. It therefore does NOT overlap the studio's Utils
  transfer, which is a one-time selective copy ACROSS files.
  **The trap it creates:** copying *from* a linked node must not carry those
  expressions. DTH node names are identical across projects, so
  `ch("/obj/DazToHue/DazToHueMaterial/…")` landing in another project silently
  REBINDS to that project's own node — wrong values, no error.
  `material_utils.py` therefore flattens any node-referencing expression to its
  evaluated value at export (`_portable_expr`) and carries only expressions with
  no node reference. The same reasoning is why the transfer never offers a
  node's **`node_linking_folder`** as a copyable section: that folder IS the
  linking block.
- **A black-boxed HDA still yields its parm names without Houdini.**
  `DazToHue.hda` refuses `hotl -t` ("the library is black boxed"), but the
  per-type **DialogScript sections are plain text inside the file** — reading
  the bytes as latin-1 and searching for
  `# Dialog script for <Type> automatically generated` gives the whole parm
  tree: `group`/`groupsimple`/`groupcollapsible`/`multiparm` blocks with their
  `name` and `label`. Measured 2026-08-12, and it is the ONLY way to get these
  names on a machine where hython won't start (`hython` exits 3, *"No licenses
  could be found"*, when the GUI holds the only Indie seat). Use it to source
  folder names for a new `FOLDER_KINDS` entry — but note it proves the parm
  tree, NOT that a transfer works: that still needs a real run.
- **The occlusion nodes' folder names, measured off the installed HDA
  (2026-08-12).** `DazToHueOcclusion`: `node_linking_folder` (Linking, not
  transferable — see above), `visualise_folder` (Visualise),
  `occludion_culling_folder` (Occlusion Culling) wrapping
  `occludion_manual_attributes_folder` and `folder0` (Auto-Occlusion, holding
  the `occlusion_group` multiparm). `DazToHueGroomOcclusion`:
  `visualise_folder`, `groom_occlusion_options_folder`,
  `groom_occlusion_skin_folder`, `groom_occlusion_occlusion_folder`,
  `groom_occlusion_texture_folder`. **`occludion_` is how the asset spells it** —
  the name is the contract `_folder_template` looks up, so it is reproduced
  verbatim; "correcting" it to `occlusion_` finds nothing at all. A folder name
  that does not resolve is now the ONE thing `op_transfer_folders` refuses to be
  quiet about — missing on the source raises before any file is opened, missing
  on a target fails that target with the label in the message and copies nothing
  to it. It used to `continue` past both, which turned "these names are wrong
  for your DTH version" into a cheerful *Transfer complete* over a copy that
  never happened. Since the names come from reading a black-boxed asset rather
  than from a run, that silence was the likeliest way this feature could lie.
- **A Houdini network box's visible title is its `comment()`, not its
  `name()`.** Measured 2026-08-06: `name()` is an internal id (`__netbox1`,
  `__netbox3`, …) that no user ever sees or sets; the text drawn in the box
  header — and the only human-meaningful label a DTH network has — is the
  comment. Boxes live in the node's PARENT network (`parent.networkBoxes()`,
  membership via `box.nodes()`) and can nest, so a lookup should prefer the
  INNERMOST containing box. This is what lets a scan report `KiraDefault` /
  `KiraYoga` / `KiraNaked` instead of `DazToHueMaterial`, `…1`, `…2`.
  Related trap: recursing `node.children()` across a project can raise
  `hou.PermissionError` on locked assets — wrap network walks in try/except
  rather than assuming every node is enumerable.
- **A DazToHue texture baker references its material and geometry groups BY
  NAME** (`MI_Skin`, `Head`, `GP*`, geoshell `..._Shape`) — measured on the
  same pass. Copying bakers into a node that lacks those names SUCCEEDS and
  then bakes nothing, so a transfer that only reports "copied" is lying by
  omission. `material_utils.py` diffs the needed names against the target's
  material slots and cooked prim groups and reports the gap
  (`missingMaterials`/`missingGroups`); an EMPTY `missingGroups` can also mean
  "no cooked geometry to check against" — never render it as "all present".
  Layer texture paths are absolute into the Daz library, so they survive a
  cross-project copy on the same machine and would need remapping off it.
  COROLLARY, measured the hard way: a material setup is THREE linked blocks —
  `material` (which surfaces merge into each slot), `material_uv_channel` (the
  `uv_original`/`uv_geoshell` names layers read) and `material_texture_baker`.
  Transferring only the third produces a node that imports cleanly and bakes
  nothing. Copy them together, or report precisely what the target still lacks.
  Two more measured facts that make the dependency checkable rather than
  guessed: **UV channels are ANONYMOUS** (positional instances 0/1/2, no name
  parm — so they can only be copied wholesale), and every baker reads
  `uv_original` + writes `uv`, both of which exist on any DTH-imported geometry.
  A source UV outside that intrinsic set (`uv_geoshell`, from the
  Copy-From-Geoshell channels) therefore means "this material needs the UV
  channels": measured, a G9 skin does and clothing does not. Slot-to-baker
  matching goes through the node's `material_prefix` — the slot is `Skin`, the
  baker names it `MI_Skin`.
- **`hou.text.collapseCommonVars` is CASE- and SEPARATOR-sensitive, so it is the
  wrong tool for making a project's stored paths portable.** Measured
  2026-08-07: with `$DAZ3D_LIB = D:/DAZ 3D/My DAZ 3D Library`, the exact-case
  path collapsed to `$DAZ3D_LIB/…` while the SAME path lowercased
  (`d:/daz 3d/…`) and the backslash spelling both came back untouched. That is
  not academic — a real project stored **83 of its 131** texture paths
  lowercase, so using that call would have silently made 48 portable and
  reported the other 83 as "cannot be made portable" while the studio could
  plainly see the root. `_collapse_ref` (`material_utils.py`) therefore does its
  own case-insensitive, separator-normalized prefix match (the same fold
  `_rewrite_lib_paths` already used), longest root first so `$HIP`
  (`<char>/houdini`) wins inside the houdini folder and `$JOB` (`<char>`) wins
  above it. Windows resolves the collapsed path fine either way — verified by
  re-reading all 131 and confirming every one still points at a file that
  exists. Use the call for a picker preview, never for a rewrite.
- **"The file doesn't exist" is NOT a usable definition of a broken reference in
  a `.hip`.** Measured on a healthy project: walking every FileReference parm
  and testing existence flagged four of HOUDINI'S OWN scratch files —
  `rendergallerysource` (`$HIP/galleries/…/rendergallery.db`), the PDG
  `taskgraphfile` and `checkpointfile`, and `tempdircustom`. None is broken;
  they simply don't exist until used. So breakage detection is scoped to the
  DazToHue import parms the studio understands (`DTH_IMPORT_FILE_PARMS`).
  The repair for those needs no scene lookup, which matters because the
  node → scene mapping is genuinely ambiguous (a project can hold several
  import nodes naming the same files): a Daz export writes `.dth` + `.fbx` +
  `.abc` side by side with the SAME basename, so a sibling that still resolves
  yields both the folder and the stem — and the derived path is only written
  when it actually exists. Related dry-run trap: the repaired value is stored
  in its already-collapsed form, because collapsing it in the following pass
  made a real run report one more rewrite than its own dry run.
- **Let Houdini decide the anchor — `collapseCommonVars` is the spec, and its
  answer MOVED when the exports moved.** Measured 2026-08-10 on a real project
  (`hou.text.collapseCommonVars`, the call behind the HDA's file picker):
  `<char>/houdini/daz-export/primary/x.dth` → **`$HIP/daz-export/primary/x.dth`**,
  while `<char>/export/` → **`$JOB/export/`**. Same call, two anchors, and both
  are right: `$HIP` is preferred wherever it reaches, and Houdini refuses to
  emit `..` so anything beside the houdini folder falls to `$JOB`. This is the
  same call that justified v63's move to `$JOB` — the answer flipped not because
  the measurement was wrong but because **v64 moved `daz-export` INSIDE the
  houdini folder**, which is the input that call depends on. Hence v66. Lesson
  for the next anchor argument: re-run the measurement after any layout change,
  because the premise is the layout, not the variable. Two properties worth
  keeping in mind when choosing: `$HIP` is DERIVED (it cannot drift, so a project
  whose `$JOB` points at another character still resolves its own imports) but it
  names the `.hip`'s own folder, so one prefix only serves projects that SHARE
  that folder — `$JOB` is the depth-independent one, which is why v66 keeps it as
  the second tier rather than deleting it.
- **A form that still resolves is not a defect — don't badge it.** v66 leaves
  v63–v65's `$JOB/houdini/…` paths unflagged and only offers to shorten them in
  *Make paths portable*. The pre-v63 `$HIP/../…` form IS flagged, because the
  `..` makes it depth-fragile — an actual future breakage. Badging the merely
  longer form would have put "Needs attention" on every project generated in the
  preceding week and taught the eye to skip the badge that means something is
  really wrong. Same reason `_shorten_job_ref` is scoped to DazToHue nodes: a
  `$JOB/…` path on the user's own cache/render nodes is THEIR choice of anchor,
  and the two spellings diverge the moment the `.hip` moves relative to `$JOB`.
- **UPDATE 2026-08-10: it LANDED in 2.5.1, and the studio kept saying it hadn't
  — a cache bug, not a DazToHue one.** `DazToHuePoseAsset.hda` (version 2.5.1,
  installed standalone BESIDE the 2.5 `DazToHue.hda`, which still defines the
  same `Sop/DazToHuePoseAsset` — `hotl -B` lists both) carries
  `pose_asset_csv_file_path`, labelled "Auto CSV File Path". Verified under the
  app's own hython invocation: both libraries are loaded, the 2.5.1 one wins on
  version, and `node.parm('pose_asset_csv_file_path')` resolves. What was stale
  was the SCAN STORE — its key was `path|mtime|exportRoot`, so a verdict phrased
  in 2.5's vocabulary ("your DazToHue version has no …") survived the install
  that falsified it, and the drawer's Rescan could not clear it because Rescan
  reads through that same cache (`scanHoudiniMaterials` serves any key-matching
  entry). Fixed by putting an `otls/` fingerprint in the key (`hdaLibraryKey`).
  **The general rule, now paid for twice: a scan verdict is about the file AND
  its surroundings, so every surrounding it depends on belongs in the cache key
  — the export root was the first, the installed HDAs the second.** Before
  believing "your version doesn't have X", check the store's `scannedAt` in
  `.dcsmeta/characters/<name>/houdini-scan.json` against the HDA's mtime.
- **The PoseAsset CSV PATH does not exist in DazToHue 2.5 — the node ships a
  `pose_asset_import_csv` BUTTON instead** (superseded by the entry above for
  2.5.1+; still the measured truth for 2.5 itself). Measured 2026-08-07 off the
  installed HDA's parm template group (no instantiation needed): of the eight
  parms Generate project wires, seven are present today
  (`import_character_name`, the four `import_character_*_file` paths,
  `import_skinning_method`, `export_directory`) and only
  `pose_asset_csv_file_path` is absent. That is why neither the generation
  prefill nor the Utils "Fill network" action waits for a DazToHue release:
  each parm is written only when `node.parm(name)` is not None, and the
  missing one is REPORTED so a user who expected it gets a reason instead of a
  silent gap. Verified end to end by extracting the `format!` snippet out of
  `houdini.rs` verbatim and running it under hython — the network builds,
  seven prefills land and persist through a save, the CSV path is skipped, and
  the generation succeeds. Corollary for the Utils action: it fills only BLANK
  string parms (`import_skinning_method` is a menu, where a default and a
  deliberate choice are indistinguishable — generation sets it, the repair
  doesn't).
- **Writing a parm is not the same as CHOOSING it: `parm.set()` never runs the
  parm's callback.** USER-REPORTED 2026-08-12: a generated project held every
  import path correctly and still showed the Alembic on the wrong rest frame,
  and clearing the fields + re-picking the `.dth` through the file browser
  fixed it — because that browser fires the parm's callback, which offers to
  auto-fill the siblings and then actually READS the files. The studio wrote
  those paths with `parm.set()` in both places that prefill (the generation
  snippet in `houdini.rs`, `op_prefill` in material_utils.py), so the load
  never happened. Both now `pressButton()` the `.dth` parm — Houdini's way of
  running a callback from code — with `hou.ui` stubbed to answer the prompt
  (headless has no `hou.ui` at all; a GUI would wait forever on the click),
  and only when the file EXISTS: a project generated before the Daz export ran
  has nothing to load. The generic prefill then fills only what the HDA left
  blank, so the tool's own answers win over the studio's guesses. General
  shape: when an app offers a UI action for a value you are setting, ask what
  that action does BESIDES setting it — the difference is what a scripted
  write silently skips. **MEASURED in hython 2026-08-12** — a probe that read
  the parm templates, fired the callback and inspected the saved scene:
  - the `.dth` parm's callback is `do_autoload_files`: it asks the Yes/No
    question, reads the JSON, fills name/fbx/abc, then calls `do_reload_files`
    — which presses the fbx + alembic reload buttons, reads the Alembic's own
    start/end out of its info tree, sets the playbar range and
    `hou.setFrame(0)`. THAT is the "rest pose frame". The alembic parm carries
    `do_reload_files` as well; fbx and ROM-fbx have no callback at all; the
    panel's "Reload Files" button is `import_reload`.
  - `pressButton()` runs a non-button parm's callback but does NOT propagate
    its errors: a callback that throws prints a traceback and returns
    normally, so an `except Exception` around it proves nothing about success.
  - **the exists() guard has to run where `$HIP` is real.** Generation clears
    the scene and saves only at the END, so during the prefill `$HIP` is still
    Houdini's default and `$HIP/daz-export/…` expands to a path that isn't
    there — the guard then refuses to fire, which is exactly how the first fix
    shipped as a silent no-op. Save FIRST, fire, save again (the second save
    persists the frame range and frame the callback set). Verified end to end:
    the generated scene goes from `frame=1, range=[1,300]` to `frame=0,
    range=[0,240]`.
  - the autoload rewrites the sibling paths ABSOLUTE, undoing the `$HIP/…`
    form that lets the character folder move. The studio re-applies its own
    values afterwards with a plain `set()` — the files are loaded by then, and
    an equivalent path resolves to the same bytes.
- **`$JOB` is SCENE state saved inside the `.hip`, and a load OVERWRITES the
  process value — so it leaks between files in one hython run.** Measured
  2026-08-07: seeding a sentinel then loading a project replaced it with that
  project's own `$JOB`, and loading a SECOND project showed the first one's
  value right up until its load landed. Any batch that reports per-file `$JOB`
  must therefore reseed a sentinel before EVERY load (`_load` in
  `material_utils.py` does) or it will attribute one project's value to the
  next. Two more measured facts: **every scene answers with something** — even
  one saved without ever setting `$JOB` reloads carrying Houdini's default (the
  process CWD), so "unset" is not a state the UI has to render — and
  `hou.putenv('JOB', …)` + `hou.hipFile.save()` persists across a reload, which
  is what makes the General tab's repair possible at all. Consequence for the
  product: v0.64's `$JOB` fix (#700) reached only NEWLY GENERATED projects;
  every existing one keeps the pre-v0.64 `<char>/houdini/houdini-project`
  forever unless something rewrites it, which is why the repair exists (#701).
  It only helps paths picked AFTERWARDS — references already stored absolute
  are untouched, so say "capable of being movable", never "movable".
- **A DazToHue material slot is a CLAIM on Daz surfaces, and a surface can
  belong to exactly one slot — so slots merge BY SURFACE, never by name and
  never wholesale.** Measured 2026-08-07: `material_group#` is a plain STRING of
  space-separated group expressions, one per surface
  (`@fbx_material_name=Body @fbx_material_name=Head …`); a G9 `Skin` merges 15,
  a raw import holds each as its own slot. Both obvious transfer modes violate
  the invariant, and both shipped: *replace* wiped the list (a real 25-slot node
  came back holding **1**), and *append* merging by slot NAME left the target's
  own `Body`/`Head`/`Legs` beside an incoming `Skin` that already claimed them —
  the same surface claimed twice. The correct rule evicts exactly the target
  slots claiming the incoming slots' surfaces (plus any whose NAME an incoming
  slot carries — two `Skin` slots render one `MI_Skin` and a baker could bind to
  either), and TRIMS rather than drops a slot claiming a mix, or the surfaces
  nothing else claims are orphaned. Because the eviction set is read from the
  incoming slots' own `material_group`, the rule needs **no generation list** and
  cannot go stale. Two corollaries: tokens are compared VERBATIM (a pattern like
  `@fbx_material_name=GP*` therefore evicts nothing — the safe direction, since
  a wrong eviction destroys work while a missed one leaves a visible duplicate),
  and the rule lives on two sides — `houdini-material-merge.ts` (the panel's
  before-you-run preview) and `_plan_surface_merge` in `material_utils.py` (what
  actually writes the `.hip`) — pinned by the same cases against the same two
  real projects.
- **The cross-generation question needs NO generation knowledge — the source's
  own selected surfaces ARE the check.** A material setup only transfers within
  one Genesis version, and the tempting fix was a per-generation surface table
  (which would have meant measuring G8/G8.1/G3, and then maintaining it
  forever). Remo's call, and it is the better one: match the surfaces the
  SELECTED materials claim against the ones the target actually has.
  `isFigureMismatch` (`houdini-material-merge.ts`) is true only when NONE match,
  and that BLOCKS the transfer — a few unclaimed is ordinary (the source wears
  something the target doesn't), all of them means different figures, where the
  copy would evict nothing, install slots naming surfaces that aren't there and
  leave every baker baking nothing. Correct for generations nobody measured and
  for third-party figures by construction. Two deliberate non-mismatches: a
  target with ZERO slots (a fresh DTH network — nothing to contradict, and
  seeding it from a template is the drawer's purpose) and incoming slots that
  claim no surfaces. It blocks rather than warns for the same reason the
  UV-channel dependency does: an advisory let the user run a transfer already
  known to be broken.
- **`removeMultiParmInstance(i)` takes the instance index and RENUMBERS what
  follows.** Measured 2026-08-07 on a 25-slot DazToHueMaterial: removing
  instances 10 and 9 left 23 compactly numbered 0…22, and the change survived
  `hou.hipFile.save()` + reload. So a batch of removals must run in DESCENDING
  index order, and any in-place edit of surviving instances (rewriting a
  `material_group#`) must happen BEFORE the removals — every index read
  beforehand is stale afterwards.
- **Copy HDA multiparms off the parm TEMPLATE GROUP, not a hand-listed field
  table.** `material_utils.py` walks `parmTemplateGroup().find(<block>)`,
  flattening plain folders (Simple/Collapsible/Tabs add no index) and recursing
  into nested multiparm blocks, substituting `#` placeholders left-to-right with
  the index stack (`..._texture#_#` + `[1, 4]` → `..._texture1_4`). One walker
  then serves every block — including the 3-level nesting under a UV operation —
  and a DazToHue update that adds a parameter is carried across automatically
  instead of being silently dropped. Skip `Button`/`Separator`/`Label`
  templates: a button is an ACTION, and "copying" one would press it.
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
- **tauri-plugin-dialog 2.7.2 `set_default_path` semantics (measured — the
  browse-start UX contract rests on them):** an EXISTING file path opens the
  dialog at its parent with the filename preselected; a NON-existent path is
  still split into parent + filename, so a stale path opens at the nearest
  thing to where it pointed instead of being ignored. Forward slashes are fine
  on Windows — the plugin rebuilds the path via `PathBuf::components().collect()`
  (their issue #8074 fix). But that same rebuild breaks UNC paths whose
  separator runs were collapsed: `//NAS/share` fed as `/NAS/share` re-emerges
  as drive-relative `\NAS\share`, whose SetFolder silently fails — a start-path
  helper must preserve the leading double separator (`browseStart` in
  `lib/path.ts` does; `displayPath` follows the same rule).
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
  This symlink report is also how the leftover-junction sweep tells a link
  from a real folder: `remove_junction` (junction.rs) treats
  `symlink_metadata().file_type().is_symlink()` as THE junction test and
  refuses everything else.
- **Scripted export exists in BOTH Studio majors now — but only from Exporter
  2.0.2.0 on Daz Studio 4.** Driving the exporter needs
  `MainWindow.getActionMgr().findAction("DazToHueExporterAction")` →
  `doExport(dir, name, referenceFrames, saveSettings)`, introduced with the DS6
  exporter plugin 1.8.1. The Studio 4 build had **no scripted export at all**
  until mrpdean added it: measured on a DS4 install whose exporter dialog
  reported 2.0.1, its action was class `ExporterAction` / name
  `DazToHue_Action` (so the class lookup missed it entirely), carried 28
  methods that were all inherited DzAction/QAction members, and a sweep of ALL
  912 registered actions plus the global script scope found no `doExport*`
  anywhere — `trigger()` only opened the dialog. **Exporter 2.0.2.0 fixes
  that**: a DS4 batch was measured on 2026-08-10 writing its `.abc` + `.dth`
  under script control, so DS4 is a full export target and
  `exportOnlyCandidateKeys` no longer floors its candidates at major ≥ 5 (the
  floor, and the "Export only may never point at Daz Studio 4" rule that went
  with it, are gone). What survives: (1) never treat finding the action as proof
  it can export — the generated script still gates on
  `typeof doExport == "function"`, which is what silently degrades on an OLD DS4
  exporter (a batch that completes and exports nothing); (2) the DLL version is a
  weak guide — the pre-2.0.2 DS4 build stamps FileVersion 1.0.0.1 while
  reporting 2.0.1 in its UI, and older DS6 builds carry no version resource at
  all, so "is this new enough?" is answered by keeping every install on the
  newest build (Settings → Daz Studio plugins) rather than by comparing numbers.
- **A Daz plugin's generation is in its FILE NAME, and that is a loader rule.**
  Daz Studio 6 only loads plugins named `dsp_*.dll`; Daz Studio 4 loads the
  plain name. So `dth_exporter.dll` is a DS4 build and `dsp_dth_exporter.dll` a
  DS6 one — not by convention but by what each Studio will accept, which is why
  `exporterDllFlavor` (`lib/daz-plugins.ts`) decides from the name and treats a
  folder called "Daz Studio 6" only as a cross-check to flag. The same split
  names the bundled Runner DLLs (`RUNNER_DLL`). Both plugins are installed into
  EVERY detected 64-bit Daz install, paired by generation: one release folder
  (`ExporterPlugin/Daz Studio 4` + `…/Daz Studio 6`, how mrpdean publishes it)
  serves a whole machine, and a generation with no build on hand is REPORTED,
  never served with the other one's binary.
- **Every Daz Studio major ships an executable called `DAZStudio.exe`** — so a
  process NAME cannot say which INSTALLATION is running, and any probe that asks
  by name is answering a different question than the caller asked. Measured on a
  DS4 + DS6 machine (2026-08-10): with "Export only" on the older install, DTH
  Export never started at all. `daz_studio_running` filtered `tasklist` on the
  image name, the open DS6 answered "yes, Daz is running", the studio concluded
  there was nothing to launch — and the batch meant for DS4 sat in a pending job
  file nobody ever claimed (no Daz process afterwards, no error, no toast).
  `launch_daz_studio` had the mirror-image bug: it preferred
  `running_daz_exe()` over the folder it was handed, so even when it did launch,
  a running DS6 hijacked the request. The identity is the executable's full
  PATH: both probes take an install folder and compare against it per component
  (`daz.rs` → `exe_started_from`; `''` still means "any Daz", which is what the
  scene-open bridge wants). Three consequences worth keeping: a running instance
  whose path can't be read (an elevated Daz seen from an unelevated studio)
  counts as a MATCH, because the export watch deletes the job file of a run it
  believes dead and over-reporting only costs a redundant launch; the two
  DESTRUCTIVE readings in `api/execute.ts` (dead-run cleanup, stale-`running_`
  overwrite) therefore keep asking about ANY Daz rather than the export install
  — the match is a normalized string compare, not a canonicalization, so a
  moved install or an unusual path spelling would otherwise read as "gone" and
  strand a live batch (`DazRunningScope` states both halves); and process
  enumeration is a ToolHelp snapshot (`procs.rs`), not `tasklist`/`Get-CimInstance`,
  because these probes sit in one-second UI polls where a child process per tick
  is felt. **This bug class is invisible on a one-install machine** — nothing in
  the app targeted the non-active install until "Export only" (#768) shipped.
- **Three consumers must agree on WHICH Daz runs the export batch**, and they are
  fed by one pure rule (`storage/settings.ts` → `exportInstallFolder`): the
  launcher (`api/core.exportDazInstallFolder`), the Runner GATE
  (`fetchExportRunnerGate`) and the Runner INSTALL (`resolveRunnerInstall`).
  Everything else in the app goes through `activeDazInstallFolder` instead. A
  gate reading one install while the launcher starts another is a "ready" over an
  export that opens Daz and waits forever, so a new consumer of "where does the
  batch run" adds itself to that rule, never a fourth answer.
- **Creating a directory link on Windows: junction, not symlink** (HISTORICAL
  since v0.63 — the studio no longer creates junctions, but the measured facts
  keep the sweep's test honest). A junction
  (`IO_REPARSE_TAG_MOUNT_POINT`) needs NO elevation; a directory SYMLINK needs
  `SeCreateSymbolicLinkPrivilege` (admin) or Developer Mode plus
  `SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE`, so `std::os::windows::fs::
  symlink_dir` simply fails for an unelevated studio. std has no junction API at
  all — the reparse point is written via
  `FSCTL_SET_REPARSE_POINT` (substitute name wants the NT `\??\` prefix; the
  declared name lengths EXCLUDE their NUL terminators), and a junction
  can only target a LOCAL absolute path — never UNC or a mapped network drive.
  That writer survives only as `junction.rs`'s test helper: the sweep's test
  builds a real junction to prove `remove_junction` never eats its target.
- **`fs::remove_dir_all` on a folder CONTAINING a junction removes the link, not
  the target's files** (measured on this repo's Windows, Rust std). It kept the
  retired `dth-exports` junctions safe inside Houdini project folders users
  might delete, and it still matters: leftover junctions from pre-v0.63
  versions sit in user trees until the sweep clears them (`remove_junction` —
  itself a plain `fs::remove_dir` on the symlink-verified link). Do NOT assume
  the same of other tools: PowerShell's
  `Remove-Item -Recurse` has historically recursed through reparse points, and
  `p4 clean` / `reconcile -d` may treat a junction as an untracked extra.
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

- **Every window loads the SAME document, so the start URL never says which
  project it is for.** The config window starts on `/` — which the Home route
  matches — and a runtime window (`WebviewUrl::App("index.html")`) on
  `/index.html`, which matches no route; the window→project mapping only comes
  back from Rust's `active_project_file`. Mounting the router before that answer
  arrives therefore made "recents for half a second, then a jump" the DESIGNED
  boot order of every project window, not a race occasionally lost: Home's
  loader is one small local read while the project's is a manifest read plus a
  character scan, so Home won every time (and got slower to correct the more
  characters a project had). `main.tsx` resolves the destination, `router.load()`s
  it, and only THEN calls `createRoot().render()` — the window shows its own dark
  `backgroundColor` (tauri.conf.json) until the finished screen is ready. Anything
  new on the boot path belongs INSIDE `resolveStartRoute`, before the render, and
  independent lookups there belong in its `Promise.all` rather than stacked in
  front of each other. Guarded by `apps/web/smoke/project-window-boot.smoke.ts`.
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
- **Character page sticky stack:** the character header (`sticky top-0`) has a
  DYNAMIC height (it collapses on scroll), published live as
  `--sticky-header-h` on `:root` by `useStickyHeaderInset`
  (`packages/ui/src/hooks/use-sticky-header-inset.ts`, called from
  `editor-header.tsx` / `form-header.tsx`). ROM section titles pin at
  `calc(var(--sticky-header-h, 128px) + var(--override-bar-h, 0px))`
  (`rom-sections.tsx`), pose-table column headers at that `+ 48px`
  (`group-card.tsx`). Any new fixed-top element must READ the var — a
  hardcoded px silently drifts as the design changes. The guide-screenshot
  suite no longer compensates per shot: it un-sticks all sticky/fixed chrome
  before shooting.
- **The guide SITE build (`scripts/build-guide-site.mjs`) is a separate pipeline
  from the screenshot suite's coverage guard.** Each guide asset dir
  (`screenshots/`, `clips/`) must be BOTH `cpSync`'d into `site/guide/`
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
- **The morph autocomplete reads TWO files per generation, and they must stay
  separate.** Since runtime v53 `morphs_<G>.json` (the stock figures) has a
  sibling `morphs_scenes_<G>.json` (what individual SCENES add: fitted clothing,
  hair, third-party grafts), merged by `fetchMorphIndex` so callers still see one
  index. They are separate FILES on purpose — the base build rewrites its file
  wholesale per generation, so merging scene finds into it would lose them on
  every rebuild. Consequences worth knowing:
  - A scene entry carries `scenes: [<normalizeSceneKey>…]`; a base entry has NO
    `scenes` field, and that absence IS the "always offer it" signal.
    `MorphIndexProvider` drops every scene entry whose list doesn't hold the
    SELECTED scene — including when no scene is selected at all.
  - The reader dedups base-first, so a scene entry can never shadow a base one
    (otherwise a dial the figure genuinely carries would vanish from the
    autocomplete whenever its scene wasn't selected).
  - `fetchMorphIndex` returns EMPTY when the base file is missing, even if a
    scene index exists — a scene index alone means the generation was never
    indexed, and offering only clothing dials would be worse than silence.
  - The scan filters itself against the base index IN DAZ — it reports what a
    scene adds by SUBTRACTING that index — so **the base row must run before
    the scene rows** in a bulk batch (`startProjectScan` enqueues it first).
    With nothing to subtract, the whole stock figure files itself as "what this
    scene adds". That was harmless while only the Tools batch scanned scenes;
    runtime v55 put the scene scan on EVERY generated ROM/export script
    (`DthScanSceneMorphsQuiet`, right after the wrong-scene guard —
    `indexSyncSnippet` in `packages/rom/src/dsa.ts`, pinned by
    `index-sync.test.ts`), which put it in front of anyone who had never built
    the index: a plain export silently filed thousands of stock G9 dials under
    that scene and the autocomplete drowned in them. **Fixed in runtime v58**
    (#675): `dthHasBaseIndex` gates `DthScanSceneMorphs`, which now refuses
    rather than misfiles — a `throw` under `bulk` (so the quiet wrapper logs
    and the export row still succeeds), a dialog interactively. An index
    holding ZERO morphs counts as missing, since subtracting it misfiles
    identically. Nothing is lost by refusing: a later scan REPLACES a scene's
    contribution wholesale (next bullet), so the first run after the base index
    exists files it correctly. `dthBaseIndexKeys` itself still returns an empty
    filter set for a missing index — the refusal is the caller's, deliberately,
    so the two concerns stay separable.
  - A re-scan REPLACES that scene's contribution (`dthWriteSceneIndex` strips
    the scene out of every stored entry first, dropping entries left with no
    scene). Without that, clothing removed from a scene would haunt its
    autocomplete forever. Pinned in `runtime.test.ts`.
- **`projectId` is the project FOLDER PATH everywhere, never `ProjectInfo.id`.**
  `resolveProject(projectDir)` takes the path and returns a record whose `id` is
  the `.dcsp` manifest's own id — a different value that resolves to nothing.
  The route param is the path, so route-scoped code gets this right by accident;
  code reading the ACTIVE project (`fetchActiveProject()`, e.g. the Tools →
  Scan project panel) must pass `project.path`. Measured: passing `.id` made the
  panel's plan probe throw, which the `.catch` turned into a permanently
  disabled button with no error anywhere — caught only by a smoke test.
  `storage.productScanDir(project.id, …)` is the exception that proves it: that
  one genuinely wants the manifest id.
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
  aliased even from a high-res source. The header avatar once rested at
  `scale: 1.55` (204px laid out → a 204px texture stretched to ~316px). Fix: lay
  the element out at the painted size and rest at `scale: 1` so the browser
  resamples the 768px source straight to size; animate the zoom FROM 1
  (currently a 168×224 portrait wrapper clipping a 254×254 image at
  `-ml-[45px] -mt-[45px]` — see `editor-header.tsx` + `dth-avatar-zoom`). Two
  traps when sizing an `<img>` up: Tailwind preflight's
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
  `Avatar renderPx` (currently 254 in the character header). A canvas `imageSmoothingQuality:'high'` pass is NOT good enough
  here — it came out mushy; Lanczos was the one that read crisp. Diagnostic tell: if a
  static side-by-side shows the browser downsample ≈ a hand pass, the defect is
  aliasing (missing low-pass), not the resample quality.

## Releases

- **GitHub releases are immutable** (since v0.44.7): a published release and its
  `latest.json` cannot be edited afterward. Never hand-publish without being sure
  `latest.json` is right — a broken one can't be fixed in place.
- **The version PR's checks sat `action_required` until manually approved — and
  bulk-approving stale runs cancels the current head's run** (measured
  2026-08-03, the v0.61 train). Two separate mechanisms:
  the changesets action pushes `changeset-release/main` with the credentials
  `actions/checkout` persists, and `CHANGESETS_TOKEN` only reached the action's
  env (PR create/update API) — so the PR's AUTHOR was the PAT owner while every
  push was `github-actions[bot]`, and a bot-pushed head trips the public-repo
  first-time-contributor approval gate on each refresh (fixed: the checkout now
  gets `token:` too). Separately, ALL of a PR's validation runs share one
  concurrency group (`validate-refs/pull/<n>/merge`, cancel-in-progress), so
  approving/re-running several held runs in one sweep lets the LAST click
  cancel the in-flight ones — the survivor can green-light a STALE head while
  the current head keeps red "cancelled" required checks. Only ever approve or
  re-run the NEWEST run; for a cancelled current head,
  `gh run rerun <run-id> --failed` re-runs just the killed jobs.
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
- **`/\/+$/` (and `/[\/]+$/`, `/[. ]+$/`) is a HIGH-severity CodeQL alert** —
  `js/polynomial-redos`. A `+` immediately before `$` makes the engine retry
  every split of the repetition against the anchor, so a string of many
  separators costs quadratic time; these run on stored project/character paths
  and user-typed names, which is what makes it an alert rather than a curiosity.
  It blocked a PR (#645) after being introduced, fixed, and then **reintroduced**
  — the regex form is simply what everyone reaches for. There is now ONE home
  for the linear versions: **`apps/web/src/lib/path-trim.ts`**
  (`stripTrailingSeparators` / `trimSeparators` / `stripTrailingDotsAndSpaces`)
  plus `stripTrailingSlashes` in `packages/rom/src/dsa.ts` for the pure core.
  `path-trim.ts` is deliberately a LEAF (imports nothing) because `lib/path.ts`
  imports the storage layer — homing the trims there is an `import/no-cycle`
  error the moment `storage/fs.ts` needs one. Note CodeQL gates only NEW alerts
  on a PR, so the old occurrences sat unflagged for a long time; the local gate
  (`lint`/`typecheck`/`test`/`smoke`) does not run CodeQL, so an alert like this
  first shows up on the PR.
  **The shape is `+` (or `*`) immediately before `$`, whatever the character
  class** — it is not a *path* problem, and reaching for `path-trim.ts` only
  when the string is a path misses it. Caught a third time in review on
  `/^_+|_+$/` trimming an Unreal project NAME (`unrealProjectNameFrom`,
  `lib/unreal-install.ts`); that one is a `while (s.endsWith('_'))` loop now.
  A *global, unanchored* replace (`/_+/g`, `/[^A-Za-z0-9_]+/g`) is fine — every
  match consumes, so there is nothing to backtrack.
- **Unreal decides a plugin fits by `BuildId` EQUALITY, not by any version
  label.** Measured 2026-08-12. The engine carries one in
  `Engine/Binaries/Win64/UnrealEditor.modules`, every built plugin in
  `Binaries/Win64/UnrealEditor.modules`, and *"The following modules are missing
  or built with a different engine version"* IS that comparison failing. A
  folder name (`Unreal Engine 5.7 Plugin`), a path segment, a `.uplugin`'s
  `EngineVersion` — all labels, and a folder like
  `KawaiiPhysics_5_7_1_v1.19.1` writes its version with underscores, so it
  parses as *no version at all* and matches every project including one it
  cannot load in. `pluginBuildMismatch` (`lib/unreal-install.ts`) is the check;
  either side reading `''` means "cannot tell" and must NEVER render as a
  mismatch — a false alarm costs the user a plugin that would have worked.
  **And the BuildId must PICK, not only warn.** `matchPluginsToEngine` offers
  ONE build per plugin name (the install target is `Plugins/<name>`), and its
  tie-break knew labels only — so with `KawaiiPhysics_5_7_1_…` and
  `KawaiiPhysics_5_8_…` side by side, both reading as `any engine`, the
  alphabetically first was offered to a 5.8 project, marked unloadable, and the
  build that WOULD have loaded was dropped from the list entirely. `buildRank`
  now orders them: proven match > exact version label > any-engine > proven
  mismatch. Ranking is NOT filtering — a lone mismatching build is still listed
  and marked, because an empty checklist explains nothing.
- **`HKLM\SOFTWARE\EpicGames\Unreal Engine` can be MISSING an installed
  engine.** Measured 2026-08-12: a machine with 5.6, 5.7 and 5.8 installed had
  no 5.8 key, so the studio never offered it, a project was generated for 5.7,
  and 5.8 opened and rebound it — every 5.7-built plugin then unloadable.
  Second source: `%PROGRAMDATA%\Epic\UnrealEngineLauncher\LauncherInstalled.dat`
  (`merge_engine_installs`, unreal_install.rs). Two traps in it: only
  `UE_<major.minor>` entries are ENGINES — `QuixelBridge_5.8`, `FabPlugin_5.7`
  and friends are plugins installed INTO one and carry the same
  `InstallLocation`, so an unfiltered read offers the same engine several times;
  and the registry is preferred per version but must YIELD when its folder is
  gone, since "present but pointing nowhere" is the same staleness (an
  uninstalled 4.0 keeping its key is measured on this repo's own dev machine).
- **A mapper that names its fields silently drops the next one added.**
  `buildUnrealScan` rebuilt each engine field by field, so `buildId` — read in
  Rust, parsed by the zod schema, typed all the way down — never reached the
  dialog, and the whole plugin-build check answered "cannot tell" in the real
  app while every test passed. Nothing covered it because the dialog tests mock
  `detectUnrealEngines` and the pure tests call the matcher directly. Two
  lessons: **spread in a mapper** whose input is a wire type, and when a feature
  reads a NEW native field, cover the schema→transform→consumer path once, not
  just the leaf function.
- **An NTFS junction stores an ABSOLUTE target — anything that moves the
  target leaves the junction pointing at the old path**, silently (Windows
  happily keeps a dangling reparse point, and re-creating the old folder makes
  writes land in a resurrected tree instead of erroring). This is why the
  retired junction feature (pre-v0.63) had to refresh its links on EVERY
  generation, and one more reason the links are gone — a relative
  `$HIP/../…` path has no stored target to go stale; the same generation
  funnel now runs the leftover sweep instead (`sweepExportJunctions`,
  api/houdini.ts). The corollary OUTLIVES the feature, for DERIVED path
  fields: being re-derived on save does not
  exempt a field from `repointCharacterPaths` — `moveCharactersRoot` rewrites
  each moved definition directly (no `saveCharacter`, no re-derive), and
  `exportPath` staying stale until "some later save" was enough for a
  same-batch regenerate to aim reference paths at the old location (#647).

## The smoke fake's `stat` mtime (measured 2026-08-07)

`tauri-mock`'s `stat` must return a **`Date`**, stamped **once when the fake is
installed** — not a number, and not a fixed date in the past. Both wrong forms
shipped within an hour of each other:

- A **number** (`Date.now()`) means every `.getTime()` in the studio throws, so
  no mtime-keyed cache is ever exercised in smoke. A cache that never hits looks
  exactly like a cache that works.
- A **fixed past date** makes every file in the fake world read as months old,
  and `sweepStaleRunFiles` (material-util run files, 1h cutoff) compares against
  the REAL clock — so it deleted the request file the studio had just written,
  hython got nothing, and the Utils drawer reported "0 projects read".

Stable-but-current satisfies both. It is exposed as `__tauriMock.mtimeMs` so a
spec can seed an mtime-keyed cache entry that reads as fresh.

The wider lesson: three fixes were aimed at plausible causes before anyone dumped
the drawer's own text, which had the error string in it the whole time. When a UI
assertion fails, print what the UI actually says before theorising.
- **A figure's source asset is on the OBJECT, not reliably on the node — and in
  Daz Studio 4 the node answers nothing.** `node.getAssetUri()` returns a usable
  path in DS6 and empty in DS4, which silently disabled every generation
  detection built on it: the scene morph scan skipped all of DS4 with "No
  Genesis 3, 8, 8.1 or 9 figure could be found" while the same run keyed morphs
  on `Genesis8_1Female` seven seconds later (measured 2026-08-10). The identity
  is reachable — the product scan had always walked node → `getObject()` →
  `getCurrentShape()` → `getGeometry()` and resolves assets fine in DS4 — so
  `dthNodeAssetPath` (DthUtils, runtime v68) does the same walk, plus
  `getAssetFileInfo()` where `getAssetUri()` is absent. Two lessons: an
  identity probe gets the WHOLE chain, never one accessor; and a detection that
  can fail needs a fallback the caller can supply (the studio passes the
  character's declared generation), because "we could not read it" and "it is
  not there" are different answers that had been collapsed into one message.
- **DS4 exporter 2.0.2's scripted `doExport` goes STATIC when its output files
  already exist.** Measured 2026-08-11 (DS 4.24, the exporter DLL installed
  2026-08-09 08:00): with the target files present, the whole per-frame ROM
  walk is skipped — the run drops from 3.5 min to 26 s, the viewport never
  plays, and the Alembic is rewritten with the FULL time range but every
  sample identical (8 MB instead of 332 MB for the same 240-frame scene).
  Fresh mtimes, clean run log, no error on any channel — the only tells are
  the file size and the missing frame walk. Into an EMPTY folder the same
  build exports correctly, and DS6's build never skipped. Since runtime v69
  the export block deletes the set's own name patterns (`<name>.dth/.abc/
  .fbx`, `_base`/`_experimental_rom.fbx`, `_pose_asset.csv`,
  `_Hair_*_grooms.abc`, `Reference Skeletons/<name>_frame_*`) before calling
  `doExport`, which both forces the real walk and stops stale grooms/reference
  skeletons from outliving a rename or a frame-layout change. Verification
  pattern that caught it: hython `alembicTimeRange` + a two-frame
  `pointFloatAttribValues('P')` compare (set the Alembic SOP's `frame` parm
  explicitly — `hou.setFrame` alone does not re-cook the packed prims).
