---
name: upgrade-dth
description: Walk the studio's DazToHue coupling surface when a new DTH release ships — check every measured contract against the new release, adjust what changed, and decide the era/runtime/docs fallout. Use when mrpdean publishes a new DTH version (pass it, e.g. /upgrade-dth 2.6).
---

Goal: a new DTH release lands and every integration the studio has with it gets
**checked, adjusted where needed, and re-verified** — without anyone having to
remember the details. Nothing below is documented upstream; every contract was
MEASURED against a specific release (the anchors say which). Line numbers
drift — the symbol names are the real pointers.

Two standing design rules that survive every upgrade:

- **Feature-detect, never version-detect.** The studio never reads an HDA
  version; it probes per parm (`node.parm(name) is None`) and per capability
  (`typeof dthExportAction.doExport == "function"`). A new release adding
  capabilities gets a new probe, not a version gate.
- **Execute the vendor's tools, don't model them.** Project creation and
  Refresh assets run DazToHue's own shelf-tool scripts (`exec(tool.script())`)
  rather than reimplementing them — an upgrade changes what the tool does, not
  what the studio has to know.

## Step 0 — Stage & triage

1. Put the new release next to the old one and confirm the app's scan sees it:
   `storage/releases.ts` — a release root is marked by **`copyright.txt`**,
   version = last numeric run in the folder/zip name (`parseVersion`), poses at
   `<root>/Daz Studio Content/DazToHue/Poses` (`posesFolderOf`). If the scan
   misses it, the release LAYOUT changed → fix `releases.ts` first.
2. **Diff the release trees** (old vs new) — the cheapest breakage radar:
   - `Houdini Assets/otls/DazToHue.hda` changed → Steps 2 + 3
   - exporter DLLs (`*dth_exporter*.dll` — the name has been renamed across
     releases before) → Step 4
   - `Daz Studio Content/DazToHue/Poses/` tree → Step 5
   - top-level folder RESTRUCTURE → Step 6
3. To read the HDA's internals, expand it: `<houdini>/bin/hotl -t <dir>
   DazToHue.hda` (or Houdini → Type Properties → Scripts). You want
   `import_from_csv()` (Step 2) and the parm definitions (Step 3).

For each step below: **CONTRACT** (what we assume) → **CHECK** → **ADJUST**.
Run the named test files after each adjustment; the full gate at the end.

## Step 1 — PoseAsset CSV era (the invariant surface)

CONTRACT: `packages/rom/src/types.ts` — `POSEASSET_CSV_BREAKING_VERSIONS =
['2.0']` (pre-2.0 HDAs read `CTL`/`CTLGROUP`, 2.0+ read `CURVE`/`CURVEGROUP`);
`poseAssetCsvEra()` maps a release to its era; `GENERATIONS` pins the baked
block lengths (G9: base 328 / gp 104 / phys 43). Ground-truth templates in
`packages/rom/src/templates/` were exported from working nodes of specific
releases; `apps/web/docs/poseasset-csv-spec.md` is the full reverse-engineered
format, pinned to the release named in its header.

CHECK: diff the new HDA's `import_from_csv()` against the spec doc. Same
row-types/columns/menu indices → non-breaking; done (a version bump alone
never goes stale — `tools.md` documents that).

ADJUST (breaking): add the version to `POSEASSET_CSV_BREAKING_VERSIONS`, widen
`PoseAssetCsvEra`, export a NEW ground-truth template from a working node of
the new release, update `GENERATIONS` era fields + `csv.ts` gates
(`poseAssetCsvValidated`, `templateBakedPoseNames`) + the spec doc + the era
tests (`types.test.ts`, `generate.test.ts` splice cases). Staleness then flows
by itself: `generate.ts` compares `poseAssetCsvEra(generatedDthVersion)` vs the
active release, and Tools → Refresh regenerates the CSVs.

VERIFY LIVE: import a freshly generated CSV in the new HDA — the spec was
reverse-engineered, so only a real import proves it.

## Step 2 — HDA automation contract (456.py + jobs)

CONTRACT: `apps/web/src/lib/rom/houdini-runtime/456.py` docstring holds every
measured fact. Highlights: export node types `daztohueexport` /
`daztohuegroomexport`, import node matched by substring `daztohueimport`,
scene identity parm `import_character_dtu_file`, `export_directory` (the HDA
string-concatenates it — the value MUST end in a slash), the export button parm
`export_trigger`, the "Continue anyway?" pre-flight dialog answered with
button 0, no PDG (export is synchronous), `hou.exit(suppress_save_prompt)` for
`closeWhenDone`. `houdini-jobs.ts`: `DTH_HOUDINI_JOB` env,
`HOUDINI_SCRIPT_PATH` value `<dir>;&` (the `;&` is load-bearing). Hython is
hardcoded `bin/hython.exe` (`api/houdini.ts`).

CHECK: in the expanded HDA, confirm those node type names, parm names and the
dialog still exist; then one real "Export too" run.

ADJUST: `456.py` + `houdini-jobs.ts` + their tests (`houdini-jobs.test.ts`,
smoke `houdini-export` / `houdini-only` / `houdini-generate`). 456.py is
rewritten into app-data before every run, so fixes ship without an installer.

## Step 3 — Houdini project Utils (the biggest parm surface)

CONTRACT: `apps/web/src/lib/rom/houdini-runtime/material_utils.py` header
names the release its facts were measured against. The load-bearing names:
node types `DazToHueMaterial` / `DazToHueSkeleton`; multiparm folders
`material`, `material_uv_channel`, `material_texture_baker`,
`skeleton_options_folder{,_1,_2}`; field templates like
`material_texture_baker_layer_source_uv#_#` and `material_group#`
(space-separated `@fbx_material_name=…` expressions); DazToHue multiparms are
**0-based**; the HDA's "Linking" writes `ch()` refs that transfer must flatten;
prefill parm list shared with `apps/desktop/src/houdini.rs`
(`import_character_*`, `import_skinning_method`, `export_directory`,
`pose_asset_csv_file_path` — absent in DazToHue 2.5, back in 2.5.1's standalone
`DazToHuePoseAsset.hda`, and *reported* when absent, not skipped; note a
standalone library can sit BESIDE the combined one and win on version, so
"which HDA is installed" is a folder listing, not a Settings value);
shelf-tool tokens `daztohue` / `refreshassets` (matched on normalized
label+name); `HOUDINI_USER_PREF_DIR` must be set or the otls never load.
The card's "Needs attention" verdict comes from `houdini-validate.ts`.

