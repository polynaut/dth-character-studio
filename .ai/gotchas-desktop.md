# Gotchas — Desktop / Tauri

Part of the gotchas set — `.ai/gotchas.md` is the index. Learned by measurement or painful debugging; verify details against the current code, but assume the *lesson* still holds. New facts in this area land HERE, in the same PR that earned them.

## Desktop / Tauri

- **Never create a webview window from a synchronous `#[tauri::command]`** — it
  deadlocks (white frozen window). Use `#[tauri::command(async)]` and
  `tauri::async_runtime::spawn` (the single-instance handler does this).
- **`pressButton()` on an HDA callback SWALLOWS the HDA's exception — a failed
  export returned "ok" for a year.** Houdini runs a parm callback through its
  own wrapper, which catches whatever the script raises, prints
  `Error running callback:` + the traceback, and RETURNS NORMALLY. So
  `export_one`'s try/except in `456.py` never fired and every HDA-side failure
  was reported as an export. Measured 2026-08-19 on a real project: its
  PoseAsset CSV was missing, so both `DazToHuePoseAsset` nodes threw
  `FileNotFoundError` in their OnLoaded handler, both `DazToHueExport` nodes
  then threw `AttributeError: 'NoneType' object has no attribute 'attribValue'`
  inside `do_export`, and the studio toasted **"2 exported in 17s"** over an
  export that wrote nothing. The 17s — hython booting, loading and failing
  twice — was the only symptom, and it was noticed only because a human
  thought it looked too fast. Same family as the DazToHue material bake that
  reports success on a missing texture (below): in this pipeline a clean
  return proves NOTHING, and anything that only checks for a raised exception
  is not checking. Two detectors now, because one channel is not enough:
  `SWALLOWED_FAILURE_MARKERS`/`swallowed_failure` in 456.py scans the tee'd
  stdout+stderr and marks the NODE failed (per-node attribution), and
  `houdiniConsoleFailure` (houdini-jobs.ts) scans the process console log —
  the only channel that carries what Houdini prints from C++ or before the
  in-process tee is entered, e.g. those load-time handler tracebacks. Keep the
  two marker lists in step; matching a Houdini `Warning(...)` line must stay
  OUT of both (the `sidefx_hud_button` warning is in every run of some
  projects, so treating it as failure makes the signal permanent and therefore
  invisible). And the backstop is only as good as its FEED: the api layer's
  read guard (`houdiniConsoleWorthReading`) must hand the console to the
  finished-claiming-clean poll, not just the dead one — the first version of
  this fix checked the console in `houdiniRunStateFrom` but the guard only
  read it for dead runs, so the backstop shipped dead with green tests (they
  called the pure function directly). The general
  lesson: a detector's wiring is part of the detector — verify what production
  actually passes in, not what the test hands it.
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
- **The lint tree is at ZERO warnings and `pnpm lint` runs `--deny-warnings`**,
  so any warning from any rule fails CI. The 221 that used to sit there were
  DECISIONS, not debt (sequential awaits are deliberate fs ordering, the
  react-markdown component maps are that library's API, the map-spreads build
  new records) — they are now stated where they apply instead of counted:
  - **A file-level `/* oxlint-disable <rule> */` with a reason** where the
    pattern is the module's whole shape: 24 of the 50 modules under
    `lib/rom/api/` + `lib/rom/storage/` (ordered filesystem work), three
    Playwright files, two table-driven test files, and the two react-markdown
    files. NOT those directories wholesale — the header goes on a file only
    once it actually has such a loop.
  - **An `oxlint-disable-next-line` with a reason** at a one-off site. It must
    be the LAST comment line before the code — "next line" is literal, so a
    reason written *underneath* the directive silently doesn't apply (measured;
    it cost four re-runs).
  - **`"off"` in `.oxlintrc.json`** when the rule simply doesn't fit the
    codebase (`oxc/no-map-spread`: its fix is to mutate, which is a bug for
    React state) — better than apologising to it at 13 call sites.
  A file-level disable is a real trade, not a free win: inside those files the
  rule is OFF, so a NEW accidental instance there is invisible to CI and only a
  reviewer catches it. Prefer `disable-next-line` when the pattern is a one-off.
  Don't "clean up" a suppression by deleting it; the pattern it names is still
  deliberate. This replaced a `.lint-baseline.json` count ratchet, which was
  fungible — swapping a deliberate instance for an accidental one left the
  total unmoved — and which had also been inert on CI for months. (The 221:
  184 `no-await-in-loop` + 24 `no-unstable-nested-components` + 13
  `no-map-spread`, measured by neutering every directive and re-linting —
  exactly the baseline's per-rule sums. The three rules that were never
  baselined report 0 today, so `--deny-warnings` covers them going forward
  rather than cleaning anything up.)
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
  — `RUNTIME_VERSION` in `packages/rom/src/types.ts`, the wiring in `refreshAllAssets`
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
  DTH Export panel. The rule that reads them (`hipsForSelectedScenes`) only
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
- **A DazToHue bake with a MISSING layer texture reports SUCCESS.** Measured
  2026-08-13 on DazToHue 2.5 / Houdini 22.0, on a real project: point
  `material_texture_baker_layer_texture<b>_<l>` at a file that does not exist,
  press Bake, and the Houdini console prints `DazToHue: export started` /
  `baking material textures` / `export finished in 0:00:02` — no dialog, no node
  error, nothing in the log. There is no check to inherit: the HDA is
  **black-boxed** (`hotl -X` refuses: *"the library is black boxed"*), but its
  bake path is readable and `do_bake_material_textures` is a bare
  `hou.node('bake_textures/OUT_TEXTURE_BAKER').cook(force=True)`, while the
  entire 60 KB material PythonModule holds ONE `os.path.exists` — in the texture
  browser's drag-and-drop handler. So the studio is the only thing in the
  pipeline that can report it, which is why `refs.missingTextures` exists and
  why it is the one badge problem with no repair button (the fix is a reinstall,
  outside the app). Scoped by parm-name PREFIX, and measured to earn it: on that
  project the material node carries 86 FileReference parms, 51 of them these,
  and all 51 resolve — zero false positives, unlike the whole-scene sweep above.
  Counted as unique PATHS, not `<node> <parm>` labels: one uninstalled product
  takes the same file out of many layers.
  Two traps if you go re-measure this. **Driving the bake headlessly does not
  work**: the button callback calls `hou.ui`, which hython has not got, and
  force-cooking `OUT_TEXTURE_BAKER` directly completes clean and writes nothing.
  It has to be pressed in the GUI. And **never name a hython script after a
  stdlib module** — an `inspect.py` in the script's own directory is imported by
  Houdini's bundled `future` package during `hou` init, which re-enters the
  script mid-import and segfaults hython (exit 139) with a traceback that blames
  `hipFile.load()`.
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
- **The flagged install and the ACTIVE install are never the same one.** "Export
  only" means "the batch runs somewhere OTHER than where everything else runs",
  so on the active card it is not a choice — it is the default wearing a switch.
  `exportOnlyCandidateKeys` never offers it there, the section never RENDERS it
  there (the one exception to "a card carrying the flag keeps its switch"), and
  activating a flagged install clears `dazExportInstallKey`/`…Folder` in the same
  save (`routes/settings.tsx` → `onActivateDazInstall`). Clearing is the half
  that is easy to forget: hiding the switch alone would leave the flag armed with
  nothing on screen to disarm it — harmless only by coincidence, because
  `exportInstallFolder` would resolve it to the active folder anyway. And only
  UNTIL the next activation: a pre-fix settings.json can already hold
  flag === active (nothing cleared it back then), and activating a *different*
  install would resurrect that stale flag as a live redirect to the previous
  Studio — so `onActivateDazInstall` disarms on EVERY activation while the flag
  sits on the currently-active install, not just when activating the flagged one.
