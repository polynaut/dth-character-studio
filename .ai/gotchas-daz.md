# Gotchas — Daz Studio

Part of the gotchas set — `.ai/gotchas.md` is the index. Learned by measurement or painful debugging; verify details against the current code, but assume the *lesson* still holds. New facts in this area land HERE, in the same PR that earned them.

## Daz Studio integration (measured behavior)

- **A Daz-side script the engine kills at the C++ level reports as a fully
  successful export — only the DISK says otherwise.** Measured 2026-08-21 (DS4,
  DTH Exporter 2.0.2.0 DLL of Aug 18): the exporter intermittently crashes the
  script engine 1–2 s into the Alembic export (`dzscript.cpp(1192): Unhandled
  error while executing script.` + `QScriptEngine::popContext() doesn't match
  with pushContext()`; twice preceded by `Could not remove stale output file
  …abc - locked by another application` → `Could not create alembic archive`,
  once silent mid-frame-write; 4 crashes vs 3 clean runs Aug 19–21). The JS
  `catch`/restore around `doExport` never runs (the unwind is C++-level), the
  Runner marks the row `done` (its contract: script returned, success or not),
  and the ROM run log was stamped by the ROM leg BEFORE the export block — so
  every channel says ok while the folder holds a 0-byte `.dth`, a truncated
  `.abc` and the sweep's `.dthprev` backups still standing (the v99 backup
  design worked; only the finish step removes them). The Houdini leg then
  cooked that corpse into a 17-second "success". Defense: `exportSetDeath`
  (houdini-jobs.ts) + `verifyDazExportsLanded` judge the export SET from the
  folder itself before the Houdini continuation; a dead set fails its scene
  and drops out of the scope. Same verdict gates "Skip Daz — use last exports"
  (the panel's `houdini-only` pre-flight): its `exportExists` test is
  `mtime > 0`, which a 0-byte corpse passes, and that mode's whole input is
  whatever is on disk. The exporter crash itself is mrpdean's — reported
  privately, never in repo docs.
  **The guard's known hole, stated because it is not shut:** it asks "is a real
  `.dth` here", never "is it THIS run's". A script killed BEFORE the export
  block's move-aside sweep (scene load, figure resolution, the `rom-export` ROM
  rebuild) leaves the previous set intact — every channel then reads green and
  Houdini cooks last week's export under this run's checkmark. The measured
  crash lands 1–2 s INTO the Alembic export, past the sweep, which is why the
  disk holds a corpse there and not a survivor. The obvious close — `.dth`
  mtime vs. the run's start — is deliberately NOT taken: export folders are
  routinely network drives, and a NAS clock minutes behind the machine's would
  fail every healthy scene at once. A rare stale set passing beats every export
  failing on a clock skew, so the freshness question stays open.

- **The DTH Exporter's FBX pass excludes every morph whose ROM keys VARY from
  the base mesh — on every export path.** Measured 2026-08-17 (DS4 4.24,
  exporter 2.0.2.0; ~10 live probes on a stock G8.1F with `FBMHeavy` dialed
  0.5, geometry compared in hython by the scale-invariant bbox depth/height
  ratio — shaped 0.1919, unshaped 0.1446, spike 0.2477):
  - static dial, NO keys → FBX 0.1919 = ABC 0.1919 (morph carried, match);
  - FLAT keys (every key the same value) → 0.1919 = 0.1919 (still carried);
  - VARYING keys (any sawtooth spike) → **FBX 0.1446 vs ABC-base 0.1919** —
    the morph is dropped from the FBX base mesh entirely (same point count,
    no blendshape channel appears; a binary scan finds zero `BlendShape`
    deformers), while the alembic bakes the true per-frame mesh;
  - identical for `doExport(dir, name, refFrames, false)`, the unmeasured
    `…, true)` variant, and the **dialog** export (probed by staging the same
    scene and clicking Export in the real dialog): all three FBX byte-classes
    match. ERC-driven-ness is IRRELEVANT (non-driven `FBMPearFigure` drifts
    identically). The exporter's own log is line-identical drift vs no-drift;
    the scene dials are restored after `doExport` returns — the mid-export
    zero-drop visible in the viewport is transient and plugin-internal.
  Consequence (the whole classic DTH pipeline is built on it): FBX and
  alembic bases only match when every walked morph evaluates **0 at frame 0**
  — which the old script era guaranteed with 0-floor sawtooths, and which the
  studio enforces since runtime v82 by failing dialed walked morphs loudly
  (`checkDialedWalkedMorphs`; the retired v31 autoBase floors were exactly the
  configuration that broke this). Also note: a keyed-but-flat channel is safe,
  which is why `frameZeroMorphs` (single key at 0) export correctly.
  Probe technique that earned this, reusable: hand-written Runner job files
  (empty `scenePath` row = fresh scene) run arbitrary probe `.dsa` in the live
  Daz; the DazToHue Exporter dialog accepts NO synthetic input (mouse_event at
  verified hit-test coords, PostMessage with correct client coords, SendKeys —
  all inert; only a human click actuates it).