CHECK: run `op_scan` (Utils drawer → the scan behind the badge) against a
project created with the NEW release — it reports missing parms by name, which
IS the tripwire for renames. Then exercise each Utils operation once against a
new-release project: copy material setup, copy skeleton setup, Make paths
portable, Fill network, Refresh assets.

ADJUST: `material_utils.py` (update its measured-against header!),
`houdini-validate.ts`, `houdini-defaults.ts`, `houdini.rs` prefills. Tests:
`houdini-validate.test.ts`, `houdini-defaults.test.ts`,
`houdini-material-merge.test.ts` (pinned against real projects of a named
release — re-pin if slot semantics changed), `api/houdini-material.test.ts`,
smoke `houdini-refresh-assets` / `houdini-project-health` /
`houdini-utils-backups`, `contracts/material-util-report.json`.

## Step 4 — Daz Exporter Plugin contract

CONTRACT (`packages/rom/src/dsa.ts`): DS6 action class
`DazToHueExporterAction`, DS4 fallback action *name* `DazToHue_Action`;
scriptability is gated on `typeof doExport == "function"` (DS6 since exporter
1.8.1, DS4 since **2.0.2.0** — older DS4 builds silently export nothing);
`doExport(dir, name, refFrames, false)` — 4 args;
`doExportAlembicGroomPoses(dir, name, false)` — the 2-arg call CRASHES Daz;
plugin 2.0+ skips hidden nodes (`exporterSupportsGroomHide`,
`MIN_GROOM_EXPORTER_VERSION = '2.0.1'` in `types.ts`); reference skeletons
land at `<ExportDir>/Reference Skeletons/<Name>_frame_<N>.fbx`; the delivered
CSV is `<Name>_pose_asset.csv`. DLL discovery: `releases.ts` `isExporterDll`
(`*dth_exporter*.dll`), version read from the DLL's VS_FIXEDFILEINFO in
TypeScript (`fileVersionFromBytes` — there is NO Rust equivalent).

CHECK: install the new plugin, one full ROM+export run + one groom export run
on a real character. If the DLL was renamed again, `isExporterDll`'s pattern is
the first suspect.

