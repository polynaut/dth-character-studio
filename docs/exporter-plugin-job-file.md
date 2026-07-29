# DTH Exporter job file — the Execute handoff contract

How DTH Character Studio hands a batch of ROM/export runs to the **DTH Exporter
Plugin** (the C++ Daz Studio plugin), and how the plugin side can be
implemented. The studio side is implemented (`apps/web/src/lib/rom/execute-jobs.ts`
+ `apps/web/src/lib/rom/api/execute.ts`); the plugin side is a proposal for the
plugin's next version.

## The idea

Daz Studio has no usable "remote control" once it is running (a second launch
only forwards arguments to the running single instance, and DS6 drops even
those once a scene is loaded). What *does* work reliably is **startup**: the
plugin is loaded and initialized on every Daz start. So the handoff is a file:

1. The studio writes a small **job file** (CSV) into the shared
   `Scripts/DTH-Character-Studio/` folder of the user's Daz library.
2. The studio **starts Daz Studio without a scene** (plain `DAZStudio.exe`, no
   arguments).
3. The plugin, once it is ready during startup, **checks for the job file**.
4. The plugin **parses it and deletes it** — the deletion is the acknowledgement
   that the data transfer succeeded. (It also means a crash mid-run never
   re-runs the batch on the next start; the user re-triggers from the studio.)
5. The plugin **works through the jobs**: open the row's Daz scene, wait until
   it is ready, run the row's script, wait for it to finish, throw the scene
   changes away, and continue with the next row.

## The job file (normative)

**Name & location:** `dth_exporter_jobs.csv`, directly inside
`<content dir>/Scripts/DTH-Character-Studio/`. The studio writes it into the
configured "My DAZ 3D Library"; the plugin should probe **every mapped Daz
content directory** for that relative path and process the first file it finds.

**Format:**

```csv
daz-scene-path,daz-script-path
X:\Projects\Sol\Electra\daz3d\Electra.duf,X:\DazLibrary\Scripts\DTH-Character-Studio\Sol\Electra\ROM_Electra_G9.dsa
X:\Projects\Sol\Electra\daz3d\Electra_Armor.duf,X:\DazLibrary\Scripts\DTH-Character-Studio\Sol\Electra\ROM_Electra_G9.dsa
```

- UTF-8, no BOM. Lines end in LF (`\n`); a parser must accept CRLF too.
- The **first line is the fixed header** `daz-scene-path,daz-script-path`. If it
  doesn't match, treat the file as foreign/corrupt: do **not** run anything, do
  **not** delete it, log a warning.
- Two columns per row: the absolute path of a Daz scene (`.duf`) and the
  absolute path of a `.dsa` script to run in that scene. Separators may be `\`
  or `/`.
- RFC-4180 quoting: a field containing a comma or quote is wrapped in `"…"`,
  inner quotes doubled (`""`). Plain paths are written unquoted.
- Rows are **ordered** — run them top to bottom. Extra columns appended in a
  future version must be ignored by the parser (forward compatibility).
- The file is **replaced whole** on every Execute (last write wins). The studio
  writes it atomically (temp file + rename), so a partially-written file is
  never observed.

**Lifecycle:** parse → **delete** → run. Delete immediately after a successful
parse, before running the first job. Deletion = "transfer succeeded". If the
file can't be parsed, leave it in place and log; the studio's next Execute
overwrites it anyway.

## The job loop (plugin side)

```
currentScene = none
for each row (in file order):
    if row.scene != currentScene (path-normalized, case-insensitive):
        open row.scene, REPLACING the current scene without saving
        wait until the scene is fully loaded / the event loop is idle
        currentScene = row.scene
    run row.script synchronously, wait for it to return
after the last row:
    discard the open scene's changes (new empty scene, never save)