- **DTH's G9 base ROM `.duf`s zero ~700 value channels the ROM never walks —
  including every stock G9 breast pose control.** Measured 2026-08-25 by
  parsing DTH 2.5's preset `.duf`s directly (every G9 base-ROM variant: DQS +
  Linear, FAC and non-FAC): 13 breast channels (`body_ctrl_BreastsUp-Down`,
  l/r halves, Side-Side, In-Out, HangForward, Flatten + `body_bs_` siblings)
  each keyed to **0** with CONSTANT keys at frames 0/2/3/105, inside a ~698-
  channel all-zero list that is plainly an accidental capture of the preset
  author's scene (it names HIS third-party content — Victoria 9 Emotions, JS
  Katey, Van Helsing 9, Toon G9). The G8/G8.1 base ROMs and the G9 Physics
  Example carry NONE of these channels. Consequences: a G9 character's dialed
  breast shape reads 0% across the whole generated ROM (no hold-across-load
  survives an explicit key inside the loaded preset — the retirement premise
  of the v35/v83 preserve-morphs removal was a G8-only truth), and a hand-fix
  at ROM frame 0 dies at the frame-2 zero key. The fix is runtime v101's
  `restoreZeroedDials` (automatic, shape-of-the-accident: RAW baseline
  non-zero + keyed all-zero → flatten keys back to the raw baseline — raw
  restores raw, so an ERC share cannot double-apply and a purely driven half,
  raw 0, is never a candidate). Related measured fact (live DS4 probe,
  2026-08-25): **G9 pose controls (`body_ctrl_*`) are NODE-OWNED properties
  under `/Pose Controls`, not DzMorph modifiers on the figure's object** —
  `findModifier` returns null for them, `oNode.findProperty` finds them, and
  a pass iterating object modifiers alone silently misses every dial the
  zero-list stomps (three diagnostic ROM builds measured exactly that). Any
  future pass over "all dials" must walk BOTH routes
  (`forEachZeroableDial` in DthUtils.dsa). A preset resave upstream
  won't happen (Remo's call, 2026-08-25 — same read as the declined HDA
  feature pitches), so the runtime pass is the PERMANENT fix, not a stopgap —
  don't re-pitch the report; any mention of these presets stays private.
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
- **A ROM's key interpolation has TWO sources, and only one of them is ours.**
  Measured 2026-08-16 (DS 4.24, runtime v76, `scene.animations` read out of a
  shipped `*_ROM.duf`): of 292 morph channels, **230 serialized `CONSTANT` and
  62 `LINEAR`** — and the split is not two kinds of morph. The CONSTANT ones are
  exactly the channels mrpdean's ROM **presets** key (`pCTRL*`, `CTRL*`,
  `facs_ctrl_*`, `facs_jnt_*`, `facs_bs_*`): **`loadPreset` carries the
  interpolation stored in the preset `.duf`, and those files hold CONSTANT.**
  The LINEAR ones are exactly the channels the runtime **creates** with
  `setValue` (they inherit the session default). `Scene.setDefaultKeyInterpolationType`
  cannot touch the first group — it only governs keys created afterwards. All
  1298 transform/bone channels of that same file were CONSTANT too, uniformly,
  from the same presets; since v77 the pass stamps those as well. Values at the
  keyed pose frames are identical under either interpolation — CONSTANT vs
  LINEAR only changes the motion BETWEEN pose frames, which is why stamping
  transforms is safe for a PoseAsset export that samples whole pose frames.