ADJUST: `dsa.ts` / `dz-snippets.ts` emit changes (→ **`RUNTIME_VERSION` bump**,
see Step 8), `types.ts` capability constants, `releases.ts` discovery. Tests:
`generate.test.ts` exporter-integration block, `scene-override.test.ts` frame
cases, smoke `export-hair`.

## Step 5 — Pose-preset `.duf` catalog

CONTRACT: `storage/pose-assets.ts` `classifyPose` expects
`<Genesis 9>/<DQS|Linear>/<name>.duf` with section regexes (`JCM( FAC)? -
Base`, `FAC - Mouth`, `golden ?palace|dicktator`, `physics`);
`runtime/DthOptions.dsa` names the stock files (`GP9 - Golden Palace.duf`,
`DK9 - Dicktator.duf`, `G9 Physics Example.duf`, `G9 DQS/LINEAR JCM FAC -
Base/- Mouth.duf`) and pins the GP/DK ROM fence offsets (`aGPFenceOffsets`,
`aDK9FenceOffsets`). Frame counts are MEASURED per `.duf`
(`poses.rs` `duf_frame_count`), never hardcoded — but the CSV templates assume
the G9 block lengths (Step 1), so a changed preset length degrades to
experimental/custom rather than lying.

CHECK: byte-compare the old and new `Poses/` trees. Identical → done. Renamed
files → `classifyPose` regexes + `DthOptions.dsa` names. **Changed GP/DK ROM
contents** → the scary one: re-derive the fence offsets, re-check
`GENERATIONS` lengths and the templates (Step 1), re-run Scan_Frames.

ADJUST: `pose-assets.ts`, `DthOptions.dsa`, `resolve.ts` defaults. Tests:
`storage.test.ts` poses cases, `preset-frames.test.ts`, `generate.test.ts`
catalog cases, `contracts/pose-asset-frames.json`.

## Step 6 — Install feature

CONTRACT (`apps/desktop/src/install.rs` + `releases.ts`): copies
`Daz Studio Content/{data,DazToHue}` → the Daz library, the whole
`Houdini Assets` tree → the Houdini documents folder, `Unreal Engine
Content/DazToHue` → `<uproject>/Content/DazToHue`, every `.dll` in the
exporter folder → `<daz>/plugins`. Wholesale copies tolerate ADDED content
automatically; only a rename of those top-level folders breaks anything.

CHECK: run the one-click install of the new release into a scratch target and
eyeball the result. ADJUST: `install.rs` paths, `releases.ts` layout probes,
`install.integration.test.ts`, `contracts/install-report.json`.

## Step 7 — Version bookkeeping

`settings.ts`: `dthPosesFolder` (the release(s) folder — historically named),
`currentDthVersion` (the pin; `pinnedMissing` reports drift),
`dthExporterFolder` + `currentDthExporterVersion`. Per-character provenance is
`Character.generatedDthVersion`. After the upgrade, pin the new version in
Settings and run **Tools → Refresh assets** — CSV staleness (era compare) and
script regeneration flow from there. Nothing else to hand-maintain.

## Step 8 — Ship shape

- Emitted `.dsa`/script text changed → **bump `RUNTIME_VERSION`** (+ History
  line in `types.ts`) or no installed script ever refreshes. CSV format
  changed → **era entry** (Step 1), which is what makes Refresh regenerate
  CSVs. UI/lib-only → neither. When unsure, re-read the decision notes atop
  `.ai/conventions.md` §versioning.
- Changeset always; PR body lists **which contracts were verified live against
  the new release and which are still assumed** — the honest split matters
  more here than anywhere, because everything in this file is measured, not
  documented.
- Docs sweep: `poseasset-csv-spec.md` header pin, `.ai/domain.md` (exporter
  contract, Houdini handoff, era sections), `.ai/gotchas.md` measured facts,
  the guide pages (02-setup, 05-rom-in-daz, 06-into-houdini, tools) — run
  `/docs-refresh` for screenshots. Smoke fixtures pin a release version
  (`apps/web/smoke/fixtures.ts` `DTH_VERSION`) — bump if specs depend on it.
- **Update THIS file** with what the new release changed: new measured facts
  go to `.ai/gotchas.md`, procedure/anchor changes land here, and the
  "measured against" headers in `material_utils.py` / the spec doc get the new
  release stamped. This skill is only as good as its last upgrade kept it.
