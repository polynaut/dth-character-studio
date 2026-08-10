---
name: upgrade-houdini
description: Walk the studio's Houdini coupling surface when a new Houdini ships — pair the new install + prefs folder, reinstall the DTH assets there, and re-verify the hython/Python and env assumptions. Use for any new Houdini version (point or major, e.g. 22.5 or 23.0).
---

Goal: a new Houdini version lands and every integration the studio has with it
gets **checked, adjusted where needed, and re-verified**. The single biggest
fact: **a new Houdini means a fresh, EMPTY `houdini<MAJOR>.<MINOR>` documents
folder, and nothing migrates into it automatically** — the DazToHue HDA, the
shared presets and the `houdini.env` wiring are all simply absent until
reinstalled. The only signals today are the Settings-card warning and hard
errors from Generate/Export/Utils. Line numbers drift — symbols are the real
pointers. (HDA/DazToHue-side contracts are `/upgrade-dth`'s job; this skill is
the HOST.)

## Step 0 — Pair the new install (the user-facing ritual, do this first)

1. Launch the new Houdini once so it creates its `Documents/houdini<X>.<Y>`
   prefs folder (it does not exist before first launch).
2. Settings → the new install appears from the registry scan; its card warns
   `no houdini<X>.<Y> documents folder found` until the folder exists and is
   configured. Activate the pairing.
3. **Reinstall the DTH release's Houdini Assets into the NEW docs folder**
   (Settings → the DTH release install, houdini target) — otls/toolbar/
   presets. Without this the DazToHue shelf/HDA simply isn't there.
4. Re-wire `houdini.env` in the new folder: Tools → Refresh assets re-writes
   `DAZ3D_LIB` (`storage/houdini-env.ts`); the shared-presets install appends
   `SHARED_PRESETS` + `HOUDINI_PATH` (`install.rs` `wire_houdini_env`).
5. Keeping the OLD Houdini too? Add its docs folder under
   `extraHoudiniDocsFolders` so both stay wired.

## Step 1 — Detection & pairing code

CONTRACT: discovery is **registry-only** — `apps/desktop/src/houdini_install.rs`
reads `HKLM\SOFTWARE\Side Effects Software\Houdini`, keeping value names that
are exactly four dot-separated numeric parts (`is_version`). Pairing:
`houdiniVersionFromInstall` (regex `(\d+)\.(\d+)` on the install folder
basename `Houdini 22.0.368`) ↔ `houdiniVersionFromDocs` (regex
`^houdini(\d+)\.(\d+)$` on the docs basename) — `apps/web/src/lib/
houdini-version.ts`, paired/sorted in `houdini-install.ts`.

CHECK: if SideFX changes the version spelling (a suffixed `23.0.0.100b`, a
`houdini23.0py312` docs name), the install silently VANISHES from the UI or
never pairs — `is_version` and both regexes are the suspects. Portable/
unregistered installs are invisible by design (manual entry is the route).

ADJUST: those three symbols + `contracts/houdini-installs.json` (serde+zod
round-trip on both sides) + `houdini-version.test.ts`,
`houdini-install.test.ts`, smoke `houdini-install-detect`.

## Step 2 — Binaries & launch

CONTRACT: the studio spawns exactly two binaries, both hardcoded:
`bin/hython.exe` (`api/houdini.ts` `hythonPath`, `api/houdini-material.ts`
`resolveHython` — deliberately duplicated) and `bin/houdini.exe`
(`api/houdini.ts` GUI launch). Liveness (`houdini.rs` `houdini_running`)
matches THREE exe names — `houdini.exe`, `houdinifx.exe`, `houdinicore.exe`
(licence tier decides the name) — but the LAUNCHER only tries `houdini.exe`:
an FX/Core-only install fails the exists() check. Generated projects are
unconditionally **`.hiplc`** (Indie assumption); linking/opening accepts all
of `.hip|.hiplc|.hipnc` (`detected-files.ts` `HIP_EXT`).

CHECK: new Houdini renames/splits binaries → those sites; a licence-tier
change → the `.hiplc` literal (`generatedHoudiniScenePath`) and the launch
fallback gap become real.

## Step 3 — The Python runtime (no automated tests — verify by running)

