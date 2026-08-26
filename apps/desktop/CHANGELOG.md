# @dth/desktop

## 0.91.0

### Minor Changes

- [#977](https://github.com/polynaut/dth-character-studio/pull/977) [`1ff0915`](https://github.com/polynaut/dth-character-studio/commit/1ff0915e4b39f85ed575ecda87eab0bffe0c3728) Thanks [@polynaut](https://github.com/polynaut)! - Make paths portable now FIXES paths under a foreign Daz library root — the
  missing baker textures and "cannot be made portable" references a moved
  library (or a `.hip` from another machine) leaves behind. When a path's
  library-relative tail exists under your configured library, the repath
  repoints it there as `$DAZ3D_LIB/…` (portable straight away); the General tab
  counts these as fixable instead of stuck, the card badge says which missing
  textures the button repairs, and the report names each old → new pair. Only a
  path whose target file actually exists is ever rewritten — everything else
  stays reported, exactly as before.

## 0.90.0

## 0.89.0

### Minor Changes

- [#971](https://github.com/polynaut/dth-character-studio/pull/971) [`2d8b5fc`](https://github.com/polynaut/dth-character-studio/commit/2d8b5fc696282e0fe0ca910705c729c026f3ec77) Thanks [@polynaut](https://github.com/polynaut)! - Every exporting DTH Export row now gets a FRESH Daz Studio session, and every
  row's export is judged by the exporter's own motion summary.

  Daz's re-evaluation of fitted followers silently degrades after a scene
  re-load inside one Daz session (measured 2026-08-24/25, DS4 4.24: every
  scripted export after a re-load froze eyes/grafts/clothing at 9–35% of the
  figure's moved frames, 5/5 reproductions — the exporter cannot fix it from
  inside). Two defenses ship together:

  - **Fresh session per row** (job-file contract v4, `sessionPerRow`; needs
    Runner v1.4.0): the Runner runs ONE row per Daz session and quits; the
    studio's new export supervisor starts the next session, kills a hung one
    (hard per-row timeout — a teardown was measured hanging indefinitely with
    the UI alive), requeues a crashed session's batch, and refuses to let a worn
    session (Daz already open with a scene) run row one. Older Runners keep
    working single-session — the gate below still catches the wear.
  - **Motion-summary gate** (studio-side, historical): after a batch, each
    scene's export log ("Alembic ROM motion summary", exporter ≥ 2.1.9) is
    parsed and the scene FAILS when multiple meshes moved on far fewer frames
    than the SAME meshes reached in earlier summaries of the same log — the
    measured degradation signature — or when nothing moved at all. Judging each
    mesh against its own history is what keeps scenes whose ROM legitimately
    leaves meshes still (a face the ROM never animates) from false-positiving;
    a first-ever export has no history and gates nothing. Thresholds are pinned
    by tests against verbatim blocks from both measured incident logs. A
    degraded scene drops out of the Houdini/Unreal continuation like any dead
    export set.

## 0.88.4

## 0.88.3

## 0.88.2

## 0.88.1

### Patch Changes

- [#944](https://github.com/polynaut/dth-character-studio/pull/944) [`647229b`](https://github.com/polynaut/dth-character-studio/commit/647229b1d326780d21eea5b28897a78f1d96be56) Thanks [@polynaut](https://github.com/polynaut)! - A Daz or Houdini export leg that dies silently can no longer report as a success.

  - **Export-landed guard**: after the Daz batch finishes, each scene's export
    set is judged from the disk before the Houdini leg consumes it — a 0-byte
    `.dth`, a missing manifest, or the export sweep's `.dthprev` backups still
    standing (the signature of a script Daz's engine killed mid-export) now fails
    that scene loudly and drops it from the Houdini continuation, instead of
    cooking the corpse into a green checkmark. A scene that failed OUT LOUD —
    a failed Runner row, or a script that reported its own failure — now drops
    out of that continuation as well: its export folder looks landed only
    because the failure path put the previous export back, and handing it on
    imported last week's character under this run's checkmark. **"Skip Daz — use
    last exports" gets the same verdict**: its readiness test was "a `.dth` is
    there", which a 0-byte corpse passes — the mode whose whole input is what
    happens to be on disk now refuses to run Houdini over a dead export, and
    says which scene and why.
  - **The export backup sweep finishes its job again** (runtime v100): the
    `.dthprev` step that restores the previous export on failure and purges it on
    success was listing through a directory handle read _before_ its own renames,
    so it did neither — a successful export kept every backup it made, and a
    failed one never got the previous set back. Refresh assets regenerates the
    installed scripts. Because a script from the previous runtime still leaves
    its backups behind, leftover backups are now reported as a **warning** rather
    than treated as proof the export failed; the `.dth` decides.
  - **Honest Houdini death reporting**: a headless export that exits without a
    word is reported as "Houdini exited during \<its last step\>" instead of
    quoting a stale load-time warning as the cause; the hython exit code —
    previously discarded by the fire-and-forget spawn — rides along (hex spelling
    included for Windows crash statuses).

## 0.88.0

### Minor Changes

- [#938](https://github.com/polynaut/dth-character-studio/pull/938) [`935b6ae`](https://github.com/polynaut/dth-character-studio/commit/935b6ae3653a4b18d2fd1d02f30c7448d571a43d) Thanks [@polynaut](https://github.com/polynaut)! - DTH Export names the jobs each project will contribute, before the run starts

  The panel's Houdini rows now carry one chip per **DazToHue network** the stored
  scan says that project writes, and the Unreal rows one chip per **character**
  this run would land in that project. So the size of a run — two networks in one
  `.hip`, one character re-imported and another dropped — is readable before
  pressing Start, instead of only once the task list has filled in.

  The two lists answer different questions, and the rows are worded for it. The
  Houdini chips describe the **project**: they stand whether the row is ticked or
  not, and under "Skip Houdini", which runs no Houdini leg at all. The Unreal
  chips describe **this run**, already narrowed to the sets the studio located in
  that project — the send is re-import only, so those are exactly the import jobs
  the run will queue for it.

  Both stay silent where the studio cannot say: an unscanned Houdini project names
  nothing rather than claiming it writes none, a run that produces no export names
  no characters rather than promising the stale folder on disk, and a set the
  Unreal project has never held is left off, because the run would drop it too.

- [#937](https://github.com/polynaut/dth-character-studio/pull/937) [`4dddfb1`](https://github.com/polynaut/dth-character-studio/commit/4dddfb1ce91a7796da4e30354223c6bb0765b02d) Thanks [@polynaut](https://github.com/polynaut)! - **Renaming a character now takes its exports with it.** The exporter names every file it writes after the character — and, measured on a real export, writes the name _inside_ them too: a `.dth` carries `"Character Name"` and absolute paths to its own `.fbx`/`.abc` siblings. So a rename used to leave a full export set on disk that nothing would ever write to again, while the Houdini projects went on importing it by the old name — silently, because those files still exist and still load.

  Renaming a character that has **no** exports yet is unchanged: it just renames. Renaming one that **does** now opens a dialog first, itemizing both export folders (the Daz→Houdini `daz-export` set and the final `export/` tree) with their file counts and sizes — one scene's set is routinely a gigabyte — and saying plainly that they are deleted, not renamed, and that a **DTH Export** run rebuilds them. Cancel and nothing happens at all. Your Daz scenes, saved ROM animations and Houdini project files are never touched.

  Confirming clears both folders and then **follows the rename into every linked Houdini project**: each DazToHue import path is rewritten to the new export names (and to the new character folder, whose `$JOB` is repointed in the same pass), and each import node's **character name** is moved to the new name — unless you had typed your own there, which is reported and left alone. Paths on your _own_ nodes are reported too, never rewritten. Each project is backed up before it is saved, and if Houdini isn't paired in Settings the dialog says so _before_ you commit to anything.

  Under the hood this is a new `retarget` operation on the Houdini utilities. It is deliberately not the existing **Make paths portable**: that one only ever writes a path it has verified on disk, and after a rename there is nothing to verify — the old set is gone and the new one doesn't exist until you re-export. Which is exactly the point: the projects are pointed at what the _next_ export will produce.

### Patch Changes

- [#932](https://github.com/polynaut/dth-character-studio/pull/932) [`d13bc86`](https://github.com/polynaut/dth-character-studio/commit/d13bc86123835de4ccee3d632254bf74f8cc7390) Thanks [@polynaut](https://github.com/polynaut)! - Fix: a DTH Export whose Unreal project is not the one already open no longer sits unclaimed forever. The studio can now read WHICH projects the running Unreal editors have open (their command lines name their `.uproject`), so a queued import job opens its own project next to a different one instead of refusing to launch because "an editor is running" — and the run's status line says what actually happened in every case: opened, opened beside the running editor, target open but not claiming (restart the editor if the Runner was just installed), or an editor the studio can't identify. That last case — the one the studio cannot resolve — is now also warned about when the DTH Export panel opens, before the Daz and Houdini legs spend their minutes, instead of surfacing as an import that silently never runs.

## 0.87.0

### Minor Changes

- [#931](https://github.com/polynaut/dth-character-studio/pull/931) [`9068388`](https://github.com/polynaut/dth-character-studio/commit/9068388674b9dd55913e1f82de844597dc660e31) Thanks [@polynaut](https://github.com/polynaut)! - The **Unreal project cards** in the project footer now carry the same **Utils** wrench the Daz-scene and Houdini cards do, in place of their old install button. It opens a **Utils drawer** whose **Install** tab holds the list that used to be a modal — DTH content, the DTH Character Studio Runner, and every configured plugin build matching the project's engine version — as a full-height drawer with Install pinned to its bottom edge, so a long plugin list no longer scrolls the button out of reach.

  **What is ticked for you has changed: it is now what the project is missing.** Anything already installed and current starts unticked — tick it to install it again (a checked row still overwrites). The one exception is an installed-but-outdated **DTH Character Studio Runner**: the card's amber ⚠ says "re-install it", so the drawer offers that row like an absent one and marks it _out of date_.

  The card's amber ⚠ now covers both reasons a linked project still needs setting up — **no DTH content yet**, or an **out-of-date Runner** — and clicking it opens the drawer that fixes it. The wrench itself stays neutral, like every other card's.

### Patch Changes

- [#933](https://github.com/polynaut/dth-character-studio/pull/933) [`8419c52`](https://github.com/polynaut/dth-character-studio/commit/8419c52ac0c3a6725f664e31dc14fa3237acb65a) Thanks [@polynaut](https://github.com/polynaut)! - **Closing a dialog or drawer no longer pops the tooltip back up.** Tooltips are swept away when an overlay opens (they render above it), but closing one hands focus back to the control that opened it — and a tooltip on focus shows with no delay, so it reappeared over the app under a mouse that had never moved.

  Focus now only shows a tooltip when the focus is the **keyboard's**: tab to an icon-only control and its description still appears immediately, while focus the app moved for you — an overlay closing, a click landing on a button — stays quiet. Hovering is unchanged.

## 0.86.1

### Patch Changes

- [#929](https://github.com/polynaut/dth-character-studio/pull/929) [`fc17e9f`](https://github.com/polynaut/dth-character-studio/commit/fc17e9f72d3dfa5ebe1c664f18e908be22ee28b0) Thanks [@polynaut](https://github.com/polynaut)! - Fix: a failed export can no longer destroy the copy that survived the _previous_ failed export. Before running the DTH Exporter the studio parks the existing export set aside as `<name>.dthprev`, and puts it back if the run fails. But a run that dies outright — Daz closing, the exporter aborting — never reaches that step, so the backup stays parked with a half-written file beside it. The next export then deleted that backup to make room, on the assumption that the newer file must be the good one. It isn't: measured on a real project, the "newer" files were a 0-byte `.dth` and a 29 MB fragment of an 807 MB Alembic. An existing backup is now understood as the last copy anything finished writing, and it is kept.

  Also fixed: the hair Alembics were matched by a name test loose enough to match their own backups, so every export parked the previous backup again — `.dthprev.dthprev.dthprev.dthprev` files, and no live hair Alembic left. Existing stacks clear themselves on the next successful export.

  Runtime v99, so **Tools → Refresh assets** reinstalls the generated scripts.

- [#928](https://github.com/polynaut/dth-character-studio/pull/928) [`fc64c34`](https://github.com/polynaut/dth-character-studio/commit/fc64c34bf8489c09c7b75318308cd6b307e6fdce) Thanks [@polynaut](https://github.com/polynaut)! - Fix: a DazToHue export that fails inside Houdini is no longer reported as a success. Houdini runs an HDA's button callback through a wrapper that catches the script's exception, prints it, and returns normally — so the studio saw a clean return and counted the node as exported. A run whose project could not load its PoseAsset CSV therefore finished in 17 seconds, wrote nothing, and toasted "2 exported". Failures are now read from what Houdini actually printed: 456.py marks the individual node failed, and the studio additionally checks the run's console log, which is the only channel carrying errors Houdini raises before or outside the in-process capture (a project that fails while _loading_ now says so instead of finishing quietly).

- [#927](https://github.com/polynaut/dth-character-studio/pull/927) [`05ebed1`](https://github.com/polynaut/dth-character-studio/commit/05ebed1f05ea1ae167ff3e00433b46509ac1d438) Thanks [@polynaut](https://github.com/polynaut)! - Fix: a finished Houdini project no longer collapses its task rows back to one. The run's list is one row per DazToHue **network**, but only the project being exported right now could name its networks — so the rows went 1 → N → 1, and a two-project run that really exported four networks showed two rows for the whole thing. Each project's rows now survive its turn, keeping the status the run gave them: a failed network stays failed, and one an interrupted queue never reached stays unstarted rather than being ticked off.

## 0.86.0

### Minor Changes

- [#914](https://github.com/polynaut/dth-character-studio/pull/914) [`086d577`](https://github.com/polynaut/dth-character-studio/commit/086d5772b06e99b5c0411d7cfb0a6943c8306e03) Thanks [@polynaut](https://github.com/polynaut)! - Generated Houdini projects now get their **timeline range set from the Alembic file itself** — the same routine DazToHue's Import node runs when it loads a character (read the Alembic's own start/end frames, set the playbar, re-cook the import, back to frame 0). The generation re-runs it deliberately at the end, because the HDA's own trigger is best-effort and never fires when the Daz export hasn't produced the file yet — and the confirmation now names the frames the saved scene actually plays.

  The project health check learned the same fact: the scan reads the playbar next to what the project's own Alembic says it should be, and a scene still on Houdini's default 1–240 over a longer ROM gets a "Needs attention" badge — part of the ROM would sit outside the timeline. **Utils → Repair project settings** repairs it in the same run as `$JOB` and the FPS (one file open, one backup, one save), writing whatever the Alembic answers at 30 fps. A project with no Alembic to read yet — generated before its Daz export — is reported as such and left alone, never guessed at.

- [#924](https://github.com/polynaut/dth-character-studio/pull/924) [`04af875`](https://github.com/polynaut/dth-character-studio/commit/04af875ad2b60cd3bf66a00feb95f8b3a0e3d207) Thanks [@polynaut](https://github.com/polynaut)! - The two export-shape switches in **Daz scripts generated** — _Run the export with the ROM script_ and _Export hair assets too_ — are **gone**, and the generated Daz scripts are now always the three separate ones: **`ROM_…` builds the ROM**, **`Export_…` runs the exporter and delivers the PoseAsset CSV**, **`Export_Hair_…` exports the grooms**. One job per script, so re-exporting never costs another ROM build and there is no combination left to get wrong. `Export_…` is generated whenever an Export directory is set; `Export_Hair_…` whenever the character lists hair items. The panel that held the switches is now purely informational — it says where the scripts land and where they deliver.

  **The DTH Export button is unchanged.** It runs its own hidden bulk script, which still builds and exports everything — skeleton, mesh and every hair asset — in one unattended pass, and still honours the per-scene _Export hair items_ switch. Those carriers' bodies are byte-identical to before apart from their version stamp and a few comment lines.

  **If you drive Daz by hand**, the ROM script no longer exports: run `ROM_…`, then `Export_…` in the same Daz session (and `Export_Hair_…` for grooms). `Export_…` still hides the character's hair items around its export, so grooms stay out of the main artifacts exactly as before. Character schema v38 drops both stored toggles and runtime v98 reshapes the scripts, so **Tools → Refresh assets** regenerates every installed script into the new layout — the combined ROM script is replaced in place, and the retired `rom-export` Content Library tile gives way to the plain ROM one.

- [#925](https://github.com/polynaut/dth-character-studio/pull/925) [`d083435`](https://github.com/polynaut/dth-character-studio/commit/d083435fd116f957afe6cd18cb9c03a9abdd155c) Thanks [@polynaut](https://github.com/polynaut)! - DTH Export gains a "Hair items only" Daz mode: it exports each selected scene's hair items on their own (one Alembic per item) and nothing else — no ROM build, no skeleton/mesh export, no CSV. The scene list shows only the scenes whose "Export hair items" switch is on, all pre-checked; like ROM only, the run stops after Daz. Generation now emits a fourth hidden Runner carrier, `.Bulk_Hair_Export.dsa` (runtime v97) — the standalone Export_Hair pass run unattended — and the script sweep also retires the export-only carrier when the export dir is cleared (it used to linger).

## 0.85.0

### Patch Changes

- [#909](https://github.com/polynaut/dth-character-studio/pull/909) [`65d43ae`](https://github.com/polynaut/dth-character-studio/commit/65d43aeea488cb1d93aa59385bb76114579db553) Thanks [@polynaut](https://github.com/polynaut)! - Refuse DTH job handoffs while more than one Daz Studio is open. Two installations open side by side (a DS4 next to a DS6) both host a Runner watching the same job file, so batches ran in whichever Daz noticed first and their progress bookkeeping could clobber each other. Every batch handoff (DTH Export, ROM build, project scan, scene scan) now counts the running Daz processes first — each install is single-instance, so two processes means two installations — and shows a dialog asking to close all but one.

## 0.84.0

## 0.83.2

### Patch Changes

- [#896](https://github.com/polynaut/dth-character-studio/pull/896) [`bffc1f8`](https://github.com/polynaut/dth-character-studio/commit/bffc1f879c3aea4dc7f55b2a86807ff31156e7af) Thanks [@polynaut](https://github.com/polynaut)! - The Houdini project card now catches a PoseAsset node reading another export set's CSV. The export always delivers the PoseAsset CSV beside the set it belongs to under the set's own name, so a project whose PoseAsset still points at a different set's CSV — typically an older project wired before its scene grew per-scene ROM overrides — imports the wrong frame layout the moment the scenes diverge, silently. The background scan now reads each PoseAsset's CSV path together with its own network's import, and the card badges the mismatch with the exact path to point the node at. Existing scan results re-earn themselves on the next visit to the character page.

## 0.83.1

## 0.83.0

### Minor Changes

- [#883](https://github.com/polynaut/dth-character-studio/pull/883) [`18ae7c5`](https://github.com/polynaut/dth-character-studio/commit/18ae7c521f01a6275e355b88bb6165388b7eff3e) Thanks [@polynaut](https://github.com/polynaut)! - "Preserve morphs after ROM loading" is gone (schema v35, runtime v83).

  Current DazToHue releases hold those morph values across the ROM load by
  themselves, so the studio's own restore pass had nothing left to do — and it was
  not harmless: it FLATTENED each listed morph's whole animation to the hold value
  at the very end of the build, so a morph that was both preserved and posed as a
  ROM frame lost its posed keys.

  **Morphs set at frame 0** moves to the top of the Advanced options panel, where
  the retired list sat — it no longer has a panel of its own. Below it, Advanced
  options keeps **Preserve node transforms** (the memorize-before / restore-after
  pass for posed nodes like the eyes), which is untouched — per-scene overrides,
  the Fill wizard's "Also copy" extras and the character-zip import all keep it.

  Existing characters upgrade on read: the stored morph list is dropped, and a
  per-scene preserve override that existed only because its morph list differed is
  dropped with it, so no scene is left silently pinned to an old node-transform
  list. Tools → Refresh assets reinstalls the runtime and regenerates the scripts.

## 0.82.1

## 0.82.0

### Minor Changes

- [#865](https://github.com/polynaut/dth-character-studio/pull/865) [`c453503`](https://github.com/polynaut/dth-character-studio/commit/c453503ece2b694905eae9c6e6a8c82ed3ab16f4) Thanks [@polynaut](https://github.com/polynaut)! - The DTH Export run is now followed by real file watching instead of polling.

  The studio watches the Daz job-file pair (the Daz library's studio scripts
  folder) and the verbose progress log (app-data) with a native file watcher —
  the fs plugin's notify backend (`ReadDirectoryChangesW` on Windows, FSEvents
  on macOS). The Runner's pickup rename, every per-row rewrite and the final
  progress-100 write now reach the export button, the pipeline panel and the
  Tools → Scan project panel the moment they land, instead of on the next
  2.5-second poll tick.

  The interval survives as a slow safety-net heartbeat, deliberately: change
  notification over SMB/NAS shares is best-effort, watching isn't available in
  a plain browser, and a Daz that dies mid-run announces itself through no file
  event. The Houdini and Unreal legs keep their full-speed poll — their files
  aren't part of this watch (yet).

  Every refresh trigger (watch event, heartbeat, window focus) now funnels
  through one coalesced call per panel, so a burst of events can never race two
  destructive finished-run reads over the same job file.

  Paired with DTH Character Studio Runner v1.3.0, which watches for the handoff
  the same way (`QFileSystemWatcher` + fallback timer) — together they make the
  studio → Daz pickup and the Daz → studio results near-instant. Older Runners
  keep working on their poll; the job-file contract is unchanged.

- [#873](https://github.com/polynaut/dth-character-studio/pull/873) [`eafecf9`](https://github.com/polynaut/dth-character-studio/commit/eafecf960a10a9a9bec2a078c3926e4b7766af25) Thanks [@polynaut](https://github.com/polynaut)! - The ROM now fails loudly when a walked morph is dialed in the scene — and the
  autoBase/base sawtooth floors are gone (schema v34, runtime v82).

  Measured root cause of the FBX/Alembic base-shape drift: the DTH Exporter's
  FBX pass excludes every morph whose ROM keys vary from the base mesh — on the
  scripted and the dialog export path alike — while the Alembic bakes the true
  timeline. A non-zero sawtooth floor (the v31 autoBase feature, or a manual
  `base`) therefore always shipped a shaped Alembic base against an unshaped FBX
  base, and shrank the HDA-generated morphs to the leftover dial headroom.

  Now the sawtooth floor is always 0, and a new build-time gate fails every
  frame that walks a morph dialed non-zero at frame 0 (tolerance 0.001, ERC-
  driven dials called out so you zero the controlling dial). The failures ride
  the run log: the offending frames turn red in the studio with the reason, and
  the export is skipped — a drifting export can no longer be produced silently.
  Zero the dial in the export scene (its shape reaches Unreal through the
  generated morph, now at full range) and rebuild.

## 0.81.0

## 0.80.0

### Minor Changes

- [#854](https://github.com/polynaut/dth-character-studio/pull/854) [`ddff570`](https://github.com/polynaut/dth-character-studio/commit/ddff5709d68dde451cee8eab58bd7b394c14d1b2) Thanks [@polynaut](https://github.com/polynaut)! - Installing the Daz Studio plugins no longer means restarting the whole studio as
  administrator.

  Copying two DLLs into `<Daz>/plugins` was the only thing that ever needed
  administrator rights, but the price was paid by the entire session: an elevated
  studio cannot see your mapped network drives, Windows silently blocks
  drag-and-drop into an elevated window, and everything it writes afterwards ends
  up owned by the administrator.

  Now the plugin install borrows those rights for the copy alone. When a copy is
  refused for permissions, the report offers **Install with administrator rights** —
  one Windows prompt for the whole batch, performed by a short-lived helper, with
  the studio window left exactly as unelevated as it was. Declining the prompt is
  reported as the choice it is, not as an error.

  A plugin Daz Studio has loaded is a different problem, and the install now says
  so instead of blaming permissions: administrator rights cannot unlock a loaded
  DLL, so that failure asks you to close Daz and offers no elevation button.

## 0.79.2

## 0.79.1

## 0.79.0

## 0.78.0

## 0.77.0

### Minor Changes

- [#819](https://github.com/polynaut/dth-character-studio/pull/819) [`f3bbdd5`](https://github.com/polynaut/dth-character-studio/commit/f3bbdd5923b5eda704fa6c19421b762952c1aa7b) Thanks [@polynaut](https://github.com/polynaut)! - The ✨ **Generate project** button is gone from the Unreal projects bar.

  Creating an Unreal project is Unreal's own job: its New Project screen is where
  the templates live (Third Person, Blueprint vs C++, starter content), and which
  one a production starts from is a decision worth making there. What the studio
  generated instead was a bare Blueprint project with empty `Content/` and
  `Config/` folders — no template, which is almost never what you actually want.

  Nothing else changes: link a `.uproject` you made in Unreal with **Add project**
  (or by dropping it on the bar), then use the card's install button for the DTH
  content and plugins exactly as before. Engine detection in **Settings** stays —
  it is what matches plugin builds to each project.

### Patch Changes

- [#811](https://github.com/polynaut/dth-character-studio/pull/811) [`6c2cc20`](https://github.com/polynaut/dth-character-studio/commit/6c2cc204aded19515132d4b9262194fbdf5b3931) Thanks [@polynaut](https://github.com/polynaut)! - The **DTH Character Studio Runner for Unreal** is versioned and tracked, like
  its Daz counterpart. The studio ships that plugin into your Unreal projects, and a plugin folder keeps whatever
  was installed the day it was installed — so it now carries a version the studio
  reads back, and a project holding an older copy gets an amber warning on its
  card (re-install from the same card, then restart the editor once). A send
  refuses outright and names both versions.

  The plugin's version is deliberately separate from the job contract: a fix to
  the Runner's Python changes nothing the two sides must agree on, and still has
  to reach every project holding the old copy.

- [#813](https://github.com/polynaut/dth-character-studio/pull/813) [`eb70daa`](https://github.com/polynaut/dth-character-studio/commit/eb70daa4a7bc928cf8eecc7ab320b30142714520) Thanks [@polynaut](https://github.com/polynaut)! - Unreal plugin scan: a plugin's own version is no longer read as the engine's.
  `KawaiiPhysics_5.7_1.21.0.zip` and `KawaiiPhysics_5.8_1.21.0.zip` both listed as
  **UE 1.21** — the engine is named first and the plugin's version last, and the
  last version-looking number won. An Unreal Engine major is between 4 and 9
  (`.uplugin` starts at UE4, and a two-digit number in a plugin name is a year or
  the plugin's own version, never an engine), so anything outside that is now
  skipped wherever it sits in the name, and the two builds read as 5.7 and 5.8.

  The same rule applies to a `.uplugin` whose `EngineVersion` holds the plugin's
  version: an impossible version means **no** constraint — the build is offered
  for every engine — rather than a constraint no project can satisfy, which would
  have dropped it out of every install checklist without saying so. Where a build
  is offered for every engine, the BuildId check still marks it if its binaries
  were made for a different engine build.

- [#818](https://github.com/polynaut/dth-character-studio/pull/818) [`6f1cc99`](https://github.com/polynaut/dth-character-studio/commit/6f1cc99505f0cb0c2c9509c7ac6232c5a82a19da) Thanks [@polynaut](https://github.com/polynaut)! - Tooltips get out of the way. Opening a dialog or a side panel now closes any
  tooltip that is showing — and cancels one whose hover delay is still counting
  down, so it can't appear a moment later on top of the panel you just opened.
  Tooltips float above every other layer, so one left over from the button you
  clicked used to hang over the dialog it opened.

  The update prompt gets the same treatment, and it is the one that needed it
  most: it appears on its own when an update check finishes, so — unlike every
  other dialog — no click had already dismissed whatever you were hovering.

  The same applies whenever the window hands focus to something else: launching
  Daz Studio, Unreal or Houdini, revealing a path in Explorer, opening a link — or
  just alt-tabbing away. The pointer never moves in those cases, so nothing told
  the tooltip to go, and it stayed painted over the app while the other tool was
  in front.

## 0.76.0

## 0.75.0

### Minor Changes

- [#799](https://github.com/polynaut/dth-character-studio/pull/799) [`61399b4`](https://github.com/polynaut/dth-character-studio/commit/61399b4121ab17c314d610fcc0e0038871272278) Thanks [@polynaut](https://github.com/polynaut)! - Daz Studio now starts minimized for work nobody is watching.

  Every unattended run the studio hands to the Runner — a **DTH Export** batch, a
  **project scan**, an **Import from Daz scene** scan, and the restart of a batch
  that was still waiting when Daz closed — used to open Daz Studio full size, in
  front of whatever you were doing, for a job that takes minutes and needs no
  input. Those launches now bring Daz up **minimized**: it sits in the taskbar and
  works, and the studio's own progress button is where you watch the run.

  What did not change:

  - **Opening a scene from its card** still opens Daz normally and pulls it to the
    front — you asked to see the scene.
  - **Open and Generate ROM Animation** still comes up visible too. It opens a
    scene you picked and leaves the built ROM on its timeline to look at.
  - **A Daz you already have open** is never touched. The studio only minimizes an
    instance it started itself; an instance of your own keeps whatever position and
    size you left it at, and simply picks the batch up.

  Windows only, and best-effort by design: if the window never appears the launch
  still stands on its own, and nothing waits on the minimize.

- [#795](https://github.com/polynaut/dth-character-studio/pull/795) [`3a2fdc2`](https://github.com/polynaut/dth-character-studio/commit/3a2fdc2d49b9f26ee512d76f31132d532ea2d0e0) Thanks [@polynaut](https://github.com/polynaut)! - The DTH Export dialog's Houdini list now follows the scene selection. Tick a Daz scene off and the projects that only import that scene leave the run with it; tick it back on and they return. The match is the same one Houdini itself makes at export time — a project belongs in the run when one of its networks imports a selected scene's `.dth` file — so what the dialog shows and what the run exports can't disagree. Network and project NAMES are deliberately not consulted: they get renamed and copied around, the import path doesn't.

  That knowledge comes from the background project scan, which now records each project's imported `.dth` files alongside its nodes, `$JOB` and fps (no extra Houdini launch — it reads them in the same pass). A project only ever leaves the run when its imports actually name a scene you unticked. Everything short of that keeps whatever you have: a project the scan hasn't reached yet — outside the character folder, or saved in Houdini since the last sweep — and one whose imports match none of this character's scenes either way, which is what a path spelled differently on the two sides (a mapped drive, an old junction path) looks like from here. The studio can't know in those cases, and quietly dropping a project would skip the Houdini half of a run you asked for.

- [#795](https://github.com/polynaut/dth-character-studio/pull/795) [`3a2fdc2`](https://github.com/polynaut/dth-character-studio/commit/3a2fdc2d49b9f26ee512d76f31132d532ea2d0e0) Thanks [@polynaut](https://github.com/polynaut)! - The DTH Export header now shows the whole pipeline live. A task-card column (each selected Daz scene, then each Houdini project, in run order) sits beside a monospace tail-mode log window above the header buttons: the active task wears its kind's solid color, waiting ones sit grayish, and a finished task drops away bottom-right while the rest slide up. The log window streams both legs — the new per-scene Daz progress and the Houdini HDA's captured output. A full-width progress-bar row sits on top: one bar for the unit under work (the Daz scene's percent straight from the progress log; a stepwise open-project-then-each-network scale on the Houdini leg), and a second overall bar above it whenever the leg spans several units (multiple scenes, multiple DazToHue networks). Every element says its own thing exactly once: the numbered task cards carry the scene/project names, the meter carries the percent plus the latest status text as its label, and the log window is a pure line tail (no caption row, no repeated percent/scene per line). The scripts also log step START markers ("generating ROM", "exporting character", …), so the display names what is running, not only what finished — and the mid-run hand-over toasts are gone: one report at the very end. And reloading the app during the **Daz** leg no longer loses the run: every handoff writes its run plan to a sidecar (`export-run.json` in app-data, deleted when the run ends), so the character's own editor **restores the full watch** on its next poll — the elapsed clock, the chosen Houdini projects' task cards, and, most importantly, the "Export too" continuation itself, which previously died silently with the reloaded window's memory. Any _other_ window still gets the display-only adoption, now rebuilt from disk too: Daz task cards from the job file's own rows, log window and meters from the progress log. (A reload during the **Houdini** leg still loses its watch, as before — the export finishes in the background either way, but the studio stops showing it and reports nothing.) And the log window itself never disappears while a run is live — nor does it linger after one: an adopted display clears when the batch it mirrored is gone.

  Daz-side progress comes from the new Runner v1.2.0 contract: the job file carries a `progressLogPath` + per-row `steps`, the Runner logs `[<percent>] <message>` lines for the steps it owns (scene open, terminal done/failed) and the generated scripts (runtime v72) append the interior steps — ROM generated / character exported / CSV delivered / hair exported — on the same per-scene percent scale (5 steps with a ROM build, 4 export-only, 2 rom-only). Old Runners keep working (they ignore the new fields; the display then shows row counts as before).

  The "Export too" Houdini leg now runs **completely headless**: hython loads the project and works the batch in the background — no Houdini window, no startup/viewport wait, and the full console (C++ cook chatter included) streams into `.dth_houdini_console.log` beside the job/result files (one file per character, overwritten each run and kept afterwards as the diagnosis channel — a run that matches no export nodes now logs exactly what it wanted vs. found). The job is handed over by running the studio's script directly, never via `HOUDINI_SCRIPT_PATH` — Houdini runs scripts found there against the startup empty scene too, which consumed the job before the project had loaded. "Open only" still opens the visible GUI. Liveness comes from the launched process itself, so an unrelated hython (background scans) can't masquerade as the run. Both live buttons now ignore a plain click — a stray click used to silently drop the watch, which read as "the export vanished" — and hold **Ctrl** for the way out: Abort on the Daz leg, Stop watching on the Houdini one, which also cancels the projects still queued behind it. That matters more now than it did: with no Houdini window left to close, it is the only way to end a wedged run or change your mind about a queue.

  It also shows what Houdini is doing **during** an export node's minutes-long run, not just node counts: 456.py now captures the HDA's own output (stdout/stderr and status-bar messages) while `do_export` works and streams it into the polled result file — the header's log window names the scene and shows the lines live (verified on a real run: the HDA emits a 9-phase progress vocabulary), and each node's report keeps a capped log. Nothing captured degrades to the elapsed-time display as before.

  Also restored: the ~1 s settle pauses at the Daz automation seams (runtime v71 — the Runner-driven bulk script waits after the scene load before the first scripted work, and every export waits after the ROM build before the exporter starts), which had been orphaned by an earlier squash-merge.

- [#794](https://github.com/polynaut/dth-character-studio/pull/794) [`be0edaf`](https://github.com/polynaut/dth-character-studio/commit/be0edafed05b0d9693658cb57dae3a87f3bc80f5) Thanks [@polynaut](https://github.com/polynaut)! - Unreal Engine plugins, an install dialog, and Generate Unreal project.

  **Settings → General** gains two panels: **Unreal Engine** lists every engine
  the Epic launcher has installed (informational — a `.uproject` names its own
  engine, so there is nothing to activate), and **Unreal Engine Plugins** holds
  the folders the studio scans for UE plugins — a plugin folder, a folder of
  plugins, or a multi-build root like `DazToUnrealBridge\UE_5.7\Plugins`, with a
  per-folder preview of every recognized build and the engine version it was
  matched to (from the path, deepest segment first, else the `.uplugin`'s
  `EngineVersion`; none = offered for every engine).

  **The Unreal card's install button now opens a dialog**: DTH content plus every
  plugin build matching the project's engine version — read from its `.uproject`
  when the dialog opens — all pre-checked, uncheck what you don't want, one
  primary **Install**. Checked items overwrite what is there (copy-over, never
  delete-first); the old Ctrl+click-to-overwrite is retired with the dialog
  carrying that intent explicitly. A source-build GUID association lists every
  build unchecked instead — only the user knows what fits it.

  **Generate Unreal project** (the bar's ✨) creates a fresh Blueprint-only
  project bound to a detected engine version, installs the checked DTH content +
  plugins into it in the same run, and links it — a DTH-ready Unreal project
  without opening Unreal first. Opening the generated project in Unreal itself
  has not been verified on a real engine install yet.

### Patch Changes

- [#795](https://github.com/polynaut/dth-character-studio/pull/795) [`3a2fdc2`](https://github.com/polynaut/dth-character-studio/commit/3a2fdc2d49b9f26ee512d76f31132d532ea2d0e0) Thanks [@polynaut](https://github.com/polynaut)! - A generated Houdini project now opens with its character already loaded, on the rest pose. Setting the import paths from a script never ran the import node's own "a character was chosen" routine — the one that offers to fill the sibling paths and then actually reads the files, which is what sets the Alembic's frame range and puts the scene on frame 0. So a freshly generated project could hold every path correctly and still sit on the wrong frame, and the fix was to clear the fields and re-pick them by hand. Generate project and Tools → Fill network now run that routine themselves (answering its prompt the way you would), and the studio puts its own `$HIP/…` paths back afterwards, so the project stays movable. It runs only when the files are really on disk: a project generated before the Daz export has produced them has nothing to load, and comes out exactly as before.

## 0.74.0

### Minor Changes

- [#791](https://github.com/polynaut/dth-character-studio/pull/791) [`2c37033`](https://github.com/polynaut/dth-character-studio/commit/2c37033874e1ff6ddac32a9f61c2c630ca028160) Thanks [@polynaut](https://github.com/polynaut)! - Character **Export & Import** — the character page's Operations card packs the whole character into a self-contained `<Name>_<date>.dcsc.zip` (definition, notes, all Daz scenes, all Houdini projects, avatar and studio metadata always; the regenerable `daz-export` / final `export` trees behind two toggles; already-compressed content is stored, the rest fast-deflated), saved to a folder you pick. Importing the zip onto a character opens an **import wizard** (Fill-style): rename the character (pre-filled from the zip), pick the ROM sections/extras to take over, the Daz scenes to restore (primary mandatory — existing scenes are always replaced) and the Houdini projects (added beside or replacing the character's own); the character entity persists. Dropped on a project page, the zip restores wholesale as a new character. Every stored path is repointed to the new location — including the Houdini projects' `$JOB` and references (via the Utils drawer's repair ops) — and the generated artifacts are refreshed.

- [#792](https://github.com/polynaut/dth-character-studio/pull/792) [`11bc2de`](https://github.com/polynaut/dth-character-studio/commit/11bc2de480be692c873de78ac99ae6de6179a2ec) Thanks [@polynaut](https://github.com/polynaut)! - Houdini projects get the ROM's **30 fps timeline** — set at generation, checked
  on the card, repaired from the Utils drawer.

  A ROM is one pose per FRAME at 30, and that is what the PoseAsset CSV's frame
  numbers mean; Houdini's own default is 24, which lands every imported ROM frame
  between two of the scene's own. DazToHue's import node sets the scene FPS itself
  _when it loads the files_ — which is exactly what a headless **Generate project**
  never does (hython instantiates the network and fills its parameters directly), so
  the studio now sets it up front and reports the FPS the saved scene actually
  carries rather than the one it asked for.

  The background scan reads each project's timeline in the same pass as `$JOB`, so
  a project on another rate gets a **Needs attention** badge naming it, and a new
  **Timeline (FPS)** row in the Utils drawer's General tab. **Repair $JOB** is now
  **Repair project settings** and fixes both, each judged on its own — a project
  whose `$JOB`is fine and whose timeline is 24 gets only the timeline written, and
the report says which of the two moved. What Houdini's`setFps` does to keys in an
  already-animated scene is Houdini's behaviour and is not something this studio has
  measured; the run's usual rolling backup is stated alongside it. A value the scan
  could not read stays _unknown_ and is never repaired.

## 0.73.1

## 0.73.0

### Minor Changes

- [#775](https://github.com/polynaut/dth-character-studio/pull/775) [`0b07ff3`](https://github.com/polynaut/dth-character-studio/commit/0b07ff3953f597d2c08639df370f88dfbbab9605) Thanks [@polynaut](https://github.com/polynaut)! - **Fixed: with "Export only" set, DTH Export started nothing at all.**

  Daz Studio 4 and Daz Studio 6 both run an executable called `DAZStudio.exe`, and the studio's "is Daz running?" check went by that name. So with the newer Studio open and **Export only** pointing at the older one, the export concluded Daz was already running, never started the installation the batch was actually for, and left the job file waiting for a Daz that never came — silently: no window, no error. The same blindness let a running Daz Studio 6 hijack a launch aimed at Daz Studio 4, and kept the "waiting for Daz Studio to close" dialog spinning forever over an installation that was not the one closing.

  Both checks now identify an installation by the running executable's path, not its name: the export batch asks about the installation _it_ runs in, everything else (opening a scene, the scene-open bridge) still asks about any Daz, and a launch starts the installation it was given rather than whatever happens to be open.

  **New: clear a stuck exporter job file from Settings → App Data.**

  The handoff file that caused the above blocks every later export _and_ scan with "a batch is waiting for Daz Studio", and until now nothing could remove it once no character owned it anymore. **Storage & housekeeping** now shows which job file is there (waiting for Daz, or claimed by the Runner), how many jobs it holds and how old it is, warns when Daz may still be working through it, and deletes it on confirmation.

  The warning is never bypassed by the file changing under it: Daz can claim a batch at any moment, so the readout is re-read when you open the confirmation and again when you press delete — if it has become a different file in between, nothing is deleted and you are asked to look again.

## 0.72.0

## 0.71.0

## 0.70.0

## 0.69.0

### Patch Changes

- [#747](https://github.com/polynaut/dth-character-studio/pull/747) [`2fbe4a3`](https://github.com/polynaut/dth-character-studio/commit/2fbe4a3e720a9413f661dd94d10713365dde6a53) Thanks [@polynaut](https://github.com/polynaut)! - The studio starts the Daz Studio you activated

  Activating a Daz installation in Settings decided where the Exporter plugin was
  installed — but not which Daz the studio actually started. Opening a scene was
  handed to the shell, so Windows' `.duf` association picked the version (whichever
  registered the file type last), and the exporter's launch fell back to a
  hardcoded newest-first probe of the standard install folders. On a machine with
  both DS4 and DS6 installed, activating DS4 changed neither: DS6 opened, while the
  Exporter plugin sat in DS4 and appeared to be missing.

  Every launcher now carries the activated installation. Opening a scene starts
  `DAZStudio.exe` with it directly, which is association-independent. A Daz that is
  already running still wins — DS4 and DS6 are separate single-instance apps, so a
  script or scene can only be forwarded to the instance that is up.

## 0.68.1

### Patch Changes

- [#745](https://github.com/polynaut/dth-character-studio/pull/745) [`e63efd5`](https://github.com/polynaut/dth-character-studio/commit/e63efd52160638384d3af76f94dfffb463151504) Thanks [@polynaut](https://github.com/polynaut)! - Adding a Houdini project asks the way adding a Daz scene does — and Generate stops throwing a console window at you

  **No more copy toggle above the buttons.** It had to be answered before you had
  even picked a file, and it hinted at a folder choice that does not exist. Now
  picking a `.hip` from outside the character folder asks the same question a Daz
  scene asks — **Copy in** (with _Delete original after copying_ when you meant to
  move it) or **Link in place** — and a `.hip` that already sits inside the
  character folder is just linked, because there is nothing to decide. A copy
  still always lands in the character's Houdini folder; the dialog says so instead
  of offering a subfolder field with no answer.

  **Generate project no longer pops a console window.** `hython` was started
  without the flag that suppresses it, so a black window appeared on top of the
  dialog and took focus mid-generate. The material-utilities runner had always
  suppressed it; this one simply never did.

## 0.68.0

### Minor Changes

- [#730](https://github.com/polynaut/dth-character-studio/pull/730) [`5e4d104`](https://github.com/polynaut/dth-character-studio/commit/5e4d10433b4ef6f7b0d6924cb396a1daf96c561b) Thanks [@polynaut](https://github.com/polynaut)! - **The `houdini-project` folder is retired, and the empty ones are cleaned up.**
  It was created inside every character's houdini folder to be the shared
  **Set Project** target — the one project folder all of a character's scenes
  would share. It could never do that job: Houdini writes its own output (renders,
  caches, backups) relative to **`$HIP`**, and `$HIP` is _derived_ from the folder
  the `.hip` sits in. Set Project sets `$JOB`, not `$HIP`. So the output always
  landed beside the scenes and the folder stayed empty.

  Nothing is lost, because the houdini folder was already doing it: every one of a
  character's scenes lives there, so they already share one `$HIP` and their output
  already collects in that single folder.

  **Existing folders are removed on the next save or Refresh assets — but only
  when empty.** A project made before v0.64 _did_ have `$JOB` pointed at this
  folder, so Houdini may have written real caches or renders into it. That is your
  output, not the studio's, so a non-empty one is left exactly where it is and
  named in the Refresh assets report for you to look at.

  **Settings/Utils → General no longer reports `$HIP`.** It is derived from the
  scene's own location and can never be anything else, so the row was a check that
  could not fail beside an action that could not run. `$JOB` — the one the studio
  can actually repair — is now the only row.

- [#733](https://github.com/polynaut/dth-character-studio/pull/733) [`e3fb935`](https://github.com/polynaut/dth-character-studio/commit/e3fb935a8c8d37c77f8fe43d6d9ea2d3d88a7c4c) Thanks [@polynaut](https://github.com/polynaut)! - The app's own files leave your character folders

  A character folder collected five files nobody put there: `.dth_execute_stamps.json`,
  `.dth_export_folders.json`, `.last_rom_run.json`, the Daz-written
  `dth_rom_run_log.json`, and the generated `<Name>_pose_asset.csv`. All of them are
  the studio talking to itself, and they sat right next to your Daz scenes and
  Houdini projects.

  They now live in the project's hidden meta folder, one folder per character:
  `<project>/.dcsmeta/characters/<Character>/` — beside the avatars and note media
  that were already there. Your character folder holds the definition and your own
  files, nothing else.

  **The move happens on its own.** Every save relocates that character's files; one
  **Tools → Refresh assets** does the whole library (the script runtime bumped to
  v59, so every character reads as out of date until it has run). The relocation
  only ever touches names the studio itself wrote for that character — a CSV you
  copied back out of an export folder is left exactly where you put it.

  If you take the PoseAsset CSV by hand (no direct export), it is now at
  `<project>/.dcsmeta/characters/<Character>/<Name>_pose_asset.csv`.

- [#734](https://github.com/polynaut/dth-character-studio/pull/734) [`e80da9f`](https://github.com/polynaut/dth-character-studio/commit/e80da9f2278897f9c920851754dd3b19d7dc60c2) Thanks [@polynaut](https://github.com/polynaut)! - Daz product scanning runs itself

  Scanning your products used to be a chore with three steps: switch the feature on
  per project, run a script in Daz, then come back, look at what was found and press
  **Store on character**. The middle step is the only one that ever needed you.

  Now: **set the DAZ Install Manager manifests folder in Settings, and that's it.**
  That folder is the product database, so having it is the only thing a scan needs —
  every export run scans the scene it just built, the studio picks the results up on
  its own and files them against the character. The review dialog, the Store button
  and the "your stored list is older than the scan" banner are all gone; there is
  nothing left to keep in sync.

  - **The per-project "Daz Products" switch is now "Show the Daz Products tab".** It
    only decides whether the character page shows the tab. Scanning and filing happen
    either way, so switching it on later shows you results already collected.
  - **Results are kept per scene**, so re-scanning one outfit replaces only that
    outfit's entry and leaves the others alone. The tab shows them merged.
  - **The Daz-written CSVs are deleted once they're read** — they were only ever a
    transport, so they no longer pile up in the app's data folder waiting for the
    30-day age-out. (That sweep still runs, as the backstop for anything a pickup
    can't take: files from a crashed scan, and the diagnostic reports.)
  - **Results moved off the character definition** into
    `<project>/.dcsmeta/characters/<Character>/products.json`, with the studio's other
    per-character files. A few hundred rows of machine-derived data had no business in
    a file meant to be read and shared. Products already stored on a character are
    carried over automatically the first time it is saved or refreshed — nothing to do.

  Script runtime v61: every character regenerates on the next **Tools → Refresh
  assets**, which is what teaches the existing scripts to scan.

- [#742](https://github.com/polynaut/dth-character-studio/pull/742) [`1707389`](https://github.com/polynaut/dth-character-studio/commit/1707389db6f60914db6c9dd7c2b2d24d2fdb8a06) Thanks [@polynaut](https://github.com/polynaut)! - After an elevated install, one click back to normal — drag-and-drop works again

  Installing the Exporter or Runner plugin into Program Files means running the
  studio as administrator — and Windows then silently blocks drag-and-drop from
  Explorer into the elevated window: drops just do nothing, with no error. The
  moment an elevated install succeeds, the studio now says so and offers
  **Restart normally**: the launch is handed to Explorer (so the new instance
  runs at your normal level, like a double-click), the current project reopens
  via its `.dcsp`, and drops work again. Nothing shows on a dry run, a failed
  install, or a normal-elevation session.

### Patch Changes

- [#739](https://github.com/polynaut/dth-character-studio/pull/739) [`b1bb992`](https://github.com/polynaut/dth-character-studio/commit/b1bb992d48b68f97ee27d94e1161a33e5771736f) Thanks [@polynaut](https://github.com/polynaut)! - Hardening for this release's features, from an adversarial review before it
  shipped: the product-scan pickup can no longer consume a CSV Daz is still
  writing (the writer now closes each file with an end marker, runtime v61), a
  pre-update character's stored products survive leftover scan files, re-scans
  replace carried-over entries instead of duplicating them, changing the DIM
  manifests folder now marks generated scripts out of date, "Export too" fills a
  blank export directory with the character's `export/` folder (not the
  `dth-exports` intermediate), Fill network offers a wired network its OWN
  scene's paths, and a stale scene pick in Generate project errors instead of
  silently wiring the primary.

## 0.67.0

### Minor Changes

- [#724](https://github.com/polynaut/dth-character-studio/pull/724) [`0543470`](https://github.com/polynaut/dth-character-studio/commit/0543470a60fc36c9f8a8659efa451772721998bc) Thanks [@polynaut](https://github.com/polynaut)! - **Settings → General now finds your Daz installation instead of asking for it.**
  Every Daz Studio the DAZ Install Manager has installed appears as a card at the
  top of the tab. Click one and three paths are derived from it and saved
  immediately — **My DAZ 3D Library**, the **Daz Studio install folder** and the
  **DIM manifests folder** — then shown read-only underneath, because a derived
  path you can edit is one that can quietly disagree with what produced it.

  DIM records all of this in `%APPDATA%\DAZ 3D`, at a fixed location whatever
  folder DIM itself lives in, so nothing is searched for and nothing is guessed.
  The old manifests detection walked `<A..Z>:/DAZ 3D/Install Manager/ManifestFiles`
  and took the first hit; it survives only as the last of three fallbacks.

  With both Daz Studio 4 and 6 installed, both get a card and the newest is marked
  _recommended_ — but nothing is activated until you click, so a first run still
  starts with empty paths and adopts them the moment you choose. Only the install
  folder follows the card; the library and product database belong to DIM, not to
  one Studio version. **Set the paths manually** hands the three fields back with
  their current values, for a machine DIM doesn't describe — and a machine with no
  DIM at all keeps the editable fields it always had.

- [#728](https://github.com/polynaut/dth-character-studio/pull/728) [`ab7cc1a`](https://github.com/polynaut/dth-character-studio/commit/ab7cc1aa83f64a9dd3e86acd2fa0ac9a36f2bbc3) Thanks [@polynaut](https://github.com/polynaut)! - **Settings → General now finds your Houdini too**, the same way it finds Daz.
  SideFX registers every installed version, so each one gets a card — activating
  one fills the **installation folder** and its matching
  `houdini<major>.<minor>` **documents folder** together, and saves them.

  Filling them together is the point rather than a convenience: the studio runs
  `hython` with that documents folder as its preferences directory, and pointed at
  another version's it loads the wrong DazToHue assets — or none — so every node
  comes back as an unknown type. Pairing by hand is exactly how that goes wrong.

  The newest install _with_ a documents folder is recommended: one whose folder
  doesn't exist yet is still offered, with the missing folder named on its card
  (Houdini creates it on first launch — start it once and press **Rescan**).
  A `houdini<major>.<minor>` folder no installed version claims is reported below
  the cards instead of dropped; it's usually left behind by an uninstall. Extra
  Houdini documents folders stay yours to manage — that list exists so an older
  Houdini can keep an older DTH release.

- [#719](https://github.com/polynaut/dth-character-studio/pull/719) [`9076da4`](https://github.com/polynaut/dth-character-studio/commit/9076da496ff7eb28df6fe93b1459232db384e5da) Thanks [@polynaut](https://github.com/polynaut)! - Houdini Utils: **Defaults** is now **General**, and it leads. It is the tab the
  drawer opens on — the one that answers "are these projects healthy?" without
  needing a second project picked — and its checks were rebuilt as one row shape:
  name on the left, verdict on the right, the value beneath. The `$JOB` essay
  moved into the section's info popup, the three actions carry their own icons in
  the order they must be run, and the footer states the whole tab's verdict rather
  than only the `$JOB` repair's. Three stacked result panels are now one slot, so
  a fresh run replaces the last answer instead of piling another report under it.

  **Backups became a safety net instead of a status line.** Every run that writes
  still takes one rolling `backup/<name>_dthbak.hiplc` first, but no report says
  so any more — "· backup written" on every success only taught the eye to skip
  the line. It surfaces exactly once, where it is worth something: a failed entry
  now offers **Undo this run**, which puts that project back the way it was before
  the run (a plain file copy — no Houdini round trip). A failed save carries its
  backup into the report so the offer is there when it matters.

- [#721](https://github.com/polynaut/dth-character-studio/pull/721) [`3382ce2`](https://github.com/polynaut/dth-character-studio/commit/3382ce20b0e4ba47be8c675a23e40388c736d086) Thanks [@polynaut](https://github.com/polynaut)! - Houdini Utils backups now last as long as the drawer. They are an undo buffer
  for one sitting, not an archive — each is a full copy of the project (~8 MB for
  a real `.hiplc`), one lands beside every project a run writes, and nothing else
  in the studio would ever collect them.

  Closing the drawer now lists the copies this session made and asks: **Remove**
  clears them, **Keep them** doesn't, **Cancel** goes back. If a run failed and
  hasn't been undone the prompt says so in amber — that copy is the only way back.
  Only the studio's own `_dthbak` files are ever deleted; Houdini's own backups
  sit in the same folder and are never touched, and a file Houdini is holding open
  is reported as kept rather than silently counted as removed.

### Patch Changes

- [#726](https://github.com/polynaut/dth-character-studio/pull/726) [`73157f8`](https://github.com/polynaut/dth-character-studio/commit/73157f8f71a50ae4a982463669c7117d192228cf) Thanks [@polynaut](https://github.com/polynaut)! - The Daz installation cards now say what to do with them. They only changed on
  hover, so two correctly-detected installations read as a status display and the
  paths below stayed empty — the click that fills them was never asked for.

  Each installation that isn't active now carries a visible **Activate** button,
  and while none is active the section says so in a line: _"Pick the installation
  your Daz paths should come from — they are filled in and saved the moment you
  do."_

- [#725](https://github.com/polynaut/dth-character-studio/pull/725) [`8216631`](https://github.com/polynaut/dth-character-studio/commit/8216631f24a49a773a7dce3ee5b09f466e96d07a) Thanks [@polynaut](https://github.com/polynaut)! - With a Daz installation activated, **Setup DTH Release** and **Setup DTH
  Exporter Plugin** no longer repeat its paths. The library and Studio folder were
  still echoed there read-only — the same values the Daz installation card already
  lists, shown a second time where they could only ever agree, in the shape of a
  field with nothing left to choose.

  Each install now states its destination in one line above its buttons —
  _"Installs into `D:/DAZ 3D/My DAZ 3D Library`, from the Daz installation
  above"_ — which is the part that genuinely belongs next to a Dry run / Install.
  Without an activated installation both sections keep the editable fields
  unchanged.

- [#727](https://github.com/polynaut/dth-character-studio/pull/727) [`1189f4c`](https://github.com/polynaut/dth-character-studio/commit/1189f4c570cdb158ba665b70547baca418557e01) Thanks [@polynaut](https://github.com/polynaut)! - Settings → Project: **Houdini path style** moves to the bottom of the tab, and
  the **DAZ Install Manager manifests folder** moves up under the **Enable Daz
  Products** toggle it belongs to. The manifests folder is what that scan resolves
  product names from, so the two now read as one setting instead of being split by
  an unrelated dropdown — and the path style, the only setting on the tab that
  changes what generation _writes_, sits last behind its own rule.

- [#723](https://github.com/polynaut/dth-character-studio/pull/723) [`006962b`](https://github.com/polynaut/dth-character-studio/commit/006962b3654c8c57d8d95705856ac46fd07f5cbf) Thanks [@polynaut](https://github.com/polynaut)! - Internal: the 36 event handlers that handed a promise to a prop typed
  `() => void` now say `void` out loud. Every sink was checked first — React's
  `onClick`, `BulkDeleteDialog.onConfirm`, `useFileDrop.onDrop`, the Tools section
  props, `setTimeout` — and none of them awaits, so each edit is runtime-identical
  and the discard is now visible instead of implied. No behaviour change.

## 0.66.0

### Minor Changes

- [#682](https://github.com/polynaut/dth-character-studio/pull/682) [`bd62ed5`](https://github.com/polynaut/dth-character-studio/commit/bd62ed51dc032390e0f4a7765e864100a2217025) Thanks [@polynaut](https://github.com/polynaut)! - Generate project hands over a **wired** network: the import file paths
  (`.dth`, FBX, Alembic, ROM FBX), the PoseAsset **CSV path**, the **export
  directory** and the **Skinning method** are prefilled for the primary scene —
  `$HIP`-relative by default, absolute when the project opted out of junctions —
  and the character name is set with them (prefilled paths may bypass the HDA's
  auto-fill). Parameters your installed DazToHue doesn't have yet are skipped
  one by one (the CSV path needs the release with the CSV-driven PoseAsset
  node); prefilling can never fail a generation.

- [#715](https://github.com/polynaut/dth-character-studio/pull/715) [`ce08aad`](https://github.com/polynaut/dth-character-studio/commit/ce08aad4c04f6a6c2eadebf9d148fc14ff3452a5) Thanks [@polynaut](https://github.com/polynaut)! - Houdini Utils → Defaults gains **Fill network**: the wiring Generate project
  gives a new project, offered to the projects you already have. It fills the
  DazToHue import file paths and export directory — and the PoseAsset CSV path
  once your DazToHue version has one — with the same values, `$HIP`-relative per
  the project's path style. Only **blank** parameters are written, so anything you
  set by hand is listed as already-set and left alone, and a parameter your
  installed DazToHue doesn't carry is **named** rather than silently skipped: the
  row tells you why the CSV path isn't offered yet, and the same action starts
  filling it the day a release adds it. Dry run and rolling backup as usual.

### Patch Changes

- [#713](https://github.com/polynaut/dth-character-studio/pull/713) [`ec95f9c`](https://github.com/polynaut/dth-character-studio/commit/ec95f9c0adbe5634ad00a28b1b48f77d9a657726) Thanks [@polynaut](https://github.com/polynaut)! - The material transfer now refuses a target built from a different figure instead
  of merely noting it. A material setup only transfers within one Genesis version,
  and the studio checks that without any generation knowledge: the Daz surfaces
  your selected materials claim are matched against the ones the target actually
  has. Some unclaimed is normal — the source wears a dress this character doesn't
  — but when none match, the two nodes describe different figures and Transfer is
  disabled with the target named, because the copied slots would name surfaces
  that aren't there and every baker would bake nothing. A node with no material
  slots yet is never blocked: there is nothing to contradict, and seeding one from
  a template is what the drawer is for.

## 0.65.0

### Minor Changes

- [#706](https://github.com/polynaut/dth-character-studio/pull/706) [`79ed8ce`](https://github.com/polynaut/dth-character-studio/commit/79ed8ce6e76cdaf574ae9b78dec124383c2b935a) Thanks [@polynaut](https://github.com/polynaut)! - Houdini Utils gains a **Defaults** tab: per-project Houdini settings shown with
  their current value beside what the studio expects. `$JOB` is saved inside each
  `.hip`, so v0.64's fix reached only newly generated projects — every project
  that already existed still points it at `houdini/houdini-project`, which sits
  below the exports, so picking an export by hand keeps writing an absolute path.
  **Repair $JOB** is that migration: it repoints only the projects that differ, at
  the character folder, with a dry run and the same rolling
  `backup/<name>_dthbak.hiplc` the transfer takes. It fixes paths you pick from
  now on — references already stored absolute are untouched. `$HIP` is reported
  rather than rewritten, since that would mean moving your scene file.

- [#709](https://github.com/polynaut/dth-character-studio/pull/709) [`ca0662e`](https://github.com/polynaut/dth-character-studio/commit/ca0662e49e19229cd695912a8d8078f0ba16723a) Thanks [@polynaut](https://github.com/polynaut)! - Houdini Utils → Defaults gains **Make paths portable**, the other half of the
  `$JOB` story: repairing `$JOB` fixes the paths you pick from now on, this fixes
  the ones already stored. It rewrites every absolute reference sitting under
  `$HIP`, `$JOB` or `$DAZ3D_LIB` to be relative to that variable (131 texture
  paths on a real project), and rebuilds a DazToHue import path that points at a
  file which isn't there — pre-v0.63 projects address their `.dth` through the
  retired `dth-exports` junction, so it dangles while the `.fbx` beside it is
  fine. The replacement is derived from that same node's other export files and
  only written when the file actually exists, so nothing is guessed. Paths under
  none of those roots can't be made portable and are reported rather than
  silently left. The button stays disabled until `$JOB` is correct, because a
  path is made relative to whatever `$JOB` the scene currently carries. Dry run
  and rolling backup as usual.

### Patch Changes

- [#697](https://github.com/polynaut/dth-character-studio/pull/697) [`6e448a3`](https://github.com/polynaut/dth-character-studio/commit/6e448a3b77b337cd1168ad42986b1185b028827b) Thanks [@polynaut](https://github.com/polynaut)! - Guide: document the Utils drawer properly, and split Custom morphs onto its own page

  The drawer shipped with 120 lines of prose and no images — including a
  hand-typed ASCII stand-in for the material list. It now carries two generated
  screenshots (the whole drawer, and the Materials list with its per-slot cost),
  which the smoke fake can produce because it answers `run_houdini_material_util`
  from seeded scan data.

  Three prose corrections against what the code actually does now: scans are
  served from an mtime cache, so "opening a `.hip` takes a few seconds per file"
  only holds for the first read (and for a file a transfer just rewrote); a
  parameter linked to another node arrives as its **value**, since a
  `ch("…/DazToHueMaterial/…")` reference would silently rebind to the target
  project's own node; and the Source row accepts a dropped `.hip` and lists the
  project's Houdini templates.

  `04-first-character.md` had grown to 581 lines. Custom morphs (pose rows,
  combining morphs, bone scale, section/group tools, finding an internal Daz name)
  moves to `custom-morphs.md` — 04 drops to 370 lines and keeps a pointer. The
  in-app "Open guide" link beside **Parameter name** follows the section to its
  new page, so it lands on the anchor instead of a page that no longer has it.

- [#703](https://github.com/polynaut/dth-character-studio/pull/703) [`8eb0506`](https://github.com/polynaut/dth-character-studio/commit/8eb0506047c144d49fab175b41777f6c279f1922) Thanks [@polynaut](https://github.com/polynaut)! - Generated Houdini projects set `$JOB` to the character folder, so picked paths stay relative

  Houdini only collapses a chosen path to a variable when it sits under `$HIP` or
  `$JOB`. `$JOB` was the shared `houdini/houdini-project` folder — _below_ the
  exports — so picking an export through its real location wrote an **absolute**
  path and the project stopped being movable. The retired `dth-exports` junctions
  had been hiding that by making exports look like they were below `$HIP`.

  `$JOB` is now the character folder, which contains both `houdini/` and the Daz
  export root, so the same pick yields `$JOB/daz3d/dth-exports/…`. Paths inside the
  houdini folder still collapse to `$HIP`. New projects only — existing ones keep
  the old value baked into the `.hip`.

- [#704](https://github.com/polynaut/dth-character-studio/pull/704) [`f4ead67`](https://github.com/polynaut/dth-character-studio/commit/f4ead67fc366b8625bac8aa61e4602dfdbff7bd9) Thanks [@polynaut](https://github.com/polynaut)! - Houdini Utils: material slots now merge **by surface** instead of being replaced
  wholesale or appended by name. A Daz surface can belong to only one material
  slot, so copying a `Skin` that merges fifteen surfaces removes exactly the
  fifteen slots at the target claiming those surfaces and leaves the clothing and
  eye slots untouched — where "Replace at target" previously reduced a 25-slot
  node to 1, and appending left the same surfaces claimed twice. A slot claiming a
  mix of taken and untaken surfaces keeps the ones nothing else claims. The
  confirm dialog now lists what will be replaced at each target before you run,
  the report names it afterwards, and both warn when the copied materials claim
  surfaces that exist on no slot at the target — the sign that the two nodes
  describe different figures. The replace switch now covers UV channels and
  texture bakers only.

- [#703](https://github.com/polynaut/dth-character-studio/pull/703) [`8eb0506`](https://github.com/polynaut/dth-character-studio/commit/8eb0506047c144d49fab175b41777f6c279f1922) Thanks [@polynaut](https://github.com/polynaut)! - Utils: a copied parameter never carries a reference to the source project's nodes

  The DazToHue HDA's own **Linking** feature rewrites a node's parameters to
  `ch("<source>/<parm>")` so it mirrors another node. Copying _from_ a linked node
  used to carry those expressions across files — and because DTH names every node
  identically between projects, such a reference silently **rebinds** to the target
  project's own node and reads wrong values without erroring.

  Export now flattens any node-referencing expression to its evaluated value.
  Expressions with no node reference still travel as expressions.

- [#703](https://github.com/polynaut/dth-character-studio/pull/703) [`8eb0506`](https://github.com/polynaut/dth-character-studio/commit/8eb0506047c144d49fab175b41777f6c279f1922) Thanks [@polynaut](https://github.com/polynaut)! - Utils scans are cached by mtime, and CI fails on new lint warnings

  Opening a `.hip` costs tens of seconds and the drawer is built for repeated use,
  so scans are now served from a path + mtime cache — when every requested project
  is unchanged the call returns without starting hython at all. A transfer rewrites
  its target, so the next scan re-reads exactly that file and leaves its neighbours
  cached.

  The repo's advisory lint warnings are deliberate (see `.oxlintrc.json`), but at
  that volume a _new_ one was invisible. `pnpm lint:budget` now pins the count per
  rule and CI fails when a rule grows.

- [#708](https://github.com/polynaut/dth-character-studio/pull/708) [`6d92d94`](https://github.com/polynaut/dth-character-studio/commit/6d92d94ba2473e571c59cfb7a589112e5a454cf5) Thanks [@polynaut](https://github.com/polynaut)! - A scene morph scan no longer files the entire stock figure under the scene when
  the machine has no base index for that generation. The scan reports what a scene
  _adds_ by subtracting the base index, so with nothing to subtract every stock
  Genesis dial was landing in that scene's index — and since every ROM/export run
  scans its scene, a plain export on a machine that had never built the base index
  hit this silently, drowning the Parameter-name autocomplete with nothing saying
  why. It now stops instead: Tools says to build **Base morphs** first, and an
  export logs the skip without failing the row. Nothing is lost by waiting — a
  later scan replaces a scene's contribution wholesale, so the first run after the
  base index exists files it correctly.

- [#703](https://github.com/polynaut/dth-character-studio/pull/703) [`8eb0506`](https://github.com/polynaut/dth-character-studio/commit/8eb0506047c144d49fab175b41777f6c279f1922) Thanks [@polynaut](https://github.com/polynaut)! - Utils: refuse a material transfer whose bakers would lose their UV source, and close the dialog when a run succeeds

  Unticking **UV channels** while a material whose bakers read `uv_geoshell` is
  selected produced a copy that cannot work — those bakers land pointing at a UV
  name nothing at the target creates. Transfer is now disabled for that
  combination, with the reason shown beside the checkbox that causes it.

  The confirm dialog also closes itself after a successful real run; a failure
  keeps it open with its error, and a run that succeeded with warnings says so in
  the toast.

## 0.64.0

### Minor Changes

- [#690](https://github.com/polynaut/dth-character-studio/pull/690) [`fdbc310`](https://github.com/polynaut/dth-character-studio/commit/fdbc31045e924e23ea6ecfec3029755e2b319538) Thanks [@polynaut](https://github.com/polynaut)! - Houdini card **Utils**: copy a DazToHueMaterial node's setup between projects

  A skin material is easily 4 bakers of 30 layers — each naming a texture, a group,
  a blend mode and seven adjustments — on top of the slots merging fifteen Daz
  surfaces into one `Skin`. Reusing it on a new character meant rebuilding all of
  it by hand. The 🔧 on a Houdini project card now opens a drawer that copies that
  setup from one material node onto any number of this character's nodes: source
  from another studio character or any `.hip` via Browse, append or **Replace at
  target**, with a dry run that writes nothing.

  The unit you pick is a **material** — the drawer lists the source's slots with
  what each costs by hand (`MI_Skin` 15 surfaces · 4 bakers · 30 layers) and copies
  the slot together with the bakers naming it. A Genesis 9 skin merges the same
  surfaces on every character of that generation, so it transfers as-is; clothing
  transfers when the target wears the same asset.

  **What to copy** then picks which parts travel — material slots, UV channels,
  texture bakers — all on by default, because a baker names its material
  (`MI_Skin`) and its layers name UV sources as plain text, so bakers alone import
  cleanly and bake nothing. Untick a part and the report names exactly what is then
  missing. A material is flagged **needs UV channels** when its bakers read a UV
  only a channel produces (a skin reads `uv_geoshell`; clothing reads only
  `uv_original`, which every DTH import has) — so the answer to "do I need the UV
  channels too?" is shown rather than guessed. On append, material slots merge by
  name, so a skin setup copied onto a dressed character keeps its clothing
  materials.

  Material nodes are labelled by the **network box** around them when there is one
  (`KiraDefault`, `KiraYoga`, `KiraNaked`) instead of `DazToHueMaterial`, `…1`,
  `…2` — boxes stay optional, and an unboxed network just shows the node name.

  **Portable texture paths** (on by default) rewrites the absolute Daz-library
  paths in texture layers to `$DAZ3D_LIB/…` — the variable the studio already wires
  into every configured `houdini.env` — so a copied setup survives the library
  moving or opening on a machine where it sits on another drive. Textures outside
  the library can't be made portable, stay absolute, and are named in the report.

  Each written project is saved once, after a rolling `backup/<name>_dthbak.hiplc`.

- [#691](https://github.com/polynaut/dth-character-studio/pull/691) [`e4fbe79`](https://github.com/polynaut/dth-character-studio/commit/e4fbe79cc080ed5d866da4db2fffb5ce50557645) Thanks [@polynaut](https://github.com/polynaut)! - Utils drawer: a **Skeleton** tab that transfers a DazToHueSkeleton setup

  The skeleton node carries as much hand-work as the material one — measured on a
  real project: 22 bone renames, 10 reparents, 3 deletes, breast/glute physics-bone
  offsets and two skin-weight operations — and because Daz bone names are fixed per
  generation, the whole block transfers between characters of that generation.

  Sections are the node's own three tabs (General, Skeleton, Skin Weights), so they
  read here the way they read in Houdini. Each is copied **wholesale**: a
  configuration block is not a list you append to, since adding 22 renames onto 22
  existing ones would make 44 rules rather than a merged setup — so the skeleton
  tab has no append mode, and no texture paths to make portable.

  One scan serves both tabs. Opening a `.hip` costs tens of seconds, so switching
  tab must not pay it again.

- [#691](https://github.com/polynaut/dth-character-studio/pull/691) [`e4fbe79`](https://github.com/polynaut/dth-character-studio/commit/e4fbe79cc080ed5d866da4db2fffb5ce50557645) Thanks [@polynaut](https://github.com/polynaut)! - Attachments can hold **Houdini templates**, and the Utils drawer copies from them

  A template `.hip` — the skeleton setup you always use, the skin + texture-baker
  setup you always use — now lives in the project beside its characters, with a
  name and a description. The Utils drawer's **Source** section lists this
  project's templates by name, so reusing a setup no longer starts with locating a
  file.

  Attachments gained a `kind` (`daz-scene` | `houdini-project`); registries written
  before this read unchanged, since every one of them held Daz scenes. A Houdini
  template is **always linked, never copied** — enforced in the api, not just
  hidden in the form — because moving a Houdini project safely needs every
  reference relative AND its `$JOB` folder travelling with it, and neither can be
  verified from the studio.

  The Utils side panel is also retitled: it now says which kind of thing it acts on
  (**Houdini project utils**, with the project it was opened from) rather than just
  the character name.

## 0.63.1

## 0.63.0

### Minor Changes

- [#683](https://github.com/polynaut/dth-character-studio/pull/683) [`5b334df`](https://github.com/polynaut/dth-character-studio/commit/5b334df8c3f34ccb7baeb0c267e8b924a6cd3fa6) Thanks [@polynaut](https://github.com/polynaut)! - **The export-junction feature is gone** — generated reference paths are plain
  relative now. PoseAsset CSVs (and Generate-project prefills) write
  `$HIP/../<daz folder>/dth-exports/…` whenever every linked `.hip` sits in the
  character's houdini folder, absolute otherwise; projects stay fully moveable,
  and no reparse points ever land in your tree again (Perforce, gitignore and
  backup tooling see plain folders). The per-project **Create dth-exports
  shortcuts** toggle and the first-Generate-project intro are removed — the
  **Houdini path style** choice (relative / absolute) stays in Settings →
  Project. Every generation now sweeps leftover junctions from earlier versions
  (strictly reparse-point-safe — a real folder is never touched), and Tools →
  Refresh assets reports what it removed.

## 0.62.2

## 0.62.1

### Patch Changes

- [#671](https://github.com/polynaut/dth-character-studio/pull/671) [`6aaff15`](https://github.com/polynaut/dth-character-studio/commit/6aaff15dcf28b4649d8a41c5c440f79914c054cc) Thanks [@polynaut](https://github.com/polynaut)! - The DTH Export dialog's Houdini project cards now wear the same orange look
  as the linked-project card on the character page — orange tint and border
  instead of the Daz rows' green, with a matching orange ring when checked.

## 0.62.0

### Minor Changes

- [#668](https://github.com/polynaut/dth-character-studio/pull/668) [`c323df8`](https://github.com/polynaut/dth-character-studio/commit/c323df84ff28b398455a1209c8ab6cc163242b8b) Thanks [@polynaut](https://github.com/polynaut)! - The DTH Export dialog is **one page** now — and it drives Houdini on its own.
  **Daz scenes** and **Houdini projects** are two card lists with checkboxes,
  each with its own **Mode**. The Daz modes are the familiar three plus **Skip
  Daz — use last exports**: nothing runs in Daz, the selected projects work off
  each scene's last delivered export (scenes without one are named and kept out
  of the run). The Houdini modes are **Open only** (exactly one project),
  **Export selected scenes** (the default) and **Export all**; several selected
  projects export one after another, and the projects come pre-selected
  whenever scenes do — a plain Start does the whole round trip, Daz through
  Houdini. ROM only is the exception: it builds no fresh export, so nothing
  pre-selects there and a hand-picked project can only be opened. The "Export
  too" switch and the mode cards are gone; their jobs moved into the lists.

  Houdini also opens **fully before the batch starts** now — for "Export too"
  runs as well. The exports used to grind inside Houdini's startup, holding the
  window back until the last node finished; the batch now waits for the UI plus
  a few seconds for the viewport to finish its first cook, so you watch the
  export against a rendered character instead of staring at nothing.

  And the run reporting keeps up with runs that outlast your attention span:
  the progress buttons carry a **live clock** and the app's mark for whichever
  side is working ("Exporting 1/3 · 4m 12s" with the Daz logo, the Houdini one
  for its leg), and the finish report is **one summary at the very end** of the
  whole process — the Daz leg, every Houdini project's result and the total
  time — sticky on screen until you close it (or a new run supersedes it, or
  you leave the page) instead of vanishing on a timer while you're away.

### Patch Changes

- [#667](https://github.com/polynaut/dth-character-studio/pull/667) [`4524572`](https://github.com/polynaut/dth-character-studio/commit/45245728a1f34de51dde8992bf0b8c67b15bb0f6) Thanks [@polynaut](https://github.com/polynaut)! - The character page's header portrait steps back down to a calmer size —
  168×224 at rest (was 208×277), with the collapsed sticky tile shrinking in
  proportion. The scroll collapse, the crisp 1:1 rendering and the header
  alignment all scale along untouched.

## 0.61.0

### Minor Changes

- [#664](https://github.com/polynaut/dth-character-studio/pull/664) [`42abaae`](https://github.com/polynaut/dth-character-studio/commit/42abaaef9a7bde88ff76e2e4c09f810868b572ae) Thanks [@polynaut](https://github.com/polynaut)! - The `dth-exports` junction and `$HIP` paths are explained up front and decided
  per project. The **first Generate project** in a project now explains, right in
  the dialog, the two things it is about to set up — the `dth-exports` shortcut
  (an NTFS junction some source-control setups dislike) and `$HIP`-relative
  reference-skeleton paths — with a link to the extended guide, and asks how this
  project wants them.

  Both answers are saved as **project settings** (Settings → Project), editable
  anytime: _Create dth-exports shortcuts_ and _Houdini path style_. With
  shortcuts off, none are created or repaired and absolute paths are forced —
  the tree stays free of reparse points for Perforce and junction-hostile backup
  tools. The path style moved from the app-wide Settings page to the project,
  where it always belonged.

  The guide's junction notes grew into a proper chapter with copy-paste ignore
  rules for Git and Perforce (including the P4 caveat that ignores only apply on
  add).

- [#660](https://github.com/polynaut/dth-character-studio/pull/660) [`592d769`](https://github.com/polynaut/dth-character-studio/commit/592d7691a10862bd83f63c1ae377fc88bd3d11c0) Thanks [@polynaut](https://github.com/polynaut)! - The morph index now keeps itself up to date. Every ROM/export run scans the
  scene it just verified, so the **Parameter name** autocomplete knows what a
  scene wears without anyone remembering to run Tools → Scan project — the index
  stays current through normal use alone. When the project has **Daz Products**
  enabled, the same run also refreshes that scene's product scan.

  Both scans happen right after the wrong-scene guard and before the ROM build,
  where the scene is still exactly as you saved it, and both are best-effort: a
  scan that can't run (an unsaved scene, no DIM folder) is logged in Daz and
  never fails an export that otherwise succeeded. Runs whose open file is a saved
  ROM animation still file their finds under the source scene.

  Tools → Scan project stays for the bulk pass — a fresh project, or after
  installing new morph packs.

- [#657](https://github.com/polynaut/dth-character-studio/pull/657) [`bf8ee35`](https://github.com/polynaut/dth-character-studio/commit/bf8ee35293168f7e83f172d7641ac2a69679c909) Thanks [@polynaut](https://github.com/polynaut)! - Morph autocomplete now knows what each Daz scene actually wears, and a new
  Tools → **Scan & index → Scan project** runs the whole lot in one go.

  The morph index gained a second mode: alongside the stock-figure scan, the
  studio can scan a **specific Daz scene** for the dials that index doesn't carry
  — fitted clothing, hair, third-party geografts and add-ons — and files each
  find under the scene it came from. The **Parameter name** autocomplete then
  scopes those suggestions to the scene you have selected: two outfits in two
  scenes no longer both offer their "Expand All", only the one actually in that
  scene does (marked with a _this scene_ badge). Morphs the base figure carries
  are always offered, and re-scanning a scene replaces what it contributed, so
  clothing you took off stops being suggested.

  **Tools → Scan & index → Scan project** is the one-click way to run it: tick
  _base morphs_, _character morphs_ and/or _products_, press Start, and wait. The
  studio hands Daz Studio a single unattended batch — the base index first, then
  every linked scene of every character in the project — opening each scene once
  however many scans it is due for.

  Since each scene is a full Daz open, the scene passes come with a **scene
  picker**: expand _Scenes to scan_ to run just one outfit (or one character)
  instead of the whole project, with the job count updating as you pick.

  This replaces the separate **Build Genesis Index** panel, which is now the
  _base morphs_ tick. Reached from the Home window with no project open, the two
  scene passes are disabled and the base rebuild runs on its own, exactly as that
  button did.

### Patch Changes

- [#659](https://github.com/polynaut/dth-character-studio/pull/659) [`f5ce2e4`](https://github.com/polynaut/dth-character-studio/commit/f5ce2e43a96ac7f4cded4fa62822ade13e9bbe31) Thanks [@polynaut](https://github.com/polynaut)! - Fixes DTH Export batches losing every scene's problems but the last one.

  A batch runs one row per Daz scene and each row's script wrote the same
  per-character run log, truncating it — so after exporting three scenes, the
  studio only ever showed the problems of whichever scene ran last. Failures in
  the earlier scenes were destroyed silently, and there was nothing in the log
  saying which scene a failure came from.

  The log now keeps one entry **per scene**. The problem report groups failures
  under the scene that produced them, and clicking one **switches to that scene**
  before jumping to the frame. The red row markers in the ROM sections are scoped
  to the selected scene too — that was an outright wrong-row bug, since a scene
  override can reorder, insert and delete ROM frames, so frame 40 in one scene is
  a different pose than frame 40 in another.

  Logs written by an older runtime still report as before.

- [#665](https://github.com/polynaut/dth-character-studio/pull/665) [`fcf236d`](https://github.com/polynaut/dth-character-studio/commit/fcf236def2c8f8eb74c526afbad82281b33dba3c) Thanks [@polynaut](https://github.com/polynaut)! - Two review follow-ups on the v0.61 features. The scene morph scan now skips
  cameras and lights **anywhere** in the scene, not only at the root — one
  parented into a figure or prop (a light rig, a camera mount) slipped past the
  old guard and offered its focal length and intensity dials as morph
  suggestions (runtime v56; Tools → Refresh assets or the next export picks it
  up). And the first-Generate-project intro seeds its **$HIP paths** choice from
  the old app-wide "Houdini path style" setting: anyone who had deliberately
  switched it to absolute finds the intro pre-set that way instead of silently
  flipped back to $HIP.

## 0.60.0

## 0.59.0

### Minor Changes

- [#637](https://github.com/polynaut/dth-character-studio/pull/637) [`2dc246b`](https://github.com/polynaut/dth-character-studio/commit/2dc246b341663d8c2c745a5bc11df1f770a2da69) Thanks [@polynaut](https://github.com/polynaut)! - **"Export too" — the Daz batch now carries on into Houdini.** Pick a linked
  Houdini project under _Open Houdini project after export_ in the DTH Export
  dialog and a new **Export too** switch appears beside it. Leave it on and the
  project doesn't just open when the batch finishes — it runs its own **DazToHue
  exports** for the scenes you ticked, which was the last step you still had to do
  by hand, per network, every time.

  The button keeps reporting: **Houdini opening…** while the scene loads, then
  **Houdini 1/3** as nodes finish, then the outcome (_"2 exported, 1 skipped"_).
  Houdini stays open with the project ready to work in.

  It is off by default — it drives your Houdini, so you opt in — and it is
  deliberately careful with the project: only the networks importing the selected
  scenes run (one holding other characters' networks is untouched), an
  `export_directory` you configured is never overwritten (only a blank one is
  filled from the run), and the `.hip` is never saved. If the DazToHue pre-flight
  check raises problems, its _"Continue anyway?"_ prompt is answered for you and
  the message is **kept**, so it reaches the report instead of vanishing behind an
  unattended dialog.

  Needs the Houdini installation folder and a matching Houdini documents folder in
  Settings — the same pair _Generate project_ already requires.

## 0.58.0

### Minor Changes

- [#635](https://github.com/polynaut/dth-character-studio/pull/635) [`fff047c`](https://github.com/polynaut/dth-character-studio/commit/fff047ca3645a27de2aee1573338c3c5953af7d1) Thanks [@polynaut](https://github.com/polynaut)! - feat: an elevated window says so in its title bar

  Running as administrator now shows `Administrator: ` at the front of the window title, the same convention Windows itself uses for an elevated terminal — a prefix rather than a suffix, so it survives the truncation in the taskbar and Alt-Tab.

  It's easy to lose track of which session you're in, and an elevated one behaves differently in ways nothing else reveals: mapped network drives are per-session, so an elevated relaunch can't see your drive letters, and anything it creates ends up owned by the elevated account. Every window is marked — the launcher, each project window, and a window that reverts to the launcher after its project is deleted.

## 0.57.0

### Minor Changes

- [#625](https://github.com/polynaut/dth-character-studio/pull/625) [`07d1d8d`](https://github.com/polynaut/dth-character-studio/commit/07d1d8d8c4aa1a863ceebe4ec566dda9338aecc9) Thanks [@polynaut](https://github.com/polynaut)! - feat: the export directory is fixed, and Houdini reaches it through a shortcut

  Exports no longer live inside the Houdini project. A Houdini project folder is something you back up, sync or put in version control, and `.abc`/`.dth` files are large and fully regenerable — so they move to the Daz side and Houdini gets a link to them:

  - **The export directory is derived, not chosen**: always `<character>/<daz subfolder>/dth-exports`, created with the character and shown read-only on the character page. Existing characters migrate on their next save (Tools → Refresh assets does the lot) — and their **already-exported files move with them**, so nothing is stranded at the old location. Only the folders the studio recorded as its own are moved, never the whole old directory (which for the default layout was the character's Houdini folder, `.hiplc` files and all).
  - **One shared Houdini project folder** per character, fixed name `houdini-project`. The first generated project creates it, every later one reuses it, so all of a character's `.hiplc` files open with the same `$JOB`. Removing a generated project now deletes only its scene file.
  - **A `dth-exports` junction** inside that folder points at the real export root, so Houdini's file picker — which opens at `$JOB` — lists the exports instead of making you climb two levels out. It needs no admin rights, and it is a convenience only: nothing in the export pipeline resolves through it, so deleting it (or a tool like Perforce doing so) costs nothing but the shortcut, and the next Generate project restores it.

  Consequently the **Houdini project folder** field and its per-scene override are gone (schema v29), exports are flat again under the export directory, and deleting a character with _Keep Daz files_ no longer silently retains gigabytes of exports. Runtime v47 — Refresh assets regenerates the scripts.

## 0.56.1

## 0.56.0

## 0.55.0

## 0.54.0

## 0.53.0

### Patch Changes

- [#597](https://github.com/polynaut/dth-character-studio/pull/597) [`97e9a5d`](https://github.com/polynaut/dth-character-studio/commit/97e9a5d432381037a59b60c01d4efbd5de0b31f8) Thanks [@polynaut](https://github.com/polynaut)! - fix(release): authenticate the build-time Runner fetch. The release build stages the latest Runner DLLs via the GitHub API; unauthenticated calls share the hosted runner IP pool's rate limit and can 403 the whole build (hit on the v0.52.0 mac job). The build steps now pass `GITHUB_TOKEN` to the fetch script, which already knew how to use it.

## 0.52.0

## 0.51.2

### Patch Changes

- [#591](https://github.com/polynaut/dth-character-studio/pull/591) [`2ab11bd`](https://github.com/polynaut/dth-character-studio/commit/2ab11bd2d135210ffe24c850cc8191a2113ed4b3) Thanks [@polynaut](https://github.com/polynaut)! - fix(desktop): bundle the first **loadable** DTH Character Studio Runner (v1.0.3). v0.51.1 shipped with Runner v1.0.0, which Daz Studio refused to load — the SDK's Windows plugin macro exports C++-mangled entry points while Daz resolves plain C names, and the DLL was built against an SDK newer than released Studios (Daz rejects plugin SDK > studio build). Both are fixed in the Runner repo (v1.0.3: `extern "C"` entry points, built against the oldest supported 6.25 SDK); this release just re-bundles. If Settings → Install DTH Character Studio Runner Plugin previously installed v1.0.0 for you, install again after updating — the panel will show the bundled version differs.

## 0.51.1

### Patch Changes

- [#589](https://github.com/polynaut/dth-character-studio/pull/589) [`dd31bb0`](https://github.com/polynaut/dth-character-studio/commit/dd31bb0afed52bbf2d265b0661507912ace11db2) Thanks [@polynaut](https://github.com/polynaut)! - fix(release): the Runner-DLL fetch step broke the release build — `beforeBuildCommand` runs from `apps/desktop`, where the root `fetch:runner` script isn't visible (`pnpm -w` now), and the fetch script's skip path crashed Node on Windows via `process.exit()` with undici handles still open. No user-facing change; this re-cuts the release that v0.51.0 failed to build.

## 0.51.0

### Minor Changes

- [#584](https://github.com/polynaut/dth-character-studio/pull/584) [`88e47ac`](https://github.com/polynaut/dth-character-studio/commit/88e47ac55e81ec54a1960cf4a5e30753b3bd7ac8) Thanks [@polynaut](https://github.com/polynaut)! - feat(web,desktop,rom): **DTH Export** in the character editor header — hand the ROM+export runs to the DTH Exporter Plugin. The button opens a scene-picker dialog listing every linked Daz scene as a checkable card; scenes whose `.duf` or definition inputs changed since their last handoff come pre-checked (first run: all), and a per-row wand solos one scene. Confirming writes a `dth_exporter_jobs.csv` (one ROM-script row per scene) into the `Scripts/DTH-Character-Studio` root and starts a scene-less Daz Studio when it isn't running (new `launch_daz_studio` command); the plugin polls for the file (startup + regularly — a running Daz accepts new batches in place), deletes it as the transfer ack, and works through the rows (contract: `docs/exporter-plugin-job-file.md`). While the job file is still waiting for Daz, the button shows **Abort** — clicking deletes the file (and re-flags the aborted scenes as changed) and returns to DTH Export.

  Runtime v38: generated scripts understand the **`bulk-export` script argument** the plugin passes on job runs — with it, the ROM script always exports (export block embedded even with "Run the export with the ROM script" off, hair pass past a disabled "Export hair assets"); a manual run keeps honoring the toggles. Also: InfoPopups now work inside modal dialogs — opening a Modal/SidePanel closes any open popup, and the popup layer moved above the dialogs.

  The app now **ships the DTH Character Studio Runner plugin** (our own Daz plugin implementing the job-file contract, [polynaut/dth-character-studio-runner](https://github.com/polynaut/dth-character-studio-runner)): its DLLs are fetched from that repo's latest release at build time and bundled as app resources, and the new **Settings → Install DTH Character Studio Runner Plugin** panel installs the right DLL (Daz Studio 4 vs 6, detected from the install folder's DAZStudio exe) into `<Daz install>/plugins` — no folder picking, with dry run, up-to-date detection and the usual install report.

- [#583](https://github.com/polynaut/dth-character-studio/pull/583) [`58803cc`](https://github.com/polynaut/dth-character-studio/commit/58803ccb811b7d4fa544114d73e8f86cafdc1a36) Thanks [@polynaut](https://github.com/polynaut)! - feat(web,desktop): project **Operations** tab with a danger zone. Its one action, **Delete**, permanently removes the whole project after a confirm: the project folder (characters, scenes, generated files, notes), the project's generated Daz-script folder in the Daz library, its app-data product scans, and its Recents entry. A file open in Daz Studio / Houdini aborts the delete before anything is touched. Afterwards the window continues as a Home window (new `release_project_window` command unpins it).

## 0.50.1

### Patch Changes

- [#581](https://github.com/polynaut/dth-character-studio/pull/581) [`bfa86c6`](https://github.com/polynaut/dth-character-studio/commit/bfa86c6e0b2375b647347336a3fcea804dc1081c) Thanks [@polynaut](https://github.com/polynaut)! - Republish the installers and the updater feed. The previous release assets were removed during
  repository maintenance, which left `releases/latest/download/latest.json` returning 404 and no
  downloadable build available. This release restores both the download and the auto-update paths.

  Also lifts the bulk-selection pill clear of the Unreal-projects footer on the project overview —
  it was sitting flush on the footer's top edge with no gap — and carries the docs-site screenshot
  refresh and the phone-lightbox rotation fix.

## 0.50.0

## 0.49.0

## 0.48.3

## 0.48.2

## 0.48.1

## 0.48.0

### Patch Changes

- [#541](https://github.com/polynaut/dth-character-studio/pull/541) [`b24289c`](https://github.com/polynaut/dth-character-studio/commit/b24289c8bbe6e7bec4ea13ccd5babd15c47218ba) Thanks [@dependabot](https://github.com/apps/dependabot)! - The desktop crate's zip handling moves to zip 8 (from 4). The dedup/install
  pipeline's behavior is unchanged — zip-slip refusal, unreadable-entry
  hard-errors and ZipCrypto detection are all pinned by the crate's tests, which
  pass against the new major.

## 0.47.0

## 0.46.2

## 0.46.1

## 0.46.0

### Minor Changes

- [#530](https://github.com/polynaut/dth-character-studio/pull/530) [`d8f1d6a`](https://github.com/polynaut/dth-character-studio/commit/d8f1d6a78b244b79b906b682c0ed7b1514c4dd52) Thanks [@polynaut](https://github.com/polynaut)! - Adding another Daz scene to a character now pauses on a Validation table
  (styled like the Refresh-assets version table) that checks the picked scene
  before it links: same Genesis generation as the character, exactly one
  character in the scene, an empty animation timeline (the generated ROM script
  fills the timeline itself), and the same genital geograft (Golden Palace /
  Dicktator) as the primary scene — the closest checkable proxy for "same
  gender". Different hair, clothing and props stay untouched: outfit variants
  are what extra scenes are for. A failed check blocks the add behind an
  explicit "Add anyway" switch; a scene the studio can't read degrades to
  "unchecked" and never blocks. The native `scene_wearables` read now also
  reports every figure root and the timeline occupancy to power the checks, and
  a scene already inside the character folder gets the same dialog (it used to
  link silently).

### Patch Changes

- [#533](https://github.com/polynaut/dth-character-studio/pull/533) [`965d543`](https://github.com/polynaut/dth-character-studio/commit/965d54307971fced26285579f696b2e65c2ca3c3) Thanks [@polynaut](https://github.com/polynaut)! - Dialog polish: all modals are roomier (the shared Modal default grew from
  28rem to 36rem — full file paths and the Validation table no longer wrap or
  cramp), the Validation table's permanent hint paragraph is gone — a FAILED
  check row now explains itself on hover instead (what the check demands and
  why), the create dialog's read-only Gender moved to its own row so it no
  longer sits between two real selects looking like a broken one, and the
  override handles (the small cube) on the editor's field labels only render
  while a non-primary scene is selected — with the primary selected there is
  nothing to override. The Unreal project cards were reworked too: the card
  body is inert (only the explicit open/install buttons act), and the path
  line is now a real path chip (click = copy, Alt+click = Explorer) that
  middle-ellipsizes long paths — at most 8 leading characters once truncation
  kicks in, so the full .uproject file name keeps the budget. The avatar tile
  background darkened from [#565963](https://github.com/polynaut/dth-character-studio/issues/565963) to [#262626](https://github.com/polynaut/dth-character-studio/issues/262626) (Daz renders the .tip.png
  previews against a dark viewport — the light tile washed them out), the
  header shrink animation's border shades follow, and every small avatar
  preview now wears the same #2d2d2d border as the main header avatar.
  Existing avatar masters are flattened onto the OLD colour — run Tools →
  Refresh assets with Ctrl held once to re-derive them onto the new tile.

- [#532](https://github.com/polynaut/dth-character-studio/pull/532) [`320341d`](https://github.com/polynaut/dth-character-studio/commit/320341d283e2a285e3cb57657079f1f7b8ffdecf) Thanks [@polynaut](https://github.com/polynaut)! - The "Empty timeline" scene check no longer trips over stray product keys.
  Wearables routinely leave a few animation keys on their own bones (e.g. the JM
  Nipple graft keys frames 0–7 in every scene it's used in), which read as "8
  frames of animation" on a scene whose timeline is actually untouched. The
  native scene read now counts only channels that really change value AND don't
  belong to a fitted wearable's node chain — real hand-animation on the
  character still fails the check.

## 0.45.7

### Patch Changes

- [#520](https://github.com/polynaut/dth-character-studio/pull/520) [`6466d65`](https://github.com/polynaut/dth-character-studio/commit/6466d6500489bc3673e8c5c3edc0e3d3b91ad19f) Thanks [@polynaut](https://github.com/polynaut)! - The character header portrait no longer softens or aliases at rest. Two fixes: it
  rested at `scale: 1.55`, so the browser rasterised it at its small layout size and
  GPU-upscaled that texture — it's now laid out at the painted size and rests at
  `scale: 1` (the zoom-on-scroll rescaled to match, so both framings are unchanged);
  and the 768px master is now served **pre-downscaled** to the exact painted size ×
  the screen DPR via a Rust `image`-crate **Lanczos3** pass (`downscale_avatar_png`),
  so the webview paints it 1:1 with no aliasing-prone GPU resampling — the Lanczos
  low-pass anti-aliases the xBRZ'd master's hard edges. Avatars are also now
  flattened onto the tile background (`[#565963](https://github.com/polynaut/dth-character-studio/issues/565963)`, the only colour they're shown on)
  BEFORE upscaling, so the tip's transparent edge is a smooth figure→bg gradient
  rather than a discontinuity that magnifiers jag; and the xBRZ step now
  **supersamples** — it magnifies ~2× past the master size and lands on 768 via the
  Lanczos down-step (256 tip: ×6 → 1536 → 768), so xBRZ's hard stair-step edges are
  averaged into proper anti-aliasing instead of being stored as-is. Masters can now be re-derived
  from their pristine 256² source at any time via **Ctrl + Refresh assets** (Tools):
  a scene avatar reads its scene's `.tip.png` (a Daz scene is always its
  .duf + .duf.png + .tip.png triple, so the tip is guaranteed at the scene's path);
  an upload keeps its original as a **`.src` sibling** beside the master (pruned in
  tandem) — before, the in-place upscale destroyed the user's original upload.

## 0.45.6

## 0.45.5

### Patch Changes

- [#491](https://github.com/polynaut/dth-character-studio/pull/491) [`235cd39`](https://github.com/polynaut/dth-character-studio/commit/235cd395ce0d1e48fa6dd59be6a865c3bc735bba) Thanks [@polynaut](https://github.com/polynaut)! - The **create-character dialog now auto-selects Genesis (and gender) from the picked Daz scene's contents** instead of guessing from its filename. Choosing or dropping a scene reads its base figure node (`Genesis9`, `Genesis8_1Female`, …) — which names both the generation and, for Genesis 8 / 8.1 / 3, the gender — and preselects the matching fields. A bare character scene (just the figure, no hair/clothes) is detected the same way. Both fields stay fully editable, so an unrecognized (e.g. renamed) figure just leaves the current selection in place.

  The native `scene_wearables` command now also returns the scene's base `figure` node alongside its conformed items; the old filename-based generation guess is removed.

- [#504](https://github.com/polynaut/dth-character-studio/pull/504) [`09b333f`](https://github.com/polynaut/dth-character-studio/commit/09b333fb70ecce746057baf0134ee2e22d3e4f26) Thanks [@polynaut](https://github.com/polynaut)! - **Fix "fs.copy_file not allowed" when copying a Daz scene into a character** — the whole-file scene copy moved onto the fs plugin's `copyFile` (audit PR [#435](https://github.com/polynaut/dth-character-studio/issues/435)) but the desktop capability that authorizes it was never added, so every copy/move of an external scene (and the one-time projects migration, which also copies) failed at runtime with a permissions error. Grants `fs:allow-copy-file` with the same `**` scope as the sibling fs write permissions in `capabilities/default.json`.

- [#503](https://github.com/polynaut/dth-character-studio/pull/503) [`4a4e4a4`](https://github.com/polynaut/dth-character-studio/commit/4a4e4a424603769ff2550196283c5ff924461c0e) Thanks [@polynaut](https://github.com/polynaut)! - Refresh assets can now reset character files saved by a newer build. If a definition was written by a newer version of the app (its schema is ahead of yours), this build refuses to open it. Refresh assets now lists those files separately and offers a one-click "Reset to v<current>" that re-saves them at this build's schema — dropping any fields the newer version added. The read-error notice on the project page links straight to it.

## 0.45.4

## 0.45.3

### Patch Changes

- [#441](https://github.com/polynaut/dth-character-studio/pull/441) [`0792e99`](https://github.com/polynaut/dth-character-studio/commit/0792e99d8a47b099bcdf976359db08eefe1f44ce) Thanks [@polynaut](https://github.com/polynaut)! - Third full-codebase audit pass: a case-only character rename no longer deletes the just-written PoseAsset CSV, moving the scenes folder regenerates the scripts that embed scene paths, and the dedup report now marks the same keeper the install actually picks; menu actions hit only the focused window, the housekeeping sweep gained the same deletion rails as every other delete path, installs no longer hold every nested-zip inflation on disk at once, and saves stopped re-walking the library and rewriting the runtime scripts every time; clearing a pose-value cell reverts instead of committing 0, tab switches no longer trip a false unsaved-changes prompt, typing during a notes media drop is preserved, labels and errors are properly wired for assistive tech, Escape in a multi-select no longer closes the surrounding dialog, and a failed macOS build now blocks a release instead of silently shipping Windows-only. A follow-up self-audit of these fixes also made the forced Tools → Refresh genuinely repair deleted or corrupted runtime scripts, let archives containing unsafe-named entries install their safe subset with an accurate message, and taught the dedup conflict view the installer's exact tie-breaking.

- [#438](https://github.com/polynaut/dth-character-studio/pull/438) [`38a7687`](https://github.com/polynaut/dth-character-studio/commit/38a76877937c074f5ab6e5aadaaf4668845105b3) Thanks [@polynaut](https://github.com/polynaut)! - Second full-codebase audit pass: the asset dedup now refuses duplicate-listed or nested source folders (previously it could quarantine the only real copy), quarantining a folder junction moves the link instead of copying its target, and zip installs refuse partial inventories; saves that persist but fail to regenerate scripts no longer report unsaved changes or roll back your edits, renaming inline can no longer race a running save, edits typed during a slow scene copy survive, case-only renames of character folders work on Windows, and notes autosave no longer rescans the whole library per pause; clearing a number field reverts instead of committing 0, the Tools page reconciles settings across windows like Settings does, mirrored pose groups now flip stock Daz `_L`/`l_` side markers, and the physics block length is validated against the PoseAsset template.

- [#445](https://github.com/polynaut/dth-character-studio/pull/445) [`364625a`](https://github.com/polynaut/dth-character-studio/commit/364625a9a4cdc4836120cd9499a457f8dba3ec0f) Thanks [@polynaut](https://github.com/polynaut)! - Audit tail closeout: edits typed while moving the scenes folder can no longer write a dead custom-asset path back to disk, one Refresh click now repairs a corrupted runtime install even when characters are also stale, the dedup conflict marker orders tied paths exactly like the installer (component-wise, not string-wise), "Clean up now" reports files it couldn't delete instead of claiming there was nothing to do, the missing-pinned-release warning updates right after any save, and two keyboard edge cases are fixed: an IME-cancel Escape no longer closes a surrounding dialog, and Shift+Tabbing out of a pinned info popup no longer dismisses it.

- [#451](https://github.com/polynaut/dth-character-studio/pull/451) [`9515a2a`](https://github.com/polynaut/dth-character-studio/commit/9515a2acca31ee1ec6ce1afe495fe9f1c2b89cab) Thanks [@polynaut](https://github.com/polynaut)! - Folder moves now share one robust helper. Before any move, the app checks whether a file under the folder is open in Daz Studio or Houdini; if so, it shows a dialog — "some files are still open, close all Daz Studio and Houdini instances and press Continue" — listing the blocked files, with Continue (retry) and Cancel, instead of a half-finished move. The character page's folder chip gains an inline edit-to-move (the same move as Advanced options → Storage location), and abort actions (move Cancel, the export-directory Clear) now use a red "ghost" button so they read as undo/abort.

- [#435](https://github.com/polynaut/dth-character-studio/pull/435) [`1c53147`](https://github.com/polynaut/dth-character-studio/commit/1c531470f82d5f4e2f7faad4f52d93af1dfe44b5) Thanks [@polynaut](https://github.com/polynaut)! - Full-codebase hardening pass: every file write is now atomic and newer-version character files are reported instead of silently stripped; dedup honors "keep this copy" across same-named duplicates, reports every failed quarantine move, and handles Windows case differences; linking scenes/Houdini projects/avatars validates and regenerates artifacts exactly like Save; dialogs, side panels and the morph autocomplete are fully keyboard-accessible; and Refresh, installs, pose measurement and heavy editor screens are significantly faster.

- [#449](https://github.com/polynaut/dth-character-studio/pull/449) [`61ebf5b`](https://github.com/polynaut/dth-character-studio/commit/61ebf5b8ed28536e03e6a5426fa13ab66e07361c) Thanks [@polynaut](https://github.com/polynaut)! - Renaming a project now renames its `.dcsp` file to match (it previously kept the old filename), and any open window for that project is live-re-titled to the new name — so the native title bar, the `.dcsp` filename, and the in-app name all stay in sync without closing and reopening the window.

## 0.45.2

### Patch Changes

- [#415](https://github.com/polynaut/dth-character-studio/pull/415) [`d575b9d`](https://github.com/polynaut/dth-character-studio/commit/d575b9dd39a5a665c36736fc2b19e090f2e00ab8) Thanks [@polynaut](https://github.com/polynaut)! - Fixes from a full codebase audit — mostly data-loss and correctness bugs in the character editor and project handling:

  - **Moving a character folder** now keeps every linked path intact. Previously only the primary Daz scene followed the move — extra outfit scenes, grooms, ROM scene-overrides and the avatar-source scene were orphaned, and the next save wrote those dead paths permanently.
  - **Moving the Daz scenes folder** no longer silently discards unsaved ROM edits (and no longer slips past the "unsaved changes" prompt).
  - **Edits typed while a save is in progress** are preserved instead of being reverted when the save finishes.
  - **Inline rename** now runs the same validation as Save, so it can't persist or regenerate an invalid character.
  - **Case-only renames** (e.g. `kira` → `Kira`) no longer fork the folder to `Kira (2)` or delete the freshly generated scripts.
  - **Importing a morph CSV** into an empty FBM/MISC section no longer drops that section's scene-override frames.
  - A **corrupt project file** (`.dcsp`) now surfaces an error instead of silently resetting the project's settings on the next save.
  - **Dedup** never destroys a downloaded asset: when quarantining across drives, a copy that succeeds is kept even if clearing the original partly fails.
  - Projects **opened by double-clicking a `.dcsp`** now appear in Recents.
  - Note attachments: only safe media/document types open from the app (a `.dsa` attachment can no longer run in Daz).
  - Assorted UI fixes: the Tools "Refresh assets" menu item switches tabs reliably, the Settings release/exporter spinner no longer sticks, bulk-delete refreshes the list on a partial failure, discarding edits asks first, and duplicate scene/Houdini/Unreal links are de-duplicated case-insensitively.
  - Performance: measured `.duf` frame counts and avatars are cached, and the character-library scan skips the app's own large media folders — noticeably faster on projects with many characters or on a network share.

## 0.45.1

## 0.45.0

## 0.44.11

## 0.44.10

## 0.44.9

### Patch Changes

- [#396](https://github.com/polynaut/dth-character-studio/pull/396) [`80c8353`](https://github.com/polynaut/dth-character-studio/commit/80c83532ca3667a926334fbbcfe9cac303e22c70) Thanks [@polynaut](https://github.com/polynaut)! - Dependency refresh: Tauri 2.11.5 and zip 4 in the desktop shell, TypeScript 7 in the toolchain, and updated CI actions.

## 0.44.8

## 0.44.7

## 0.44.6

### Patch Changes

- [#367](https://github.com/polynaut/dth-character-studio/pull/367) [`25ece9c`](https://github.com/polynaut/dth-character-studio/commit/25ece9c03719414da272a230be4e8cd9403ca1d8) Thanks [@polynaut](https://github.com/polynaut)! - Actually fix "forbidden path" on macOS/Linux project creation. The Tauri fs plugin defaults `requireLiteralLeadingDot` to true on Unix, so the `**` scope glob refuses to match hidden dot-folders like `.dcsmeta` — creating a project's `.dcsmeta/images` failed. Set `plugins.fs.requireLiteralLeadingDot: false` in tauri.conf.json (Windows was never affected — it defaults to false there). This supersedes the 0.44.5 `/**` scope attempt, which addressed the wrong cause.

  macOS release builds are now Apple Silicon (arm64) only, which roughly halves the mac build time (Intel Macs are no longer supported). The release also caches Cargo's downloaded crate sources (checksum-verified, never compiled artifacts) so the signed build stays a cold, reproducible compile.

## 0.44.5

### Patch Changes

- [#365](https://github.com/polynaut/dth-character-studio/pull/365) [`ed0e9a3`](https://github.com/polynaut/dth-character-studio/commit/ed0e9a3dc3efc75fe20d9788804856681abb080a) Thanks [@polynaut](https://github.com/polynaut)! - New dark macOS app icon — the logo now sits on a slate rounded background instead of a light one, so it reads cleanly in the Dock in both light and dark mode. The Windows icon is unchanged.

- [#365](https://github.com/polynaut/dth-character-studio/pull/365) [`ed0e9a3`](https://github.com/polynaut/dth-character-studio/commit/ed0e9a3dc3efc75fe20d9788804856681abb080a) Thanks [@polynaut](https://github.com/polynaut)! - Fix "forbidden path" when creating a project — or any new nested folder — on macOS/Linux. Tauri's fs plugin scope-checks a not-yet-existing path as a raw string, and the `**` scope glob doesn't match a POSIX absolute path's leading `/`, so creating `.dcsmeta/images` (and other new nested paths) failed on the macOS build. A `/**` scope now covers absolute Unix paths; Windows is unaffected.

## 0.44.4

### Patch Changes

- [#363](https://github.com/polynaut/dth-character-studio/pull/363) [`cc109bf`](https://github.com/polynaut/dth-character-studio/commit/cc109bf101c0d28ae730ce1d3b85a8c1e3451d7a) Thanks [@polynaut](https://github.com/polynaut)! - DTH Character Studio is now also built and published for **macOS** — a universal (Intel + Apple Silicon) `.dmg` / `.app`, Developer-ID-signed and Apple-notarized, published alongside the Windows installer. The auto-updater serves the matching platform from the same `latest.json`. (The Daz DTH Exporter Plugin is still Windows-only, so the far side of the pipeline continues to need Windows.)

## 0.44.3

### Patch Changes

- [#349](https://github.com/polynaut/dth-character-studio/pull/349) [`200d6bd`](https://github.com/polynaut/dth-character-studio/commit/200d6bd7254d91a97271af9c5f4f1e8fb870423c) Thanks [@polynaut](https://github.com/polynaut)! - Desktop robustness: every I/O-heavy native command now runs off the main thread (`#[tauri::command(async)]`), so large asset installs, dedup scans and network `.duf` walks no longer freeze the window. Also: asset installs skip directory junctions instead of following them (a junction cycle could previously loop forever while copying), nested asset zips share their outer archive's decompression budget instead of minting fresh allowances, a failed quarantine move cleans up its partial copy, GitHub release lookups time out after 10s instead of hanging, closed windows drop their project mapping, Home-window creation no longer races itself, and the New Project menu item builds its window off the main thread like every other window path.

- [#350](https://github.com/polynaut/dth-character-studio/pull/350) [`0348765`](https://github.com/polynaut/dth-character-studio/commit/0348765bd88b4c64f5708a3f70a8f83e67140dc7) Thanks [@polynaut](https://github.com/polynaut)! - The network-drive remap result (`ensure_network_drives`) now goes through the FFI contract regime like every other structured return: zod-parsed at the invoke boundary (no more bare `invoke<T>()` cast) and pinned by a shared `contracts/remap-results.json` fixture tested on both the serde and zod side. The phantom `'unsupported'` status that no Rust path ever produced is gone from both sides. Remap failures for Explorer "reconnect at sign-in" mappings (Windows errors 1201/1202) now get actionable messages instead of a bare error number, and very long UNC paths no longer misreport as "unmapped".

## 0.44.2

## 0.44.1

## 0.44.0

## 0.43.1

## 0.43.0

## 0.42.6

## 0.42.5

## 0.42.4

### Patch Changes

- [#330](https://github.com/polynaut/dth-character-studio/pull/330) [`0b0805f`](https://github.com/polynaut/dth-character-studio/commit/0b0805f2af9127432643bd695272035d4165bdca) Thanks [@polynaut](https://github.com/polynaut)! - Two editor fixes: the sticky header's scroll-in "Back" link no longer shows up immediately on the Notes tab (on a page too short to scroll the scroll timeline is inactive, so the link fell back to its visible base state — it now defaults to hidden, and the run-error hint gets the same guard), and the "Modify JCM frames" header is no longer a button wrapping the info popup's button (invalid HTML that React flagged and assistive tech misreads). Under the hood, the Rust↔TS boundary is now pinned by shared contract fixtures — serde round-trips and the api layer's zod schemas validate the same JSON on both sides, and the frame-measurement result is parsed at the boundary instead of blindly cast.

## 0.42.3

## 0.42.2

## 0.42.1

### Patch Changes

- [#318](https://github.com/polynaut/dth-character-studio/pull/318) [`822ceaf`](https://github.com/polynaut/dth-character-studio/commit/822ceafafb2d9b12a8a97383a4676bdfd04c7651) Thanks [@polynaut](https://github.com/polynaut)! - Settings grew an "App Data" tab (app data folder + storage housekeeping, moved out of General/Tools), the Project tab leads in project windows, network drives got their own pane at the bottom of General, and the import picker's rows expand to a copyable path chip instead of a tooltip. Tooltips app-wide now wrap long paths correctly. The "Empty quarantine" button is gone — the dedup quarantine is a plain folder you manage yourself in Explorer.

## 0.42.0

## 0.41.42

## 0.41.41

## 0.41.40

## 0.41.39

## 0.41.38

## 0.41.37

## 0.41.36

## 0.41.35

## 0.41.34

## 0.41.33

## 0.41.32

## 0.41.31

## 0.41.30

## 0.41.29

## 0.41.28

## 0.41.27

## 0.41.26

## 0.41.25

## 0.41.24

## 0.41.23

## 0.41.22

## 0.41.21

## 0.41.20

## 0.41.19

### Patch Changes

- [#252](https://github.com/polynaut/dth-character-studio/pull/252) [`45ec4d4`](https://github.com/polynaut/dth-character-studio/commit/45ec4d4ee707dcd73aba47ec59468241a6567ad5) Thanks [@polynaut](https://github.com/polynaut)! - Bring the target app to the foreground after "Open in …". Opening a scene in an
  already-running Daz Studio (or a Houdini `.hip` / Unreal `.uproject`) loaded it
  behind the studio window; the studio now focuses the app's window afterwards. It's
  best-effort and Windows-only — a no-op when the app isn't running yet (a fresh
  launch focuses itself) or on other platforms.

## 0.41.18

## 0.41.17

### Patch Changes

- [#245](https://github.com/polynaut/dth-character-studio/pull/245) [`b8a4296`](https://github.com/polynaut/dth-character-studio/commit/b8a4296dcebb3a0f53890ab16a5f282d4b643c1b) Thanks [@polynaut](https://github.com/polynaut)! - Enable the WebView2 inspector (right-click → Inspect, F12) in installed/release
  builds, not just dev — this is a self-hosted tool and it helps debug the shipped
  app against a live Daz Studio.

  Make "Open in Daz" observable when a running Daz doesn't react: the bridge script
  now reports a failed open with a message box (so it's no longer silent — and if
  no box appears at all, the running instance never executed the forwarded script),
  and the web side logs which Daz executable it launched to the console.

## 0.41.16

### Patch Changes

- [#242](https://github.com/polynaut/dth-character-studio/pull/242) [`0de21ad`](https://github.com/polynaut/dth-character-studio/commit/0de21ada2f04dd02f7583fa5fc3eaac80431fc6b) Thanks [@polynaut](https://github.com/polynaut)! - Show the native menu bar (Main / Help) on every window. Only the startup "main"
  window received the app menu; project windows and any extra Home windows opened at
  runtime came up with no menu bar. Each runtime window now builds and sets the same
  menu itself, so New Project / Refresh assets / About / Check for Updates are
  reachable from any window.

## 0.41.15

### Patch Changes

- [#240](https://github.com/polynaut/dth-character-studio/pull/240) [`0a66525`](https://github.com/polynaut/dth-character-studio/commit/0a66525d07d155dea9e04e1f996d4e2817a1f750) Thanks [@polynaut](https://github.com/polynaut)! - Fix "Open in Daz" launching the scene-open bridge script in a text editor instead
  of Daz Studio. Opening a scene while Daz is already running writes a one-shot
  `.dsa` and previously shell-opened it, which follows the OS file association — on
  machines where `.dsa` is bound to an editor (e.g. VS Code on a dev box) the script
  just opened as text and the scene never loaded. The bridge now launches the
  running Daz instance's own executable with the script as its argument
  (association-independent), and only falls back to the shell-open if the executable
  can't be located.

## 0.41.14

### Patch Changes

- [#238](https://github.com/polynaut/dth-character-studio/pull/238) [`5df102a`](https://github.com/polynaut/dth-character-studio/commit/5df102a20ba8f1cd8a74a3f42829ed105eef2a33) Thanks [@polynaut](https://github.com/polynaut)! - Block saving a character while a custom section has empty required fields (a pose
  with no name, no morph, or an empty morph name), and jump straight to the problem:
  the offending section opens, its pose row scrolls into view and the first empty
  field is focused. A toast names the first error (or the count when there are
  several).

## 0.41.13

## 0.41.12

## 0.41.11

## 0.41.10

## 0.41.9

## 0.41.8

## 0.41.7

## 0.41.6

## 0.41.5

### Patch Changes

- [#211](https://github.com/polynaut/dth-character-studio/pull/211) [`7b3b101`](https://github.com/polynaut/dth-character-studio/commit/7b3b101d0d490fb3cc941509b0d3f881c94ea374) Thanks [@polynaut](https://github.com/polynaut)! - Pressing Alt while hovering a reveal target (path chip, Daz/Houdini/Unreal
  card) no longer arms the native menu bar — the key is treated as the
  show-in-Explorer modifier there. Alt anywhere else keeps its normal menu
  behavior.

## 0.41.4

### Patch Changes

- [#209](https://github.com/polynaut/dth-character-studio/pull/209) [`4df5164`](https://github.com/polynaut/dth-character-studio/commit/4df5164c8d82d8f9b960272df4d182d4b55e7ec0) Thanks [@polynaut](https://github.com/polynaut)! - The character page's Back links are truly gray now (the global link color was
  overriding them), and holding Alt over a Daz scene / Houdini / Unreal card
  swaps its open icon for a folder icon — previewing the show-in-Explorer click,
  same as the path chips. The Daz scenes / Houdini chips dim everything through
  the character folder, so only the actual subfolder reads bright.

  The reveal hotkey moved from Shift+click to **Alt+click** everywhere (chips and
  cards) — Shift+click was selecting text along the way.

## 0.41.3

### Patch Changes

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - Back navigation aligned: every back link is simply "Back", always orange —
  and the character page's sticky header grows its own Back link that fades in
  as you scroll, so navigating back never requires scrolling up first. The
  Unreal bar's empty-state button is just "+ Link" now.

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - G8.1 characters no longer show the "experimental" tag when the standard
  DQS + JCM/FAC preset setup matches — regardless of which DTH release is
  active. G8.1 CSVs target the old-Houdini pipeline's HDA and the G8.1 assets
  are identical across releases, so the validated 188-frame template applies
  either way.

- [#207](https://github.com/polynaut/dth-character-studio/pull/207) [`2d3e0c0`](https://github.com/polynaut/dth-character-studio/commit/2d3e0c060a740a2e306e37331def93553081f02b) Thanks [@polynaut](https://github.com/polynaut)! - Notes render as markdown by default — the Write/Preview tabs are gone. A small
  pencil appears when hovering the notes (an empty note is fully clickable) to
  switch into the editor; Done or Escape returns to the rendered view.

## 0.41.2

### Patch Changes

- [#205](https://github.com/polynaut/dth-character-studio/pull/205) [`cb72bf3`](https://github.com/polynaut/dth-character-studio/commit/cb72bf3ec92d0f0d46e0590d14ae85e6529201c8) Thanks [@polynaut](https://github.com/polynaut)! - The Unreal card's install button keeps it short — tooltip is just "Install DTH
  Content" — and holding Ctrl lights the dimmed button back up on already-
  bootstrapped projects, hinting that a click now re-installs. Path chips
  preview their alternate action too: holding Shift swaps the hover copy icon
  for an open-folder icon.

## 0.41.1

### Patch Changes

- [#203](https://github.com/polynaut/dth-character-studio/pull/203) [`69d0105`](https://github.com/polynaut/dth-character-studio/commit/69d01052a02439ba34ebed68e99c4eb418ddd838) Thanks [@polynaut](https://github.com/polynaut)! - Shift+click "show in Explorer" now also works on the Daz scene cards and the
  Houdini project cards — the one hotkey everywhere: plain click opens the file
  in its app, Shift+click reveals its folder.

## 0.41.0

### Minor Changes

- [#200](https://github.com/polynaut/dth-character-studio/pull/200) [`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f) Thanks [@polynaut](https://github.com/polynaut)! - "Modify JCM frames" — a proper grid UI in the JCM section for bone-rotation
  morph drives (formerly a raw JSON array buried in Advanced Options). Add rules
  (bone + rotation axis) and per-rule morph drives with angle→value ranges split
  by rotation direction; the Morph name field autocompletes from the scanned
  morph index. The old JSON textarea is gone.

- [#200](https://github.com/polynaut/dth-character-studio/pull/200) [`00912f4`](https://github.com/polynaut/dth-character-studio/commit/00912f4e02bda8aa62a2e0ab2d67f3961362970f) Thanks [@polynaut](https://github.com/polynaut)! - Unreal project cards grew up: bigger cards (name + folder) in the footer bar,
  each with a tiny install button that bootstraps the Unreal project with DTH —
  one click copies the linked DTH release's Unreal Engine content into the
  project's `Content/DazToHue`, making a fresh Unreal project DTH-ready in an
  instant. The button dims once the content exists; Ctrl+click always installs
  (overwrite from the currently selected release — files are copied over, never
  deleted first). Unreal linking + content syncing is now in the getting-started
  guide.

### Patch Changes

- [#201](https://github.com/polynaut/dth-character-studio/pull/201) [`635ce6f`](https://github.com/polynaut/dth-character-studio/commit/635ce6f3fff7f57b86f9a3873bb8fee7192ba1aa) Thanks [@polynaut](https://github.com/polynaut)! - Unreal cards now correctly detect installed DTH content (the check always read
  "missing" for normal Windows paths, leaving the install button hot on projects
  that already had `Content/DazToHue` — it re-checks natively now). And
  Shift+click is the app-wide "show in Explorer" hotkey: on an Unreal card it
  opens the project's folder, on any path chip it replaces the old Ctrl+click.
  The chips' hover tooltip is gone — the behaviors are documented in the guide.

## 0.40.0

### Minor Changes

- [#198](https://github.com/polynaut/dth-character-studio/pull/198) [`9fa6c2e`](https://github.com/polynaut/dth-character-studio/commit/9fa6c2e036d401dcfe272e0c877f308252ed6776) Thanks [@polynaut](https://github.com/polynaut)! - Unreal project cards grew up: bigger cards (name + folder) in the footer bar,
  each with a tiny install button that bootstraps the Unreal project with DTH —
  one click copies the linked DTH release's Unreal Engine content into the
  project's `Content/DazToHue`, making a fresh Unreal project DTH-ready in an
  instant. The button dims once the content exists; Ctrl+click always installs
  (overwrite from the currently selected release — files are copied over, never
  deleted first). Unreal linking + content syncing is now in the getting-started
  guide.

## 0.39.0

### Minor Changes

- [#196](https://github.com/polynaut/dth-character-studio/pull/196) [`8702758`](https://github.com/polynaut/dth-character-studio/commit/870275802ebc6f36bf4cdf8b5f45f1cb4fbcc4ae) Thanks [@polynaut](https://github.com/polynaut)! - G8.1 PoseAsset CSVs are validated now — no more "experimental" for the
  standard setup. Ground truth came from a working DTH 1.9.6 PoseAsset node
  (old-Houdini pipeline): a G8.1 character with DQS + JCM/FAC presets and a
  pre-2.0 DTH release selected gets the full 188-frame preset template spliced
  with its custom sections, exactly like G9. The CSV "era" boundary moved to
  DTH 2.0 where the control-row format actually flipped (CTL → CURVE — the G9
  template now correctly requires a 2.0+ release, and releases 2.0–2.4.3 count
  as one era, so switching among them no longer flags characters stale). The
  editor's experimental tag now reflects the real per-configuration validation.

## 0.38.0

### Minor Changes

- [#194](https://github.com/polynaut/dth-character-studio/pull/194) [`98228d1`](https://github.com/polynaut/dth-character-studio/commit/98228d1c66f4498bdb66a782d0e416600f751260) Thanks [@polynaut](https://github.com/polynaut)! - Multiple Houdini installations: Settings can now hold additional Houdini
  documents folders (older/parallel Houdini versions), each with its own Dry
  run/Install pair for the DTH release's Houdini assets. Pick an older release
  in the version dropdown, install it into the old Houdini's folder, switch the
  dropdown back — the old Houdini keeps the old DTH while your primary stays
  current.

- [#193](https://github.com/polynaut/dth-character-studio/pull/193) [`dbdc712`](https://github.com/polynaut/dth-character-studio/commit/dbdc7121ece1a21127abd3457d96769c502e8f0a) Thanks [@polynaut](https://github.com/polynaut)! - Opening a linked Daz scene now works while Daz Studio is already running. Daz
  (DS 6) silently ignores scene files forwarded to a running instance — Explorer
  double-click does nothing either. The studio detects the running instance and
  routes the open through a one-shot script instead, which Daz forwards and
  executes: the scene opens inside the running instance, with Daz's normal
  unsaved-changes prompt. No instance running → unchanged direct open.

## 0.37.0

### Minor Changes

- [#191](https://github.com/polynaut/dth-character-studio/pull/191) [`910f80f`](https://github.com/polynaut/dth-character-studio/commit/910f80f20d8a6e1d7c6614883f5b306e8254cd96) Thanks [@polynaut](https://github.com/polynaut)! - "Run the export with the ROM script" no longer exports when the ROM build had
  ANY problem. Runtime v20: failed morphs count as failure too (not just hard
  aborts), so a ROM with broken frames can never ship a PoseAsset CSV/FBX as if
  it were good — fix the problem and re-run. Regenerate scripts via Tools →
  Refresh assets (or any character save).

### Patch Changes

- [#190](https://github.com/polynaut/dth-character-studio/pull/190) [`2efabc0`](https://github.com/polynaut/dth-character-studio/commit/2efabc06c603eff60fe697c319fa35b072966285) Thanks [@polynaut](https://github.com/polynaut)! - Confirming "Yes" on the unsaved-changes dialog when closing the window now
  actually closes it. Registering a close-requested listener makes Tauri hold
  every close and destroy the window from the JS side afterwards — and that
  destroy call needed a permission the app never granted, so the window
  silently stayed open.

## 0.36.3

### Patch Changes

- [#187](https://github.com/polynaut/dth-character-studio/pull/187) [`c3261bf`](https://github.com/polynaut/dth-character-studio/commit/c3261bfd824987ed2936b72c75d38a563a8bbc55) Thanks [@polynaut](https://github.com/polynaut)! - Hardening: zip extraction is bounded (ratio-based size + entry caps) against decompression bombs; recursive-delete rails run on canonicalized paths; a hostile manifest charactersSubdir can no longer traverse outside the project; character schema strings carry generous size bounds; the app has a styled root error boundary.

- [#188](https://github.com/polynaut/dth-character-studio/pull/188) [`198ea5a`](https://github.com/polynaut/dth-character-studio/commit/198ea5a43a4bb5a626f2999954435d501f83d2b8) Thanks [@polynaut](https://github.com/polynaut)! - Notes integrity: autosave failures surface as a toast, and concurrent edits from a second window are detected instead of silently overwritten (reload option offered). Note media is garbage-collected — unreferenced files are removed after an hour on save, with a 7-day housekeeping backstop — and `.duf` preset decompression is bounded.

- [#185](https://github.com/polynaut/dth-character-studio/pull/185) [`f2eb122`](https://github.com/polynaut/dth-character-studio/commit/f2eb1228e74ccdd73b55a0390745394d7c984827) Thanks [@polynaut](https://github.com/polynaut)! - Internal: split the desktop crate's lib.rs into focused modules (no behavior change).

## 0.36.2

### Patch Changes

- [#179](https://github.com/polynaut/dth-character-studio/pull/179) [`a868c65`](https://github.com/polynaut/dth-character-studio/commit/a868c650705ade11ff970c307debb5adced1f0d9) Thanks [@polynaut](https://github.com/polynaut)! - The slide-in drawers (New project, Create character, …) animate reliably again
  — they used to pop in without the transition when the open raced the first
  paint.

- [#180](https://github.com/polynaut/dth-character-studio/pull/180) [`01d5a0f`](https://github.com/polynaut/dth-character-studio/commit/01d5a0f9de90b2ebaa63b8614bf213312e6be4b3) Thanks [@polynaut](https://github.com/polynaut)! - Linked Unreal projects moved into a footer bar docked to the bottom of the
  project window — always visible, compact chips that open the project in Unreal
  on click (folder in the tooltip, hover ✕ unlinks), with the picker and
  drag-drop linking right on the bar.

## 0.36.1

### Patch Changes

- [#177](https://github.com/polynaut/dth-character-studio/pull/177) [`172029c`](https://github.com/polynaut/dth-character-studio/commit/172029c552f2fe0e6e6ee0f7da70dda9a838714d) Thanks [@polynaut](https://github.com/polynaut)! - Opening linked Unreal projects works now — the desktop shell-open scope only
  allowed `.duf`/`.hip` files (and https links), so clicking an Unreal card,
  Ctrl+clicking a path chip (folder reveal) or opening non-image note media was
  silently refused. The scope now covers `.uproject`, folders, and the common
  image/video/audio/document/3D media formats (executables stay refused), and
  those open actions surface errors as a toast instead of doing nothing.

## 0.36.0

### Minor Changes

- [#172](https://github.com/polynaut/dth-character-studio/pull/172) [`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477) Thanks [@polynaut](https://github.com/polynaut)! - Project & character notes — a markdown editor (Write/Preview) on a new Notes
  tab of both the project page and the character page. Autosaves while you type,
  and dropped images/media files are stored with the project (like avatar
  images, under `.dcsmeta/media`) with the right markdown tag inserted at the
  cursor — images render inline in the preview, other media opens with its
  default app. Notes live as plain `notes.md` / `<Name>.notes.md` files next to
  what they describe, so they back up (and read) like everything else.

- [#171](https://github.com/polynaut/dth-character-studio/pull/171) [`8f96436`](https://github.com/polynaut/dth-character-studio/commit/8f96436a67608dc1115a7add87cfe239d5c21bb3) Thanks [@polynaut](https://github.com/polynaut)! - Link Unreal projects to a studio project. The project page gets an "Unreal
  projects" section above the character list: link one or more `.uproject` files
  (picker or drag-and-drop), shown as prominent cards like the character pages'
  Daz scenes / Houdini projects — clicking a card opens the project in Unreal
  Engine. Links only: files stay where they are, unlinking never deletes.

- [#175](https://github.com/polynaut/dth-character-studio/pull/175) [`0f7db81`](https://github.com/polynaut/dth-character-studio/commit/0f7db818b6675ca6afd515eb7d54254adec7ceec) Thanks [@polynaut](https://github.com/polynaut)! - Unsaved changes are guarded now: navigating away from a character editor (or
  the Settings page) with unsaved edits asks "leave and lose them?" first —
  closing or reloading the window warns too. Deleting the character skips the
  question (there is nothing left to save).

### Patch Changes

- [#172](https://github.com/polynaut/dth-character-studio/pull/172) [`a2accc6`](https://github.com/polynaut/dth-character-studio/commit/a2accc6ae3bd75041a894904789be7e4f54e7477) Thanks [@polynaut](https://github.com/polynaut)! - Path chips: Ctrl+click opens the path directly in the Windows Explorer (a file
  path opens its parent folder) — plain click still copies. And the Settings
  page now hints where a Daz Studio installation is usually found.

- [#173](https://github.com/polynaut/dth-character-studio/pull/173) [`90c52f7`](https://github.com/polynaut/dth-character-studio/commit/90c52f7003c51dd52a83f3c17bea56fd70042239) Thanks [@polynaut](https://github.com/polynaut)! - Morph autocomplete: suggestions now show the Daz UI name on its own labeled
  line ("Daz UI name: …"), never truncated — a match on the UI name (e.g.
  searching "GPL*…" where the internal name is "GP*…") is clearly readable
  instead of looking like a wrong suggestion. The match tag spells it out too
  ("UI name match" / "internal match").

## 0.35.0

### Minor Changes

- [#170](https://github.com/polynaut/dth-character-studio/pull/170) [`14f3ed3`](https://github.com/polynaut/dth-character-studio/commit/14f3ed3c9899cfd732530f7293557a6e05a9df58) Thanks [@polynaut](https://github.com/polynaut)! - The Daz scenes subfolder is now editable on an existing character: the scenes
  folder chip grows a small pencil — editing the subfolder physically moves the
  folder on disk and repoints every linked scene, so nothing breaks. Path chips
  in general now support an optional edit affordance.

- [#169](https://github.com/polynaut/dth-character-studio/pull/169) [`bb695ef`](https://github.com/polynaut/dth-character-studio/commit/bb695efae90d970981a36fd191045a94f3c8a9c8) Thanks [@polynaut](https://github.com/polynaut)! - App-styled tooltips everywhere. Every `title` attribute in the app now shows a
  proper tooltip — rounded, drop-shadowed, on the app's popover surface, smartly
  positioned by Floating UI (flips/shifts at viewport edges) — instead of the
  browser's plain native tooltip. One global host intercepts hover/focus, so all
  existing and future `title=` usage migrates automatically; keyboard focus shows
  the tooltip instantly, and icon-only controls keep an accessible name.

### Patch Changes

- [#167](https://github.com/polynaut/dth-character-studio/pull/167) [`1e1ae08`](https://github.com/polynaut/dth-character-studio/commit/1e1ae082e238f41dbfc2c508809c3340adec18bd) Thanks [@polynaut](https://github.com/polynaut)! - The update dialog now names the installed version as the reference point:
  "Version 0.34.0 is ready to install — you have 0.33.0."

## 0.34.0

### Minor Changes

- [#166](https://github.com/polynaut/dth-character-studio/pull/166) [`f6259cd`](https://github.com/polynaut/dth-character-studio/commit/f6259cdd2261697ec4bf4e2dd82649beadc9371b) Thanks [@polynaut](https://github.com/polynaut)! - Genesis 8 / 8.1 support. Both generations are now selectable for characters;
  everything is driven by what the installed DTH release actually ships per
  generation: G8.1 gets the full JCM (DQS/Linear) + FAC flow, plain G8 is
  Linear-only (no DQS/FAC assets exist), and Golden Palace / Dicktator / Physics
  remain G9-only — enabling a section whose asset doesn't exist for the
  generation fails loud with a clear message. New ROM entries default to the
  generation's base-figure node (Genesis8_1Female, Genesis8Male, …) instead of
  always Genesis9, skinning defaults to Linear where DTH ships no DQS ROM, and
  the runtime (v19) skips the G9-only mouth ROM pass and FACS/flexion strength
  dials on non-G9 figures instead of failing or logging spurious errors. The
  PoseAsset CSV for non-G9 characters uses the measured custom-sections path
  (the G9 ground-truth template stays G9-only for now).

- [#165](https://github.com/polynaut/dth-character-studio/pull/165) [`fd9fdd9`](https://github.com/polynaut/dth-character-studio/commit/fd9fdd927501acca778b606bb259d41655accb71) Thanks [@polynaut](https://github.com/polynaut)! - Morph scanner scripts + Morph-name autocomplete. The runtime install (v18) now
  also drops visible `Scan_Morphs_G9/G8.1/G8/G3` scripts into the DTH Character
  Studio scripts root: run one on a freshly created (unrenamed) figure in Daz and
  it scans everything dialable on the figure and all its descendants — delta
  morphs AND controller/ERC dials, across geografts like Golden Palace /
  Dicktator, nipples/navel add-ons, fitted clothing — into a per-generation
  JSON index in the studio's app folder. Once an index exists, the
  ROM editor's Morph name fields autocomplete against it: search by the Daz UI
  label or the internal name (each suggestion tags which one matched and the node
  the morph lives on), and picking a suggestion fills in both the internal morph
  name and the correct node.

### Patch Changes

- [#162](https://github.com/polynaut/dth-character-studio/pull/162) [`8888219`](https://github.com/polynaut/dth-character-studio/commit/88882194e18a8f366f95ca250c4fb6ab6af87b1d) Thanks [@polynaut](https://github.com/polynaut)! - **Main → New Project opens the create-project panel again.** The menu entry
  focused/opened the Home window but never opened the dialog. Now an
  already-running Home window gets told to open the panel, and a freshly created
  one starts with it open.

## 0.33.0

### Patch Changes

- [#158](https://github.com/polynaut/dth-character-studio/pull/158) [`70b1f54`](https://github.com/polynaut/dth-character-studio/commit/70b1f54fa7c6638274adf34b084e1975b3814212) Thanks [@polynaut](https://github.com/polynaut)! - **The update dialog now shows what you skipped.** When the installed version is
  several releases behind, the dialog still renders the latest release's notes in
  full — and below them lists the in-between releases (newest first, up to 3) as
  links to their GitHub release pages, so the catch-up path is one click away.

## 0.32.3

## 0.32.2

## 0.32.1

### Patch Changes

- [#144](https://github.com/polynaut/dth-character-studio/pull/144) [`37cd0dc`](https://github.com/polynaut/dth-character-studio/commit/37cd0dcd50ddda8e8f9be99a4f234a49120bb1d0) Thanks [@polynaut](https://github.com/polynaut)! - **Webview hardening: strict Content-Security-Policy + asset protocol disabled.**
  The webview previously ran with no CSP and an enabled asset protocol. Now: a
  strict production CSP (`default-src 'self'`, images restricted to inlined `data:`
  URLs, IPC-only network, no frames/objects) with a dev-only relaxation for Vite
  HMR, and the asset protocol is fully disabled — the app inlines all images and
  never used it. Defense-in-depth: an XSS would now be contained by the CSP instead
  of inheriting the webview's full reach.

## 0.32.0

## 0.31.3

## 0.31.2

## 0.31.1

## 0.31.0

### Patch Changes

- [#124](https://github.com/polynaut/dth-character-studio/pull/124) [`fff1b23`](https://github.com/polynaut/dth-character-studio/commit/fff1b236efbc85e37268d2665a9531000266b82c) Thanks [@polynaut](https://github.com/polynaut)! - **Harden the native file operations** (from a full app audit):

  - **Uninstall Daz can no longer wipe your Documents.** The "Prefill" list stopped deriving a delete candidate from the _parent_ of your DAZ library (typically your whole Documents folder) — it now lists the library folder itself. On top of that, `uninstall_daz`, `empty_folder` (quarantine), and the housekeeping sweep now refuse to recursively delete a drive/profile root or a too-shallow path, and the uninstall additionally refuses any folder that isn't Daz-owned ("DAZ" in the path) — so even a corrupt settings value can't trigger a catastrophic delete.
  - **Recursive walks no longer follow symlinks/junctions**, so the housekeeping sweep can't escape its tree to delete files elsewhere and can't loop forever on a junction cycle.
  - **Houdini presets now MERGE** instead of deleting the destination folder first — a mis-named source can't wipe an arbitrary Houdini subfolder, and a mid-copy failure can't leave a half-install.
  - **`houdini.env` is never clobbered** on a read error / non-UTF-8 content (it used to treat an unreadable file as empty and overwrite it).
  - **DazToHue-Scripts install swaps atomically** (old moved aside, restored on failure) instead of delete-then-copy.
  - **Dedup keeper selection fixed**: the Genesis rank read the _last_ number in the folder name, so "\_genesis 9 (2024)" ranked 2024 and the "newer Genesis wins" rule silently inverted — it now reads the first number after "genesis". Name collisions in the quarantine are disambiguated instead of silently leaving a duplicate installed.
  - Window-management commands recover from a poisoned lock, and opening a project holds the window map lock across the whole find→allocate→insert so two racing launches can't map to the wrong window.

## 0.30.0

### Minor Changes

- [#120](https://github.com/polynaut/dth-character-studio/pull/120) [`ce51879`](https://github.com/polynaut/dth-character-studio/commit/ce51879339675f325938d2011c9e422a26eb168b) Thanks [@polynaut](https://github.com/polynaut)! - **Housekeeping: the studio's own generated data can no longer fill your disk.** The two things that used to accumulate unbounded are now managed:

  - **Product-scan files** (the per-Daz-scene CSVs + diagnostics under app-data) **age out after 30 days** — swept automatically on every app launch, and on demand via a new **Tools → Storage & housekeeping → "Clean up now"** button (reports how much it freed). Deleting a character now also removes its scan folder and avatar immediately, so nothing orphans.
  - **The dedup quarantine** (redundant Daz assets you moved aside — a large, reversible backup) is shown with its size in the same section, with an **"Empty quarantine"** button (with a confirm). It's never emptied automatically — you decide when the backup is safe to reclaim.

  Everything else the app writes was already bounded (run logs overwrite, generated artifacts self-prune, temp files self-delete, recents capped). New native commands: `housekeeping_sweep`, `folder_stats`, `empty_folder`.

## 0.29.2

## 0.29.1

## 0.29.0

## 0.28.0

### Minor Changes

- [#106](https://github.com/polynaut/dth-character-studio/pull/106) [`18e6787`](https://github.com/polynaut/dth-character-studio/commit/18e6787b82c74d7291c7164692487490ede09613) Thanks [@polynaut](https://github.com/polynaut)! - **Setup DTH Release** split into two independent installs, each with its own Dry run / Install buttons placed directly under its destination folder field: **Daz content** under "My DAZ 3D Library", **Houdini assets** under "Houdini documents folder". Each half is enabled by its own prerequisites (a resolved DTH release + its destination folder), so you can install only the Daz side or only the Houdini side. The Daz install still re-scans the release's poses on success; the native `install_dth_release` command gained a `target` selector (`daz` / `houdini` / `all`).

## 0.27.0

### Minor Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Add **Daz Products** — an opt-in, per-project scan of which Daz products a character uses. Turn it on in **Settings → Project → Enable Daz Products** (off by default). Each character then gets a generated **`Scan_Products_<Character>.dsa`** alongside its ROM script. Open the character's scene in Daz, run the script, and it analyses the open scene — walking used nodes + non-zero morphs and each node's material texture paths — then matches them to your installed products and writes a CSV the studio reads back.

  Set the **DAZ Install Manager manifests folder** in **Settings → General** (with a one-click **Detect installed location**) so the scan can resolve assets to real product **names, SKUs, artists and versions**; without it the scan still lists the used assets. Back on the character page, enabling the feature splits the editor into **Character** and **Products** tabs (the tabs appear only when Daz Products is on, so the scan never crowds the character form). The **Products** tab surfaces the results — a table of matched products plus an expandable list of unmatched assets (with their source files) — and a **Store on character** action persists them onto the character definition. A **Clear** button (active only while there are scan results to discard) wipes the per-scene CSVs to start fresh, leaving any products already stored on the character untouched. The tab is split into two panels: a **Scan files** panel that always shows which per-scene CSVs back the results — their output folder, and a row per scene with its source `.duf` path, product/unmatched counts and when it was last written — so it's clear what Check / Clear / Store act on and which Daz scene each scan came from; and a separate **Matched products** panel with the listing itself. Once you've stored products, a status banner makes the relationship to the files on disk explicit either way: a green **Up to date** when nothing on disk is newer than your last save, or an amber **scan changed since you last stored** (with the counts — e.g. "11 found now vs 9 stored" — and the save time) when a re-scan has produced new results. The store button follows suit, settling into a disabled **Stored — up to date** instead of an always-active "Update stored products". Each product row **expands** to list the exact scene morph(s)/node(s) that found it (each tagged Morph/Node), so you can see precisely why it's there. Store products (those with a DIM SKU) link out to their **Daz product page**, and scene render-setting singletons (the Tonemapper/Environment "Options" nodes) are excluded so they don't clutter the unmatched list. The **Match** column header carries an info popup explaining each match method (File/Texture, SKU, Keyword, Third-Party, Genesis Base, Parent/Group, Manifest).

  Scans are tracked **per Daz scene**, so a character's outfit/look variants don't overwrite each other. The runtime reads the open scene (`Scene.getFilename()`) and writes one CSV per scene; the studio reads them all and merges, so each product and unmatched asset is tagged with the scene(s) it was found in — a **Scene(s)** column appears once more than one scene has been scanned. When more than one scene has been scanned, a **View** switch ("All scenes" plus one chip per scene) lets you flip between the merged table and a single scene's products; scoping to one scene drops the now-redundant Scene(s) column. Products and unmatched assets are listed **alphabetically**. Open an outfit scene, run the scan, repeat for the next outfit, and the results accumulate with their scene attribution.

  Each matched product shows **what it was used for** in the scene — a heuristic role (Morph, Clothing, Hair, Genitalia, Geograft, Accessory, Figure, …) derived from the assets that matched it, with the specific assets on hover — so you can tell _why_ a product is in the scene. Matching links a used item to its product even when their names share nothing (e.g. a glove node "ACGloves" from "Adventure Outfit"): it reads the node's **material texture paths** — the one file reference Daz exposes for a scene node — across _every_ map channel (diffuse, normal, bump, roughness, metallic, …, not just the base color, so a metal zipper or a procedurally-tinted flower with no diffuse map still matches) and maps their `vendor/product` folder to the product that installed it. A geograft wearing a _copy_ of the figure's body skin (common — the copy-textures workflow) is recognised: the figure's own skin folders are excluded so the geograft isn't mis-identified as the skin product. A texture-folder match is treated as proof the product is genuinely used, so it intentionally bypasses the Genesis prefilter — that's how a G8 outfit auto-fitted onto a G9 figure still matches. An unmatched clothing **sub-part** — a zipper, a flower trim, a dForce layer that loads as its own node parented to the garment — inherits the product its parent matched (a "Parent Match"), provided that parent isn't the base figure, so these stop landing in "unmatched". Sub-parts the scene parents to the _figure_ rather than the garment (so parent-inheritance can't reach them) are caught by a final **"Manifest Match"**: an unmatched node whose name is the basename of a file a product installs (a "Frangipani"/"Zipper" node ↔ `Frangipani.dsf`/`Zipper.dsf`) is attributed to that product — but only to a product _already matched elsewhere in the same scene_, so a generic part name can't pull in an unrelated library product. And a decoration that loads as an empty **group/null node** (no geometry, texture or own file) whose real parts are matched children inherits its children's product (a "Group Match"). Beyond that it is **prefiltered by the character's known Genesis version** (from the studio, not guessed): products for a different generation are rejected and, when several editions of a product are installed (e.g. a G8 _and_ a G9 Golden Palace), the one matching the character's generation wins. It also needs stronger keyword confidence (two distinct shared keywords — a lone generic word like "top" or "inside" can't anchor a match) and pulls in manually-installed (non-DIM) products from `LOCAL_USER_*` metadata so they match instead of landing in "unmatched". As a final resort it **synthesizes products from the content library's `data/<Vendor>/<Product>` folders** ("Content Folder Match"), so content that carries _no_ DIM or `LOCAL_USER` metadata at all — e.g. unofficial products — is still recognised, named by its folder and attributed to its vendor (with the real artist/version read from the content's own files). These run only after the metadata-backed products and are skipped when a real product already owns the folder/name, so they never duplicate or override a properly-tracked product. Products and unmatched assets are enriched with **artist + version read straight from each asset's own `.dsf`/`.duf` metadata** (the vendor's `author` + `revision`), which the DIM install manifests don't carry — content-relative paths are resolved under the library so the real revision surfaces instead of just the DIM build number, and for a matched product a representative file from its file list is read as a fallback. That file list comes from the DIM manifest for store products and from the `LOCAL_USER_*` metadata's own asset list for manual installs — so a manually-installed product like Golden Palace now surfaces its real vendor `author` + `revision` (read from its own `.duf`/`.dsf`) instead of "Unknown". Unmatched assets still show whatever artist/version their files carry.

  Mechanics: a new bundled runtime (`DthProducts.dsa`) is installed once next to the other DTH runtime files; each scan writes a per-scene CSV into an app-local-data folder keyed by project + character id; the character schema gains additive `products` / `productsUnmatched` / `productsScannedAt` fields (each product/asset also carrying the `scenes` it was found in — no migration needed). The runtime version bumped, so **Tools → Refresh assets** regenerates existing characters' scan scripts to the per-scene layout.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - **Tools → DazToHue-Scripts now tracks versions.** Installing records the exact commit it downloaded: the installer resolves the HEAD of `soltude/DazToHue-Scripts` `main`, downloads _that commit's_ tree (so the files always match the recorded SHA), and writes a `.dth-version.json` marker beside them. The tab then shows whether the installed scripts are **up to date** or an **update is available** by comparing that commit against the latest on GitHub — phrased and styled to match the DTH Exporter Plugin status (a green ✓ "Already installed (X) — up to date." line, **Install / Update / Reinstall** button). The check runs when the page opens and degrades to "couldn't check" when offline or rate-limited.

  The DTH Exporter Plugin status in Settings gets the matching treatment too — the same green checkmark on its "Already installed … up to date." line and consistent text sizing across all of its status lines.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Projects are now **`.dcsp` files** ("DTH Character Studio Project") you can scatter anywhere on disk and open by double-clicking.

  - **File association + per-window projects.** The installer registers `.dcsp`; opening one launches (or, if the app is already running, adds) a window pinned to that project. Launching the app directly shows a **Home** launcher — recently opened projects plus **New project** / **Open project…** — and the app menu gains **New Project** (opens Home). Each window works on exactly one project.
  - **Self-contained projects.** A `.dcsp` is a small JSON manifest beside your character folders; per-project meta (avatars) lives next to it in a hidden `.dcsmeta/`. The app-data folder now holds only volatile, machine-specific state (the recent-projects list, machine/tool settings, network drives) — no project registry, no avatars.
  - **Split settings.** Machine/tool paths (DAZ library, Daz install, Houdini docs, DTH release/exporter) stay in **Settings**; per-project behaviour (the Daz/Houdini subfolder names) moved into each project's manifest and is edited from the project page's **Project settings**.
  - **Automatic one-time migration.** On first launch after updating, each previously known project gets a `.dcsp` (seeded from your old settings), its avatars move into the project's `.dcsmeta`, the recents list is built, and the old `projects.json` + app-data `images/` are removed. Unreachable projects are skipped and retried next launch.

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - **Install/scan Daz assets** now looks inside wrapper downloads (a zip holding the real package zip). Some stores ship a product as an outer zip that holds only the license/instructions PDFs, a `.dsx` manifest and the actual DIM package zip (`IM…_Product.zip`) — since the outer archive itself has no `data`/`People`/`Runtime` folders, these downloads reported **"no Daz content"** and never installed. When an archive holds no content folders, the scan/install/dedup now descends into the zips inside it (two levels deep) and resolves the product's content there — so a wrapper download diffs, installs, and dedups exactly like a flat zip of the same content (including the "same files as …" duplicate hint against a flat copy). Content found in the archive itself still wins: a `.zip` that is _part_ of a product's content is installed as a file, not descended into.

### Patch Changes

- [#101](https://github.com/polynaut/dth-character-studio/pull/101) [`38aafd3`](https://github.com/polynaut/dth-character-studio/commit/38aafd3a0e5bfd3a0669b60800e4e6e27f4ec7fc) Thanks [@polynaut](https://github.com/polynaut)! - Fix **Install Daz assets** silently installing only a product's readme. The installer's content-root finder stopped at the first folder level that held _any_ recognised folder — and since `Documentation` counts as a (fallback) metadata folder, a product packaged as a top-level `Documentation/` beside a `My Library/` (or `Content/`) wrapper that holds the real `data`/`Runtime` resolved to the **Documentation folder at the root** and never descended into the wrapper. The result: the install copied the product's `Documentation/…README.pdf` into the library and skipped every morph/texture, so the content looked installed but was missing in Daz (a "Missing Files" prompt when opening a scene that used it).

  Real content folders (`data`/`People`/`Runtime`) found at any depth now take precedence over a `Documentation`-only folder at a shallower level; a Documentation-only level wins only when there's no real content anywhere (so a genuinely docs-only asset still reports as installed). Applies to both folder and `.zip` sources. Re-run **Tools → Optional → Install Daz assets** to install content that previous runs left as readme-only.

## 0.26.1

## 0.26.0

### Minor Changes

- [`46703e1`](https://github.com/polynaut/dth-character-studio/commit/46703e1a2478734fbe2281923eb497e3570b5be5) Thanks [@polynaut](https://github.com/polynaut)! - - **Native app menu** (desktop): **Main → Refresh assets / Exit** and **Help →
  About / Check for Updates**. Check for Updates now reports "you're on the latest
  version" / "not available in dev" when invoked from the menu.
  - **Avatar picker**: in the character image dialog, a row of linked Daz scene
    thumbnails lets you switch the main avatar to any scene's render. Avatars now use
    a content-versioned filename, so changing one live-updates everywhere (dialog,
    header, lists) without a reload.
  - **Tools**: the **DazToHue-Scripts** tab is now first and the default; its Save
    button is gone (it has no settings); a clear error with a **Settings** link shows
    when "My DAZ 3D Library" isn't set; and the intro links to the repo.
  - **About**: a paragraph crediting Soltude's **DazToHue-Scripts** (optional add-on)
    with a link straight to the in-app installer.

## 0.25.0

## 0.24.1

### Patch Changes

- [#85](https://github.com/polynaut/dth-character-studio/pull/85) [`0612d1f`](https://github.com/polynaut/dth-character-studio/commit/0612d1f87b81d39f1d34f17f05f652fd85a668ce) Thanks [@polynaut](https://github.com/polynaut)! - Fix: opening a linked Houdini project failed for `.hiplc` / `.hipnc` files with
  "Scoped command argument … failed regex validation". The shell `open` scope only
  matched `.hip` (anchored at the end), so the indie/non-commercial Houdini
  extensions were rejected. It now accepts `.hip`, `.hipnc`, and `.hiplc` (alongside
  `.duf` and http/https links).

## 0.24.0

### Minor Changes

- [#83](https://github.com/polynaut/dth-character-studio/pull/83) [`a51a795`](https://github.com/polynaut/dth-character-studio/commit/a51a795db9bbbac2a12190226b3417904cbfb480) Thanks [@polynaut](https://github.com/polynaut)! - Tools: add a **DazToHue-Scripts** tab that downloads the companion
  [soltude/DazToHue-Scripts](https://github.com/soltude/DazToHue-Scripts) repo — the
  Daz Studio scripts behind DTH Character Studio — straight from GitHub and installs
  it into `<My DAZ 3D Library>/Scripts/DazToHue-Scripts`. It delivers
  `DthScanFrames.dsa`, which exports the full morph list of an open Daz scene as a CSV
  you can pull into a character's ROM section via a section's **Import from CSV**.

  The download + unpack run natively (the webview can't fetch the archive — codeload's
  CORS only allows render.githubusercontent.com); GitHub's top-level wrapper folder is
  stripped, the zip is unpacked beside the destination and swapped in (so a failed
  download never leaves a half-written install), and re-installing replaces the folder
  with the latest version. Reuses the reqwest/rustls (ring) stack already in the build
  via the updater, so no new dependencies.

### Patch Changes

- [#83](https://github.com/polynaut/dth-character-studio/pull/83) [`a51a795`](https://github.com/polynaut/dth-character-studio/commit/a51a795db9bbbac2a12190226b3417904cbfb480) Thanks [@polynaut](https://github.com/polynaut)! - Fix: external links — the About page's GitHub link and links inside info popups —
  now open in the system browser. The shell `open` scope was limited to `.duf` /
  `.hip` paths, which silently rejected `https://` URLs; it now also allows http/https.

## 0.23.1

### Patch Changes

- [#81](https://github.com/polynaut/dth-character-studio/pull/81) [`0ecbcc6`](https://github.com/polynaut/dth-character-studio/commit/0ecbcc6da374ef0198f615e6dfebadfa6f83fcc3) Thanks [@polynaut](https://github.com/polynaut)! - Danger zone (uninstall-Daz cleanup) tweaks:

  - "Prefill folder paths" now also offers the Daz Studio app install folders `C:\Program Files\DAZ 3D\DAZStudio6` and `C:\Program Files\DAZ 3D\DAZStudio4`, so a full cleanup can also remove the application itself — not just its content/library folders.
  - Prefill now adds the **full** standard-folder list regardless of whether each one currently exists (no longer filtered at prefill time). Existence is checked when deleting — missing folders are reported as "not found" — so the list stays complete no matter Daz's install state. The "Daz must be installed" info popup was removed accordingly.

## 0.23.0

## 0.22.1

## 0.22.0

## 0.21.2

## 0.21.1

## 0.21.0

## 0.20.0

## 0.19.2

## 0.19.1

## 0.19.0

## 0.18.0

## 0.17.0

## 0.16.0

## 0.15.1

## 0.15.0

## 0.14.0

## 0.13.0

## 0.12.0

### Minor Changes

- [#35](https://github.com/polynaut/dth-character-studio/pull/35) [`36310ad`](https://github.com/polynaut/dth-character-studio/commit/36310ad1ff67db36af9348aebfe2c94373bcbaf4) Thanks [@polynaut](https://github.com/polynaut)! - Native OS drag-and-drop for Daz scenes (`.duf`), Houdini projects (`.hip`/`.hipnc`/`.hiplc`) and the character avatar image: drag a file from Explorer onto the **pane** where it's added — the whole area is the drop target, no need to aim at the Browse button, and it highlights while a supported file hovers it. Wired into the new-character scene picker, the editor's Daz scenes and Houdini projects fields, and the avatar image dialog. Built on Tauri's native webview drag-drop (hit-tested to the pane under the cursor), so it works with real Explorer files (HTML5 file drops don't fire when the webview captures OS drops).

## 0.11.0

## 0.10.0

### Minor Changes

- [#32](https://github.com/polynaut/dth-character-studio/pull/32) [`528ba6f`](https://github.com/polynaut/dth-character-studio/commit/528ba6fd041761fa29d5c4cd64f3b8394efe80a6) Thanks [@polynaut](https://github.com/polynaut)! - Measure pose-asset ROM frame lengths on the fly from the actual `.duf` files instead of hard-coding them. A native command (`pose_asset_frames`) reads each preset's DSON (gunzipping if needed) and returns `round(maxKeyTime × 30) + 1`; the base ROM, Golden Palace, Dicktator and Physics blocks are all measured per character — so custom assets (e.g. a user's own JCM `.duf`) work exactly like the DTH ones, and the generated PoseAsset CSV frame offsets are always correct. The editor's absolute frame numbers re-measure live as preset/custom selections change. Generation **hard-errors** if an included asset can't be read (never a silently wrong-length ROM); the `BASE_FRAMES_*`/`GP_FRAMES`/`DK_FRAMES`/`PHYS_FRAMES` constants are gone.

- [#30](https://github.com/polynaut/dth-character-studio/pull/30) [`f3f70d4`](https://github.com/polynaut/dth-character-studio/commit/f3f70d4a4578d60a459e79b63876d6bac5474096) Thanks [@polynaut](https://github.com/polynaut)! - Reorganized the DazToHue settings into two self-contained panes: **Setup DTH Release** (DTH release selection + My DAZ 3D Library + Houdini documents folder + install) and **Setup DTH Exporter Plugin Release** (Exporter Plugin selection + Daz Studio install folder + install). Each has its own dry-run, gating, and report, and the admin-sensitive plugin step fails with a clear "close all Daz and Houdini apps and restart as administrator" message. The Exporter pane also reads the version already installed in the Daz plugins folder and shows up-to-date / update-available, labelling its button Install / Update / Reinstall accordingly. The DazToHue-Scripts folder moved to General settings.

## 0.9.0

### Minor Changes

- [#28](https://github.com/polynaut/dth-character-studio/pull/28) [`0bb2151`](https://github.com/polynaut/dth-character-studio/commit/0bb2151e5c351d24f0b17b107bcba5349f420d3a) Thanks [@polynaut](https://github.com/polynaut)! - Remember mapped network drives (X: → \\host\share) as you pick paths and re-map any that are missing on startup — so the app keeps working after you relaunch it as administrator, when Windows hides your interactive drive mappings from the elevated session. A new "Network drives" section in Settings → General lists them with their status, a manual re-map, and a Forget action.

## 0.8.0

## 0.7.0

### Minor Changes

- [#24](https://github.com/polynaut/dth-character-studio/pull/24) [`d6d1f1e`](https://github.com/polynaut/dth-character-studio/commit/d6d1f1e01a20dfb0b4d3a6fec25287f253e193d9) Thanks [@polynaut](https://github.com/polynaut)! - One-click install of a DTH release and the Exporter Plugin into your local Daz Studio and Houdini — a native (Rust) port of the dth-cli install commands, with a dry-run preview and new optional settings for the Daz Studio install folder and the Houdini documents folder.

## 0.6.0

## 0.5.0

## 0.4.0

### Minor Changes

- [#16](https://github.com/polynaut/dth-character-studio/pull/16) [`99a888e`](https://github.com/polynaut/dth-character-studio/commit/99a888e51d0d338f22692d3ec7ae9a2294ad2687) Thanks [@polynaut](https://github.com/polynaut)! - Add **Open in Daz** / **Link Daz scene** to the character editor. When a
  character's linked scene exists on disk, an "Open in Daz" button opens that
  `.duf` straight into Daz Studio. When the scene is missing (deleted or renamed)
  or was never linked, the button becomes "Link Daz scene": it opens a file picker
  and — if the chosen scene lives outside the project — offers (via the same modal
  as create) to copy it and its thumbnails into the character's folder. Linking
  persists immediately and refreshes the avatar from the new scene. The desktop
  shell `open` scope is widened to permit `.duf` paths (was http/tel/mailto only).

## 0.3.2

## 0.3.1

## 0.3.0

## 0.2.1

### Patch Changes

- [#6](https://github.com/polynaut/dth-character-studio/pull/6) [`d78e690`](https://github.com/polynaut/dth-character-studio/commit/d78e690659c17d20baef8aa23385c91d9515c08b) Thanks [@polynaut](https://github.com/polynaut)! - New app icon — the flame-swirl character-profile logo — across the installer, window, and taskbar.

## 0.2.0

### Minor Changes

- [#2](https://github.com/polynaut/dth-character-studio/pull/2) [`7131015`](https://github.com/polynaut/dth-character-studio/commit/71310154dfd5b07d4f2d1f150c0a66e5c6ac652d) Thanks [@polynaut](https://github.com/polynaut)! - Migrate the desktop runtime from Electron to Tauri 2, convert the frontend to a client-rendered SPA, and restructure into a 2-layer monorepo: `@dth/web` (SPA frontend), `@dth/desktop` (Tauri shell), `@dth/rom` (pure generation core). Adds in-app auto-update (GitHub Releases) and a changesets-driven release pipeline.