- **`setKeyInterpolationType()` does nothing on DS 4.24 — use `setValue`.**
  Measured over 7747 keys: **zero** changed, in EITHER overload
  (`(i, type)` and `(i, type, 0, 0, 0)`), with no exception and no warning. The
  enum is not the problem — `DzFloatProperty.LINEAR_INTERP` and
  `DzProperty.InterpLinear` both exist and are both `0`. What works is
  **`setValue(tm, val, LINEAR)`**: it rewrites the key's interpolation, at any
  time, inside an undo hold or not. Two conditions, both measured: `setValue` is
  a no-op when the value doesn't change (so nudge the value off and put it back
  exactly), and the **interpolation ARGUMENT is what lands** — setting the
  session default and calling `setValue(tm, val)` leaves an existing key's
  interpolation alone. Never assume a Daz setter worked because it didn't throw;
  `getKeyInterpolationType` reads back honestly and is the only proof.
- **`DzProperty.Linear` does not exist** (DS 4.24) — it reads `undefined`, and
  `Scene.setDefaultKeyInterpolationType(undefined)` fails silently. The runtime
  passed exactly that for years. The spellings that DO resolve are
  `DzProperty.InterpLinear` / `InterpConstant` and
  `DzFloatProperty.LINEAR_INTERP` / `CONSTANT_INTERP` / `TCB_INTERP` (0 / 1 / 2).
  It had **three** call sites, not two, and the third is the one that matters
  most: `setPropertyByName` passed it as `setValue`'s interpolation ARGUMENT —
  the one place the argument is what lands. Grep the whole runtime for a
  constant like this, not just the API you were debugging; v78 fixed two of the
  three on the first pass and the review caught the third.
- **Setting the session default outlives the run.** Now that
  `Scene.setDefaultKeyInterpolationType` gets a defined enum, running a ROM
  script leaves the user's Daz creating **Linear** keys afterwards — it is a
  session-level setting the runtime never puts back. Harmless for the ROM (the
  final pass stamps every key regardless) but it is a real change to the user's
  app, and it is new: for as long as the call passed `undefined` it did nothing
  at all. NOT verified whether it also persists into Daz's saved preferences
  across a restart.
- **Some channels can never be re-interpolated, and that is fine.** Locked
  transforms (`min == max == 0`) and the hidden `/Hidden/CTRLMDs` ERC
  controllers refuse the value nudge, so Daz never rewrites their keys — 310 of
  1500 when measured on a SAVED-AND-RELOADED ROM scene (a live build reported
  none of them: those channels only carry keys once the scene has been through
  a save). Every one was a SINGLE key at frame 0, where interpolation spans
  nothing. Count them apart from real failures, and never
  let them abort the pass: runtime v77 had a "give up after 100 fruitless
  attempts" breaker, those channels sit at the HEAD of the node walk, and so the
  breaker fired on them and switched the fix off for the 5233 keys behind them.
  A give-up rule must key off the *reason* something failed, not a raw count.
  **"Single key at frame 0" is what that scene held, not a law** — the runtime
  re-checks `getNumKeys() == 1 && getKeyTime(0) == 0` per channel before calling
  an immovable key harmless, and an immovable key anywhere else is a run-log
  error. A measurement quoted back as an invariant is how a silent failure gets
  a licence.
- **The Timeline pane's "Set Key Interpolation > Linear" is not scriptable.**
  `DzTimePaneSetInterpLinearAction` (in `dztimeline.dll`, alongside
  `DzTimePaneSelectItemAnimRangeKeysAction` and the `DzTimePaneSetKeyScope*`
  family) is found by the action manager but reports `enabled: false` outside
  the pane's own focus/selection context, so triggering it does nothing. The
  manual workflow — select all keys, set Linear — has no script equivalent
  through the actions; `setValue` is the route.