```

Two rules matter:

- **Never save a scene.** The ROM script keys hundreds of timeline frames into
  the open scene; those changes are working state for the exporter only and are
  always thrown away.
- **Only reopen when the scene path changes.** Consecutive rows with the same
  scene share one session — that is what makes the *split* export mode work:
  the studio then emits two rows per scene (`ROM_….dsa` builds the ROM,
  `Export_….dsa` exports it), and the Export script needs the ROM the previous
  row just built on the timeline.

**Per-row failure policy:** a missing scene file, a missing script file, or a
script that errors should **skip to the next row of a different scene** (rows
for the same scene depend on each other; rows for other scenes don't) and be
logged. The generated ROM scripts already write a per-character run log the
studio reads back, so fine-grained error reporting is the studio's job — the
plugin only needs coarse logging (e.g. `dzApp->log(...)`).

## Implementation sketch (Daz SDK, C++)

Exact API spellings should be verified against the SDK headers of the plugin's
build; the shapes below are the known-good mechanisms.

- **When to check:** during plugin startup, defer until Daz is fully up and the
  event loop is idle — e.g. `QTimer::singleShot(0, …)` (or a short delay) from
  the plugin's init, or the SDK's app-started signal. Checking too early risks
  content-directory mapping not being ready.
- **Finding the file:**

  ```cpp
  DzContentMgr* mgr = dzApp->getContentMgr();
  for (int i = 0; i < mgr->getNumContentDirectories(); ++i) {
      QString candidate = mgr->getContentDirectoryPath(i)
          + "/Scripts/DTH-Character-Studio/dth_exporter_jobs.csv";
      if (QFile::exists(candidate)) { /* parse, delete, run */ break; }
  }
  ```

- **Parsing:** `QFile` + `QTextStream` (UTF-8) and a ~20-line RFC-4180 field
  splitter (or Qt's `QStringDecoder` + hand parser). Validate the header line
  first; `QFile::remove()` after parsing.
- **Opening a scene:** `dzApp->getContentMgr()->openFile(path, /*merge=*/false)`
  replaces the current scene **without a save prompt** (measured behaviour —
  the studio already relies on it elsewhere). It is synchronous, but follow it
  with an event-loop drain (`dzApp->processEvents()` or a queued continuation)
  so deferred post-load work settles before the script runs.
- **Running a script:**

  ```cpp
  DzScript script;
  if (script.loadFromFile(row.scriptPath)) {
      script.execute();   // synchronous; returns when the ROM/export is done
  }
  ```

  Optionally pass an argument (`script.execute(args)` → script-side
  `getArguments()`) marking "job mode" — today's generated scripts ignore
  arguments, so this is forward-compatible (see Open points).
- **Discarding at the end:** start a new empty scene (the SDK's new-scene call,
  the same thing File → New does) and, if needed, clear the modified flag so
  quitting Daz later never prompts to save ROM keyframes.
- **Sequencing:** run the whole loop off a queued slot per step (open → settle →
  execute → next) rather than one long blocking call, so the UI stays alive
  and Daz's own progress dialogs can paint. The DTH Exporter is itself
  synchronous within the script, which is fine.

## What the studio writes when (implemented)

The **DTH Export** button (top-right in the character editor) opens a
scene-picker dialog; it requires a saved (non-dirty) character, a linked
primary scene, an export directory and a configured Daz library. The dialog
lists every linked scene with a checkbox — pre-checked when the scene is
**affected**: its `.duf` (mtime+size) or its definition signature changed
since the last handoff. The signature covers the base definition (minus
cosmetic/provenance fields) for every scene, plus the scene's own override
record for non-primary scenes — so a base edit pre-checks all scenes, an
override edit only its scene, and the first run pre-checks everything. A
per-row wand solos that scene; any combination can be checked by hand.
Confirming writes the job file for the checked scenes (in row order) and
starts Daz. Stamps live in the character folder (`.dth_execute_stamps.json`)
and update at handoff time.

Per scene the row set is: `ROM_<Name>_<Genesis>.dsa` (the one ROM script — it
selects the open scene's overrides itself and carries the export unless split),
plus `Export_<Name>_<Genesis>.dsa` right after it when the character's export
is split off.

If Daz Studio is already running, the studio writes the job file but does
**not** launch (a second launch would only forward to the running instance,
whose startup check has long passed) — the user is told to restart Daz instead.

## Open points / future versions

- **Modal dialogs during unattended runs:** the generated scripts report hard
  failures with a `MessageBox` (deliberately loud for interactive use). In a
  long unattended batch that blocks the queue until someone clicks OK. A future
  runtime version can suppress dialogs when the plugin passes a "job mode"
  script argument (the run log — which the studio reads back — already carries
  the details). Until then: failures pause the batch at a dialog.
- **Job-scoped options** (e.g. per-row export dir overrides) would be added as
  extra CSV columns on the right — parsers must already ignore unknown columns.
