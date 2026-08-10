---
name: upgrade-daz
description: Walk the studio's Daz-Studio coupling surface when a new Daz Studio ships — re-verify the measured script quirks, the Runner plugin, flavor detection and process/launch assumptions. Use for a DS6 point release, and DOUBLY for a new major (DS7), which hits every closed-world site listed inside.
---

Goal: a new Daz Studio version lands and every integration the studio has with
it gets **checked, adjusted where needed, and re-verified**. Everything below
was MEASURED on specific builds (the ledger is `RUNTIME_VERSION`'s history in
`packages/rom/src/types.ts` plus `.ai/gotchas.md`'s DS sections). Line numbers
drift — symbols are the real pointers.

Standing design rules that survive every upgrade:

- **Feature-detect in DazScript, never version-detect.** Every DS4/DS6 fork in
  the emitted scripts is a `typeof` probe (`saveScene`, `doExport`,
  `getAssetUri`, `isVisible`), never an `App.version` compare. A new quirk gets
  a new probe.
- **Flavor comes from the exe's VERSIONINFO, never from folder names** —
  "DAZStudio4 64-bit" contains a 6 (`dazFlavorFromExeVersion`,
  `storage/releases.ts`).
- **Daz Studio logs nothing useful.** A failed script load or `include()` is
  silent; diagnose with a probe `.dsa` (a script that only writes a marker
  file), never by looking for a log (`.ai/gotchas.md`).

## Step 0 — Triage: point release or new major?

- **Point release (DS6 x.y)** → Steps 2–3 are the work (Runner load + script
  quirks); detection keeps working untouched.
- **New major (DS7)** → ALSO Step 1's closed-world checklist: the DIM-INI
  parser picks up `dzStudio7InstallDir-64` automatically (the key regex is
  version-agnostic), but everything downstream of *flavor* is a closed
  2-member world today.

## Step 1 — Detection & flavor (the closed-world checklist)

CONTRACT: install discovery is **100% DIM-INI** — no registry, no Program
Files scan. `apps/web/src/lib/daz-install.ts` parses `%APPDATA%/DAZ 3D`'s
`dzInstall.ini` + InstallManager INIs (key regex
`dzstudio(\d+)installdir-(\d+)`, newest Studio wins); flavor =
`dazFlavorFromExeVersion` (`storage/releases.ts`): exe VERSIONINFO major ≥ 5 →
`'ds6'`, else `'ds4'`.

CHECK on a new major — every site that hardcodes the 2-flavor world; a DS7
maps to `'ds6'` silently, which is correct only if it keeps DS6's plugin
naming/ABI:
- `DazFlavor` union + `RUNNER_DLL` map (`storage/releases.ts` — DS6 only
  loads `dsp_*.dll`)
- `FLAVORS = ['ds4','ds6']` + the `-<flavor>.zip` asset match
  (`scripts/fetch-runner.mjs`)
- the exe fallback probe list `["DAZStudio6","DAZStudio4"]`
  (`apps/desktop/src/daz.rs` `installed_daz_exe`) and the uninstall paths
  (`uninstall.rs`)
- the Settings UI binary ternary (`ds6 ? 'Daz Studio 6' : 'Daz Studio 4'`,
  `routes/settings.tsx`)

KNOWN GAP: `dazFlavorFromExeVersion` and `detectDazFlavor` have **no test** —
pin them while you're here. Tests that do exist: `daz-install.test.ts`,
smoke `daz-install-detect` (incl. redirected-Documents manifests).

## Step 2 — The Runner plugin (separate repo!)

CONTRACT: the Runner's C++ source lives in
**`polynaut/dth-character-studio-runner`** on GitHub — not in this repo.
`scripts/fetch-runner.mjs` stages its release DLLs into
`apps/desktop/resources/dth-runner/{ds4,ds6}/` (one shared `version.txt`);
`runnerStatus` (`storage/releases.ts`) byte-compares the installed
`<daz>/plugins/<dll>` against the bundled one. The job-file protocol is
normatively documented in `docs/exporter-plugin-job-file.md` (the `type`
field is the capability handshake; DS4 build is Qt 4.8 — no `QJsonDocument`).

A new Daz Studio can break the plugin at the ABI/SDK level. The measured SDK
rules (from the v1.0.x debugging): Daz resolves plugin entry points by
**plain C names** (the SDK's Windows macro exports mangled ones — the runner
pre-declares `extern "C"`); the plugin **SDK version must be ≤ the studio
build** or Daz rejects the DLL; a rejected DLL **stays file-locked until Daz
exits**; DS6 loads only `dsp_*.dll`.

CHECK: install the bundled Runner into the new Daz (Settings → Runner card),
launch, confirm the card reads current, then run one real DTH Export batch
(job pickup + `running_` rename + `jobsDone`). Rejected/ignored DLL → the
Runner repo needs a rebuild against the new SDK → new release there → bump
`fetch:runner`, possibly a new flavor entry (Step 1).

## Step 3 — Emitted DazScript compatibility

CONTRACT: the measured-quirk ledger. Re-verify each on the new build with one
ROM run + one export + one groom export:
- scene save: `typeof App.getContentMgr().saveScene == "function"` → DS4 path,
  else `Scene.saveScene(path)` (DS6 removed `DzContentMgr.saveScene`; return
  values disagree across builds and are deliberately ignored) — `dsa.ts`
- exporter lookup: DS6 class `DazToHueExporterAction`, DS4 action *name*
  `DazToHue_Action`; capability gate `typeof doExport == "function"` — `dsa.ts`
- `DzFile.open(mode)` takes ONE ORed flags int (a second arg warns on DS6) —
  `runtime/DthUtils.dsa`, `DthScanMorphs.dsa`
- `include()` must stay top-level (`URIError: Legacy Include` inside
  try/catch) — pinned in `generate.test.ts`
- `getAssetUri()` method on DS4, `assetUri` PROPERTY on DS6 —
  `dz-snippets.ts`, `DthUtils.dsa`. **And a NODE's own asset URI is empty in
  DS4**: the identity lives on the object — probe node → `getObject()` →
  `getCurrentShape()` → `getGeometry()` (plus `getAssetFileInfo()`), which is
  what `dthNodeAssetPath` does since v68. A one-accessor identity probe is the
  bug this cost: generation detection returned nothing for every DS4 scene and
  the scene morph scan silently skipped them all (`.ai/gotchas.md`)
- `DzFigure.isGraftingActive()` / `getGraft()` not exposed to DAZ Script in
  DS6 — `DthShellSurfaces.dsa`
- the Script IDE is broken on DS6 — never suggest it for debugging

ADJUST: a new quirk = a new **feature-detect** + a `RUNTIME_VERSION` bump
(+ History line — that ledger IS the documentation) + a `.ai/gotchas.md`
entry. The emitted header `// DAZ Studio version 4.22.0.16 filetype DAZ
Script` (4 sites in `dsa.ts` + the runtime files) is a filetype marker — bump
it deliberately if the new Studio requires it, not reflexively; no test pins
it.

## Step 4 — Process & launch

CONTRACT (`apps/desktop/src/daz.rs`): `DAZStudio.exe` is hardcoded in two
places — the `DAZ_EXE` constant (the process probes: `daz_studio_running` /
`running_daz_exe`, enumerated via `procs::running_exe_paths`) and
`exe_in_folder`/`probe_daz_exe`'s folder joins; `foreground.rs` raises the app
by image name. Measured single-instance semantics: DS4 and DS6 are SEPARATE
single-instance apps; a running Daz drops command-line scene forwarding once a
scene is loaded (that's why the Runner job file exists); `openFile(path,
false)` replaces without a save prompt. **Every Studio major ships the same
`DAZStudio.exe`**, so both probes identify an INSTALL by the running
executable's full PATH, never by the image name (see `.ai/gotchas.md`).

CHECK on a renamed exe or changed startup: those two sites + one
launch-with-scene + one launch-scene-less (Runner pickup) — and, on a machine
with two majors installed, that a running OTHER major neither answers
`daz_studio_running(<this install>)` nor hijacks a `launch_daz_studio` aimed
at this one.

## Step 5 — Content library & DIM

CONTRACT: generated scripts land in `<library>/Scripts/DTH-Character-Studio/`
(`storage/runtime-install.ts`); Content-Library tiles are `<base>.png` 91×91 +
`<base>.tip.png` 256×256 matched by name; DIM manifests are parsed by
`runtime/DthProducts.dsa` (XML tags, `IM<storeid>-<build>_<name>.dsx`
convention); `.duf` reading handles gzip + plain DSON with inflate budgets
(`apps/desktop/src/poses.rs`). A new Daz/DIM that changes any of these shows
up as broken tiles, empty product scans, or failed frame counts.

## Step 6 — Docs & fixtures sweep

- `.ai/gotchas.md` DS sections (DIM INIs, DS6 script quirks, exporter
  scriptability split) — re-verify, re-stamp measured-on versions.
- Guide: `02-setup.md` (Daz cards + Runner section, screenshots name the
  studio versions), `05-rom-in-daz.md`; `docs/exporter-plugin-job-file.md`.
- Smoke fixtures pin `C:/Program Files/DAZ 3D/DAZStudio4[ 64-bit]` paths and
  DIM INI contents (`daz-install-detect.smoke.ts`, `elevated-install`,
  `project-scan`, `guide.screenshots.ts`).

## Step 7 — Ship shape

- Emitted-script change → **`RUNTIME_VERSION` bump** or no installed script
  refreshes. Runner change → release in the runner repo first, then
  `fetch:runner` here. Changeset always.
- PR body: the live-verified vs assumed split — which contracts actually ran
  on the new Daz build.
- Update THIS file + the gotchas stamps with what the new Studio changed.
  New measured facts → `.ai/gotchas.md`; procedure/anchor changes → here.