- **Daz writes an implicit, un-typed key at frame 0.** A channel whose first REAL
  key sits later serializes as `[0, value]` with **no** interpolation element,
  while a channel with a real key at 0 (e.g. one loaded from a preset) gets
  `[0, value, ["CONSTANT"]]`. The bare entry falls back to whatever default
  interpolation the READER has. `setValue(0, v)` on a still-unkeyed property
  sets its static value rather than creating a key, which is how the ROM's own
  frame-0 reset left every created channel like this. v77's
  `dthEnsureFrameZeroKey` nudges the value off and back to force a real key —
  and rolls it back if the value moved at all, because `getValue` on an
  ERC-driven channel reads the controller's contribution too (the double-apply
  trap `closeDanglingMorphKeys` already documents).
- **A failed script `include()`/load logs nothing** in Daz Studio. Diagnose with a
  minimal probe `.dsa` that logs before/after the suspect statement. It can also
  fail TRANSIENTLY: on 2026-08-14 a `.Bulk_ROM_Export.dsa` that had run five
  times that afternoon from the same path came back with no `ApplyDTHCharacter`
  2 ms in, and the identical run straight after was fine — the runtime files
  were present and intact throughout. Cause unknown and not reproduced; what
  makes it survivable is that the generated carriers now PROBE for
  `.DthWorkflow.dsa` before advising (`dthRuntimeMissingError`, runtime v75), so
  a repeat says whether the file was there rather than guessing "reinstall".
- **`include()` must be top-level** in DS6 — a legacy include inside a function
  throws `URIError: Legacy Include` (regression-guarded in `generate.test.ts`).
- **Daz cannot carry non-ASCII out of a script** (measured 2026-08-14, DS4
  4.24): `"Tools → Refresh assets"` written to the run log via `DzFile.write`
  reached the studio as `Tools ? Refresh assets`, and an em dash `print`ed to the
  Daz log arrived as mojibake (`—` → `â`). So every string a generated script
  WRITES or DISPLAYS must be ASCII — bullets, em dashes and arrows all get
  spelled `-` / `>`. Comments are exempt (Daz only parses them). The rule holds
  for BOTH `.dsa` surfaces the studio owns — the generated carriers AND the
  bundled runtime in `apps/web/src/lib/rom/runtime/`, which ships as source and
  installs verbatim — so one scanner (`nonAsciiStringLiterals`, `@dth/rom`)
  guards both: `generate-golden.test.ts` over the goldens,
  `apps/web/src/lib/rom/runtime.test.ts` over the runtime. Guarding only the
  generated half is how the runtime kept 13 violations (a `DthProducts.dsa`
  diagnostics heading written straight to a file among them) while the rule read
  as enforced. Prose typed into a template is exactly where a stray `—` gets in.
- **The Runner marks a row `done` when the script it started RETURNS** — success
  or not. A script that refused the scene, bailed for want of a runtime, or
  failed mid-ROM is byte-identical to one that exported, as far as the job file
  is concerned. The scripts' own channel is the character's ROM run log, so any
  outcome the studio REPORTS has to consult it (`scriptRunFailures` in
  `api/execute/run-state.ts` feeds the finish toast). Believing the rows alone
  shipped "1 scene exported" for a run that wrote nothing at all.
- **A run log's `ok` flag is NOT "the export worked".** The runtime writes
  `ok: bFinished && errors.length + failedMorphs.length === 0`
  (`DthWorkflow.dsa`), which folds two unlike outcomes into one flag: an
  **error** means the scene produced nothing, while a **failed morph** is a
  per-dial partial the product treats as routine — its frame stays in the ROM
  (empty), the export still runs, and the character page lists it for repair.
  Anything deciding "did this scene fail" must read `errors`, not `ok`
  (`producedNothing`, `run-state.ts`); a run that is `!ok` with neither is a
  silent `return false` bail and does count. Trusting `ok` would report a clean
  one-scene export that missed a single dial as "1 of 1 scene failed" AND drop
  the Houdini + Unreal continuations, which both gate on `failed < total`.