CONTRACT (`apps/web/src/lib/rom/houdini-runtime/`):
- `456.py` — the one explicit host-version fork in the codebase:
  `from PySide6.QtCore import QTimer` with PySide2 fallback ("Houdini 20.5+
  ships PySide6"); `hdefereval.executeDeferred` + `QTimer.singleShot`
  (10s breather); `hou.exit(exit_code=0, suppress_save_prompt=True)` (kwarg
  names are host API); headless it FABRICATES `hou.ui` with exactly
  `displayMessage` + `triggerUpdate` — an HDA/host change touching any other
  `hou.ui` member headless breaks there.
- `material_utils.py` — touches `hou` API at module import (fails hard on a
  rename): `hou.folderType.*MultiparmBlock*`, `hou.*ParmTemplate`;
  `hou.hipFile.load(path, suppress_save_prompt=True, ignore_load_warnings=
  True)` / `.save()` / `.hasUnsavedChanges()`; `hou.putenv/getenv` ($JOB
  sentinel); `hou.shelves.tools()/shelves()`; `hou.expandString`;
  `hou.OperationFailed/PermissionError/Error`. Header stamps the
  measured-against versions — re-stamp it.
- `houdini.rs` `create_houdini_project`'s embedded Python:
  `hou.nodeTypeCategories()`, `nameComponents()`, `moveToGoodPosition()`,
  `allSubChildren()`, stdout markers `DTH_NETWORK=`/`DTH_TYPES=`/`DTH_PREFILL=`.

CHECK — these files have **no automated tests**; the verification IS a real
run on the new Houdini: (1) Generate project (exercises the embedded Python +
shelf tool), (2) the Utils scan + one material-copy (exercises
material_utils.py), (3) one DTH Export handoff with `closeWhenDone`
(exercises 456.py end to end, PySide import included). Python-version bumps
in Houdini are absorbed silently today (py3, no f-strings, utf-8 opens) —
watch hython stderr on the first run.

## Step 4 — Env & prefs semantics

CONTRACT: `HOUDINI_USER_PREF_DIR` is set on all three spawn sites
(`houdini.rs` ×2, `houdini_material.rs`) — without it hython never loads the
user's otls (the DazToHue HDA). `HOUDINI_SCRIPT_PATH` is set to `<dir>;&` —
the `;` is the Windows separator, the trailing `&` appends Houdini's default
path; both load-bearing (`houdini-jobs.ts` `houdiniScriptPathValue`, pinned
in its test + smoke). Opening a `.hip` from the UI goes through
`explorer.exe` (`shellopen.rs`) so Houdini resolves prefs from a pristine
env, not the studio's. `$JOB` is process state (leaks between `.hip` loads
in one hython run — the `JOB_SENTINEL` guard); `$HIP` derives from the file
location and cannot be repointed.

CHECK: a new Houdini changing script-path scanning, prefs resolution or
variable expansion surfaces here — and in `hipRefPrefixFor`
(`lib/scene-subfolder.ts`) + `_collapse_ref` (which deliberately avoids
`hou.text.collapseCommonVars`; see `.ai/gotchas.md` for why).

## Step 5 — Version literals, docs & fixtures

- Settings placeholders/help text name concrete versions
  (`routes/settings.tsx`: `houdini20.5`, `Houdini 22.0.368` etc.) — refresh.
- Measured-against stamps: `material_utils.py` header,
  `houdini-material-merge.test.ts` provenance comment, `.ai/gotchas.md`
  Houdini sections, `.ai/domain.md` (Generate/Refresh/456.py sections).
- Guide: `02-setup.md` (Houdini cards, prefs-folder explanation, extras),
  `06-into-houdini.md`. Screenshots via `/docs-refresh`.
- Smoke fixtures pin `Houdini 22.0.368` + `houdini22.0` throughout
  (`smoke/houdini-*.smoke.ts`, `guide.screenshots.ts`).
- KNOWN GAP (Backlog C9, `.ai/domain.md`): no record of which Houdini (or
  DTH) release generated a project — host-upgrade staleness is undetectable
  by design today. Revisit if a Houdini upgrade actually breaks old projects.

## Step 6 — Ship shape

- Host-side fixes here are TS/Rust/Python — no `RUNTIME_VERSION` implications
  unless the emitted `.dsa`/CSV changed (that's `/upgrade-dth` territory).
  Changeset always.
- PR body: the live-verified vs assumed split — name which of Step 3's three
  runs actually happened on the new Houdini.
- Update THIS file + the measured-against stamps. New measured facts →
  `.ai/gotchas.md`; procedure/anchor changes → here.