- **Elevating a CHILD, not the session** (`elevate.rs`, the Daz plugin install).
  Four facts that shaped it, three of them the kind that only bite on someone
  else's machine:
  `std::process::Command` can never produce an elevated child — a child inherits
  the parent's token — so the only route is `ShellExecuteExW` with the `runas`
  verb (`SEE_MASK_NOCLOSEPROCESS` to get a handle worth waiting on, and the
  calling thread needs `CoInitializeEx`; a Tauri async command's pool thread has
  no COM). **A declined UAC prompt is `ERROR_CANCELLED` (1223) from
  `GetLastError` after `ShellExecuteExW` returns FALSE** — a choice, not a
  failure, and the UI must not paint it red.
  **The administrator token has none of the user's mapped drive letters** (they
  are per-logon-session), so any path handed to an elevated child is rewritten to
  UNC first, in the unelevated parent, by `drives::unc_path` — a machine with its
  Daz release folders on `X:` otherwise fails on the SOURCE path while the error
  talks about the destination. And **`ERROR_SHARING_VIOLATION` (32) has no
  `std::io::ErrorKind`** — `raw_os_error() == Some(32)` is the only way to tell
  "Daz has this DLL loaded" from "access denied", which matters because
  elevation fixes exactly one of them and the app now offers a button for it.
  Two more, measured 2026-08-17 while reviewing that code:
  **`lpParameters` carries ~32K and fails LOUDLY past it** — a probe passed
  32,182 chars through to the child byte-for-byte and got `ERROR_FILENAME_EXCED_RANGE`
  (206) from `ShellExecuteExW` at 32,782, i.e. the CreateProcess command-line
  ceiling, with no silent-truncation window in between. That is what makes the
  hex-payload-as-argv design safe: a real batch is a few KB (2 hex chars per
  JSON byte), and the failure mode past it is an error code, not a half-decoded
  install. Measured with the `open` verb — the `runas`/AppInfo half needs a UAC
  prompt per trial, so its ceiling is unprobed, though a live run on 2026-08-17
  confirmed it carries a real batch (a few KB) without complaint.
  And **the UNC rewrite fixes the drive LETTER, not the credentials**: a share
  the user mounted with stored credentials has no session under the
  administrator token either, so `\\host\share\…` can still be unreachable over
  there. `install_plugin_dlls` therefore probes the source with `try_exists()`,
  not `exists()` — the latter answers `false` for "not allowed to look", which
  would report a folder the user is staring at as missing.
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