- **Anything that calls `logRunError` is deciding to cancel the export** — which
  is easy to forget at the call site, and expensive when the finding does not
  deserve it. Measured (LaraCroft_G81, DS 4.24, 2026-08-16): the interpolation
  pass logged an error for **4 keys out of 7968**, so `ApplyDTHCharacter`
  returned false, so the generated script's `dthRomOk === true` gate skipped the
  export — while the Runner logged the row `done`. Downstream the character's
  `daz-export/thick/` never existed and its Houdini scene failed its load-time
  cook, and the only way to regenerate those files was another full ROM run,
  which hit the same gate every time. Runtime v79 added `logRunWarning` for
  exactly this: **NOT** counted by `runLogProblemCount`, so the export runs, and
  still shown by the studio (amber). The test for which one to use is not
  severity, it is *"are the exported artifacts still correct?"* — for a key that
  kept the wrong interpolation the answer is yes (its VALUE is intact, and only
  the motion between pose frames changes); for a key whose value could not be
  restored it is no, and that one is still an error.
- **A modal in an unattended run is indistinguishable from a hang, and it stops
  the whole batch.** Measured 2026-08-16 (DS 4.24), and it cost hours: a
  `MessageBox` in a Runner-executed carrier waits forever for a click nobody is
  there to make. What you see is Daz's log stopping dead at `Loading script`
  with **no** line after it, **no** "Script executed successfully", CPU flat,
  the row never completing, and — the part that misleads — the main window
  looking normal. It reads exactly like a hung `include()`, so the hunt starts
  in the runtime, which is working perfectly. Two tells separate them: the
  script's own side effects still happened (the failure log IS written, with the
  right content and timestamp), and the main window is *disabled* — enumerate
  top-level windows and look for a VISIBLE-but-DISABLED one, the signature of a
  modal owning it; a title-only scan misses it.
  So: **hidden (dot-prefixed) carriers never open a dialog** — that is what
  hidden means here, and it is pinned by a test in `generate-golden.test.ts`.
  The trap is that "unattended" is not the same as "bulk": `.Build_ROM_Animation.dsa`
  is built with `bulk = false` (it wants the interactive script's shape) and is
  still executed by the Runner, so gating dialogs on `bulk` left exactly that
  carrier able to hang a run. `unattended` is its own flag for that reason. The
  same flag existed on the export script but reached only the export BLOCK, so
  the two guards that fire FIRST (wrong scene, no figure) could still block.
- **The carrier is not the whole modal surface — the RUNTIME it calls is the
  other half, and the carrier test is structurally blind to it.** The
  `generate-golden.test.ts` rule above greps the GENERATED text, so it can only
  ever see dialogs `dsa.ts` wrote. A carrier is a thin call into the shipped
  runtime, and the runtime cannot know who is watching: it opens whatever
  `MessageBox` its own code says to. Measured 2026-08-18 (v0.83.1, runtime v84):
  a 2-scene LaraCroft batch parked on `ApplyDTHCharacter`'s end-of-build
  "Something went wrong while building the ROM" box — every carrier passed the
  no-modal test, and scene 2 sat behind scene 1's dialog anyway. Same audit in
  the same session found `DthProducts.dsa` doing it twice more (`getInstalledProducts`
  on a DIM folder that moved or sits on an unmounted network drive, and
  `writeProductsCsv` on a failed write) — reached from `DthScanProductsQuiet`,
  which runs inside EVERY ROM/export row and whose own doc comment already
  promised neither would.
  So the rule has two halves: the carrier text carries no `MessageBox`, **and
  every runtime entry point a carrier can reach takes a "nobody is watching"
  flag and honours it on every branch that can refuse.** The flag is
  `config.bUnattended` for `ApplyDTHCharacter` (baked by `dsa.ts`, set AFTER the
  per-scene deltas are diffed so an override scene can neither carry nor strip
  it) and `config.bulk` for the scans. **Audit by reachability, not by file:**
  grep `MessageBox\.` across `apps/web/src/lib/rom/runtime/` and, for each hit,
  ask whether an unattended entry point can reach it — a flag that stops at the
  entry function and never reaches the helper it calls is the recurring shape
  (v85 threaded it two levels down for exactly that reason). The runtime half is
  pinned behaviourally in `runtime.test.ts` (the `.dsa` loaded into a VM sandbox
  with a recording `MessageBox`), because no text scan over generated carriers
  can reach it.
- **A count is not a finding.** The same run reported its 4 bad keys with no
  node, no dial, no key index and no frame — the pass had every one of them in
  hand and threw them away. Nothing could be chased without patching the runtime
  first. Since v79 each unfixable key is named in both the Daz log and the run
  log's `keyProblems[]`, including **the interpolation Daz actually reports
  back** (`CONSTANT (1)`) rather than only "not LINEAR", and the frame is
  derived from `Scene.getTimeStep()` — `getKeyTime` returns TICKS, and a tick
  count printed as a frame number is a wrong answer, not a raw one. Cap such a
  list per KIND, never as one shared pool: the interesting kind is usually the
  rare one, and a shared cap lets a flood of the common kind erase it.
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
  modal may only stand down once the claimed batch shows real work — a live
  Daz stuck on a modal Save prompt claims late and looks identical to the
  closing claim until the first work signal. "Real work" must include the
  VERBOSE PROGRESS LOG, not just the job file (measured 2026-08-18): the
  Runner rewrites the job file per ROW and marking a row `running` is optional,
  so a ONE-scene batch reads untouched for its entire run, then the watch
  deletes it at 100 — the modal's old row-mark-only probe never saw a settle
  condition and spun forever under the finish toast. The whole per-tick rule is
  `classifyPendingHandoff` (execute-jobs.ts): terminal 'gone' when the handoff
  no longer exists in any form, 'working' on a row mark OR — **only alongside a
  live process** — a progress-log line, and a LAUNCH is only success once the
  claim actually happens. That process condition on the log is the same
  corollary once more: the batch a log line speaks for is UNTOUCHED, so a
  Runner that claimed it, logged one line and died with the closing Daz is the
  orphaned-claim strand itself — standing down over it would strand the batch,
  while relaunching repeats nothing. **Every road out of that modal is
  bounded** (`WaitForDazCloseModal`, tested loop-side in
  `wait-for-daz-close.test.tsx`): it relaunches when the launched process dies
  unclaimed (single-instance forward into a not-quite-dead Daz) but only every
  5th tick and at most 5 times, then says so rather than spawning a Daz per
  second at one that cannot start — `launch_daz_studio` reports the SPAWN, never
  that the process lived; it retries a rejected launch every tick and names
  WHICH call failed after three consecutive failures; and a claimed file that
  stays unparseable for 10 ticks ends the wait (`'unreadable'` is its own class
  for that reason — an unparsed batch is never reclaimable, so nothing there can
  change) instead of hanging settled-but-unresolved.
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
- **Two Daz installations open side by side both work the job queue** (observed
  2026-08-19: a DS4 and a DS6 open together, successive batches distributed to
  whichever Runner noticed first — "jobs run in both, in parallel"). Both
  Runners watch the SAME `Scripts/DTH-Character-Studio/` folder of the shared
  library, and the job file is flavor-agnostic. The claim rename is exclusive,
  so one batch never runs twice — but the `running_` claim file and the verbose
  progress log exist ONCE, and a Runner picking up a new batch deletes any
  existing `running_` file as stale litter (a live peer's included), so two
  live batches garble each other's progress/finish bookkeeping. Detection is a
  plain process COUNT: each install is single-instance (a second same-install
  launch forwards and exits), so 2+ `DAZStudio.exe` processes = 2+
  installations — no path reading, which also sidesteps the unreadable-path
  problem of an elevated Daz. Every batch handoff writer (export, ROM build,
  project scan, scene scan) calls `assertSingleDazInstance` BEFORE any arming
  step touches disk and surfaces the refusal as a dialog (`MultipleDazModal`),
  not a toast — the user has to go close a Daz, and a failed probe never
  blocks. The interactive `open-scene` handoff is deliberately NOT guarded:
  with two Dazs the scene just opens in whichever grabs it, which is
  nondeterministic but harmless.
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
- **Two PRs must never claim the same `RUNTIME_VERSION`** — and the collision is
  invisible to git. Both branches change `84` to `85` on the same line, so the
  merge is CLEAN; the goldens agree; nothing conflicts except the runtime hash
  (which reads as ordinary rebase noise). What ships is one version number over
  two different runtimes, and `copyRuntimeFiles` skips the install on a matching
  `v<N>` marker while the generated header `// DTH-Runtime: v<N>` equals
  `RUNTIME_VERSION`, so the second change never reaches an install that already
  took the first and nothing anywhere reads as stale — no pulse, no prompt, and
  the changeset's "run Refresh assets" is a note the user has no reason to act
  on. Unfixable in the field afterwards: the only repair is another bump.
  Measured 2026-08-18 — #894 took v85 while #895 sat in review holding v85, and
  the release order between them was a coin flip. **So re-check the constant
  against `origin/main` before opening the PR and again before merging, not just
  when you write it**; if it is taken, take the next number (a skipped number
  costs nothing — versions only have to be monotonic) and renumber the
  schema-history entry with it. `git log -S'RUNTIME_VERSION = <n>'` will not warn
  you: it answers about history, and the branch you are racing has none yet.
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
  RUNTIME_FILES entry to the ABSOLUTE installed path (`"<root>/.<Dep>.dsa"` since
  runtime v84; `"../../.<Dep>.dsa"` before — the relative form was fatal for the
  same file included by a VISIBLE root-level script, which lives AT the runtime
  root). The absolute form resolves from any depth, but the layering rule stands:
  the visible wrapper does the includes, in dependency order (`.DthUtils.dsa`
  first, then the scanner), and the scanner just calls the utils functions as
  globals — a scanner that included utils itself would now double-load it. The
  rewrite is string-blind: even a double-quoted runtime filename in a COMMENT
  gets repointed.
- **`getScriptFileName()` lies on the first script of a cold-started Daz**
  (measured 2026-08-18, DS6, LaraCroft_G81, a 2-scene DTH Export whose handoff
  launched Daz): the FIRST row's bulk script captured a self-path that resolved
  the runtime include into `C:/Program Files/DAZ 3D/DAZStudio4/resources/` —
  Daz's own install tree — so the row failed "runtime missing" with the runtime
  installed and intact, while row 2 of the same batch (same script, warm Daz)
  worked. Recurring and previously unreproducible-on-demand: it needs the
  cold-start window, and the misleading "expected at" path (pre-v80 reports)
  sent earlier investigations at the install, which was never broken. WHY the
  API answers a Daz-internal path there is unmeasured (plausibly Daz's own
  startup scripting still in flight — inference, not fact).

  Since runtime v84 nothing **a Runner batch row** relies on trusts it alone.
  That covers two DIFFERENT uses, and the include is only the louder one:
  - *Finding the runtime.* Generated scripts probe the relative answer and fall
    back to an install root baked in at generation time (`runtimeDirSnippet`,
    `packages/rom/src/dsa.ts`); the per-run `.dth_scan_run.dsa` does the same
    against its own folder (`lib/rom/scan-run.ts`); the installed runtime and
    root scripts get absolute includes (`copyRuntimeFiles`). The failure report
    prints the raw self-reported folder, so a recurrence carries its evidence.
  - *Deriving a data path.* `.Scan_Scene_Bulk.dsa` finds `dth_scan_config.json`
    through `scriptDir`, and `Build_Genesis_Index*.dsa` derives its content root
    the same way. Both are batch rows, so both are **baked** at install time
    (`__DTH_RUNTIME_DIR__`), not read back from the API. A fix that repaired only
    the includes would have left these failing in the identical window, with the
    identical misleading message.

  **When adding anything that runs as a batch row, ask which of the two it is** —
  the trap is that a path derived from `getScriptFileName()` looks nothing like
  an include and is just as broken. What still trusts it, deliberately: the
  `OUT*.csv` debug dumps (`DthOptions.dsa`, `DthWorkflow.dsa`), which are off by
  default and write nothing the studio reads.

  Two consequences worth keeping: the absolute bake means the marker stamp in
  `copyRuntimeFiles` must include the destination — a moved/renamed Daz library
  carries the marker inside the folder, and absolute paths, unlike the `../../`
  form they replaced, do not survive the move. And a script that is *installed*
  can be baked outright, while a *generated* one still probes relative first, so
  a relocated install keeps using the runtime sitting beside it.
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

