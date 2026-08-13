# Domain model — DazToHue, ROMs, and what this app actually produces

DTH Character Studio is a declarative front-end for the **DazToHue** pipeline
(Daz Studio → Houdini → Unreal). From ONE character definition it generates **both
sides** of a Range of Motion (ROM): the Daz Studio apply-script (`.dsa`) that keys
the ROM onto a timeline, and the Houdini **PoseAsset import CSV** that tells the
DazToHue HDA what each frame means. Keeping those two artifacts frame-aligned **is
the product**.

## Vocabulary

| Term | Meaning |
|---|---|
| **ROM** | A fixed animation of poses, one per frame, that the DTH Exporter walks to export FBX/alembic per frame. |
| **PoseAsset CSV** | The HDA's import manifest: one row per pose/group, columns are positional, enum columns are menu indices. Spec: `apps/web/docs/poseasset-csv-spec.md` (reverse-engineered, byte-validated). |
| **Section** | One of 8 fixed ROM parts in canonical order: `RET, JCM, FAC, EXP, GEN, PHY, FBM, MISC` (`ROM_SECTIONS` in `packages/rom/src/types.ts`). Each is enabled/disabled and runs in `preset` or `custom` mode (`SECTION_MODES`: RET preset-only; JCM/FAC/GEN/PHY either; EXP/FBM/MISC custom-only). |
| **Preset block** | A shipped DTH `.duf` pose asset (JCM base ROM, G9 Mouth companion, GP/DK genitalia blocks, Physics). Its frame count is **measured** from the real `.duf` at edit time (`pose_asset_frames` command), never hard-coded. |
| **FAC support** | ONE rule, `facPresetSupport(assets, genesis)` in `resolve.ts`: FAC rides in a JCM base ROM flagged `includesFac`; a FAC-section catalog asset is only the G9 **mouth companion**. Availability chips and mouth resolution both consume it (they used to measure different signals and drift), and `bIncludeFAC` is additionally gated on `jcmIsBaseRom` — FAC preset without JCM enabled is a validation error, never a silent no-frame lie to the runtime. |
| **Custom section** | User-authored groups → poses → morphs, keyed after the preset blocks. |
| **Group / suffix / method** | Custom poses live in groups; a group has a Houdini suffix scope (`centre`/`left`/`right`), a generation method and a calculate-from source (menu indices in the CSV). |
| **Morph base / auto-base** | Every pose morph sawtooths: keyed to `value` on its own frame, back to a FLOOR on the neighbours. The floor is `base` (default `0`) — or, with **`autoBase`**, the morph's OWN value read from the scene at frame 0 (`resolveAutoBaseValues` in `DthUtils.dsa`, called before the frame-0 reset and before `applyFrameDatas`; it overwrites `baseValue` and clears the flag). **`autoBase` is ON by default** since schema v31 / runtime v70 — ROM morphs and base-shape morphs are allowed to overlap (a "shaped" scene built partly from FBM morphs the ROM also walks), and without it the sawtooth erases that base shape on every neighbouring frame. A morph the scene does NOT dial reads `0` at frame 0, so on-by-default is behaviour-neutral for the non-overlapping majority; `base` is only read when `autoBase` is off. `morphJson` emits `autoBase` only when true (absent = off, the runtime's reading). **MEASURED: only the extraFrames path honours base/autoBase.** `applyArtDirectionData` sawtooths through `createMorphFrame(oProp, frame, value)` with no base argument, so a GP/DK art-direction morph always returns to `0` — the fields are emitted there but ignored, and the art-direction UI offers neither control. **Cost of on-by-default, read out of the runtime (not measured in Daz):** the resolve pass repeats the node search + `getMorphPropFromNode` + the O(numModifiers) fallback scan that `resetFrameDatasAtFrame` and `applyKeyData` each already run per morph — and unlike the reset pass it does NOT dedupe by prop name. So it adds a third walk of a shape the run already performs twice, and the per-FRAME `applyKeyData` walk dominates all of them either way. Don't "optimise" the autoBase pass alone on suspicion: the three lookups are the same copied block, and the per-frame one is the one that would matter. |
| **Art direction** | Named override frames inside the GP/DK preset blocks (e.g. `VaginaOpen` @ GP frame 96) carrying their own morph values (`ART_DIRECTION_CATALOG`). |
| **JCM morph mods** | Rules riding custom morphs along the shipped joint-corrective bends: per bone/axis, a signed `drives[]` list (angle range → value range; the **sign of the angle extreme picks the bend direction**). Split into runtime `positive[]`/`negative[]` by `jcmMorphModForRuntime` at generation. |
| **Bone scale** | Per-pose flag (`boneScaleRef`) marking a morph that scales bones. Only meaningful in **GEN and FBM** (`REFERENCE_FBX_SECTIONS`) — a reference path on a MIS row breaks the HDA import. The CSV carries `{{DTH_EXPORT_DIR}}/Reference Skeletons/{{DTH_EXPORT_NAME}}_frame_<N>.fbx`; the generated `.dsa` resolves both tokens at CSV-copy time, `{{DTH_EXPORT_DIR}}` via **`dthRefDir`** — the run-time export dir, or (per-project `houdiniPathStyle` on `hip`, the default — the app-global Settings key of the same name is LEGACY pre-v0.61, kept only so old settings.json files still parse, `storage/settings.ts`) **`$HIP/daz-export/<scene subfolder>`** (runtime v66; `$JOB/<houdiniSubdir>/daz-export/…` in v63–v65, `<dazSubdir>/dth-exports` before v64) — a prefix swap on the absolute export ROOT so the resolved scene subfolder rides along. Whether project-relative paths are emitted at all is **HOST-decided** (the pure core just obeys the `hipRefPrefix` argument, `''` = absolute): `generateCharacterFiles` computes it via **`hipRefPrefixFor`** (`lib/scene-subfolder.ts`), which needs at least one linked project, all of them inside the character folder, and the export root inside it too — then picks the anchor in TWO tiers (v66): **`$HIP/<rel>`** when every project shares ONE folder and the export root sits under it (the standard layout since v64 put `daz-export` inside `houdini/`), else **`$JOB/<rel>`**, which encodes no depth and so still serves projects spread across folders or an export root beside the houdini one. The `$HIP` tier restores an anchor-COUNT gate — `$HIP` names the `.hip`'s own folder, so two anchor folders are two different `$HIP`s — but only to CHOOSE the tier, never to fall back to absolute. Anything else — no project yet, a hand-linked `.hip` in the user's own tree (its `$JOB` is whatever the user set), an export root outside the character folder, or style `absolute` — yields `''`. **`$HIP` where it reaches, `$JOB` where it cannot (runtime v66).** `$JOB` IS the character folder: scene state saved with the `.hip` (`hou.putenv`, the programmatic Set Project), baked by `create_houdini_project` since v0.64 and repairable from the Utils drawer — an earlier note here calling it "session-global" and its survival "unverified" was wrong, and the whole Defaults/repair feature rests on the opposite. `$HIP` is the folder the `.hip` sits in, DERIVED rather than stored, so it cannot drift the way `$JOB` does. **The anchor question is settled by measuring Houdini, not by preference** (`hou.text.collapseCommonVars`, the call behind the HDA's file picker — re-measured on a real project 2026-08-10): `<char>/houdini/daz-export/…` → `$HIP/daz-export/…`, `<char>/export/` → `$JOB/export/`. v63 chose `$JOB` because the exports then sat BESIDE the houdini folder, reachable only as `$HIP/../…` — which encodes the scene's DEPTH, so a project one folder deeper broke every path. v64 moved them INSIDE it, which retired that `..` and with it the reason; v66 follows the picker again. `$JOB` keeps everything `$HIP` cannot express without climbing out (`<char>/export`, pre-v64 layouts) and every character whose projects are spread across FOLDERS, where no single `$HIP` exists. **Verified live 2026-08-08** (v63): a freshly generated project came out with every import, CSV and export path reading `$JOB/…` and resolving in Houdini. **Verified in hython 2026-08-10** (v66) against a real project: root priority `$HIP`→`$JOB`→`$DAZ3D_LIB`, `_collapse_ref` sending daz-export to `$HIP/…` and `<char>/export` to `$JOB/…`, `_shorten_job_ref` rewriting the v63–v65 form on DazToHue nodes only, and `_rehome_hip_ref` unchanged. Still unmeasured, both eras: the `hip-relative` badge appearing on a pre-v63 project, and a full generate→open round trip under v66. Pre-v63 projects keep `$HIP/../…`: flagged by `validateHoudiniProject`'s `hip-relative` check and rewritten by Utils → Make paths portable (`_rehome_hip_ref`). v63–v65 projects keep `$JOB/…`: NOT flagged (it resolves — badging it would teach the eye to ignore the badge), only shortened by the same action (`_shorten_job_ref`). |
| **Frame-0 morphs** | "Add morphs on frame 0" (schema v28, runtime v44): a name+value list (`frameZeroMorphs` → `config.frameZeroMorphs`) the runtime sets + keys at frame 0 on EVERY figure-tree node carrying the name (figure, geografts, fitted clothing — one clothing "Expand All" row reaches every outfit piece of the open scene; with no other keys the value holds across the whole ROM). Deliberately UNVALIDATED — no morph scan needed, a scene without the morph skips it with a Daz-log warning, never a run-log failure. Per-scene `sceneOverride.frameZero` = presence-armed full replacement like `preserve`. |
| **Groom / hair** | Daz-side it's "hair", Houdini-side "groom". Hair is ALWAYS per scene by presence (no more `groomMode` — removed in schema v20): a scene's `groomScenes` items ARE its hair, none listed → nothing excluded. The generated script hides them for the ROM export (hide-only, needs Exporter Plugin ≥ 2.0.1 = `MIN_GROOM_EXPORTER_VERSION`), and a separate `Export_Hair_…` script exports EACH hair item of the open scene ON ITS OWN (runtime v33) as `<Name>_Hair_<item>_grooms.abc` — for every item it hides the other wearables (incl. the other hair items) and exports just that one, so Houdini gets one alembic per hair asset. A newly linked scene gets its detected hair PRE-SELECTED by one shared rule — `seedSceneHair` (`lib/groom-detect.ts`) — at all five places a scene reaches a character: creation, the first primary link, Add scene, REPLACE primary, and the missing-primary RELINK. The relink is the SAME scene at a new path, so it first REPOINTS an existing record to the final path (like a move/rename — `repointLinkedScene`) and seeds only a record-less target; a record keyed on the dead old path would never match the scene again. Any new scene-linking path must call it. |
| **Figure detection** | The native `scene_wearables` (`poses.rs`) also returns the scene's base **`figure`** node (the non-conformed node whose id/name starts with "Genesis"). The pure inverse `genesisFromFigureNode(id)` (`types.ts`, the reverse of `genesisFigureNode`) maps `Genesis9` / `Genesis8_1Female` → generation (+ gender for the gendered gens; null for G9). The **create-character dialog** uses it to auto-select Genesis + gender from the picked scene's contents (best-effort, both fields stay editable) — reading what's IN the scene, not guessing from its filename. The **add-scene dialog** validates a candidate EXTRA scene from the same read (`scene-compat.tsx`, "Validation" table): same generation (+ gender where the figure id carries it), exactly ONE figure root (`figures`), an EMPTY animation timeline (`animationFrames` ≤ 1 — the ROM script fills the timeline itself), and the same GP/DK geograft set as the primary scene (gender's closest proxy, matched over the conformed items' id/label). A definite fail blocks Add behind an explicit "Add anyway" switch; an unreadable scene degrades to unchecked and never blocks. The **create-character dialog** runs the character-independent subset (`sceneCreateRows`: one figure root + empty timeline) behind a "Create anyway" switch. The same read also DRIVES two character fields via `primarySceneDerivation` (never continuously): the **GEN section's `enabled`** (on ⟺ the scene carries a GP/DK geograft; its editor toggle is permanently disabled; re-derived by the missing-primary relink flow) and the **gender** (figure id for the gendered gens, geograft for the neutral G9 — DK → male, GP → female; a G9 BOTH-grafts scene also sets `presetAssets` to GP+DK explicitly, since the gender-based auto default would include only one block). Gender is applied by `createCharacter` ONLY — **baked at creation, nothing changes it afterwards** (the relink flow deliberately applies just the GEN part). The manual Gender fields are gone — the create dialog shows it read-only and the Identity row is display-only. **REPLACING the primary is gated on the character having NO extra scenes** (`daz-scene-field.tsx`: the card's replace button is rendered-but-disabled with the reason as its tooltip, and `onReplacePick`/`applyReplace` both re-check). Every extra was validated against the CURRENT primary — above all `geograftRow`, since each scene must produce the primary's skeleton — so swapping the primary re-decides that reference and a GP-less replacement would leave validated extras silently mismatched. Re-validating and unlinking failures automatically is worse than making the user unlink and re-add, which runs the real per-scene validation. The missing-primary RELINK flow (`onPick`/`applyLink`, offered only when the primary FILE is gone) deliberately bypasses this gate: there is no primary left to compare a replacement against and the character must become openable again, so it swaps `scenePath` and re-derives GEN while the extras stay linked unchecked — the accepted escape hatch for the mismatch the replace gate forbids. |
| **Scene override** | A per-EXTRA-scene delta (`sceneOverrides` on `Character`, schema v17; **presence-armed** since v24 — there is no stored boolean, a block EXISTS iff it overrides). Five armable panels: **ROM** (one section-keyed `rom` entry per section — `owned` = the section's full config, else the sparse `replaced` (by base pose **id**, content swaps, frame stays) + `added` (appended at group ends; `flatSectionGroupId` covers flat sections with no stored group), `enabled` overlaid last), **identity** (G9 FACS-detail/flexion/tear-UV), **preserve** (own `morphs`/`nodeTransforms`), **jcm** (replaces `jcmMorphMods`), **frameZero** (v28, replaces `frameZeroMorphs`) — the last three are FULL replacements, emitted even when empty so a scene can clear the base list. **hair** rides the record by presence and never arms it (a hair-only record, e.g. the primary scene's, must not activate an empty override). `applySceneOverride` merges ROM; `mergeSceneOverride` yields the scene's effective character (ROM sections + jcm). `activeSceneOverrides` (any panel armed + scene still in `extraScenes`) is THE single gate; `sceneOverrideBuildsRom` narrows to the ROM subset that also mints a scene-suffixed CSV; `sceneRecordEmpty` prunes a record that means what NO record means. Unlinked overrides keep their data; their files retire on the next save. (v29 removed the per-scene `houdiniProjectFolder` — the export path owes nothing to Houdini now.) |

## The core invariant (do not break)

**Frame numbers are never stored.** Both artifacts derive them at generation time
from section/group/pose ORDER via one shared frame-math module
(`packages/rom/src/frames.ts`):

- `presetEndFrame(sections, gender, frames)` — the single source of preset-block
  math. Returns the last preset frame, or **-1 when no preset block exists** (first
  custom pose then lands at frame 0 — never clamp -1 to 0).
- `walkCustomPoses(sections)` — the single generator over enabled custom
  sections → groups → poses in canonical order (0-based `relativeFrame`).
- `flattenRom(sections)` — the flat frame sequence custom rows are numbered from.

**Everything is 0-based.** Validated G9 layout (DQS + JCM + FAC + GP): base ROM
frames 0–327 (328 frames), GP block @ 328–431 (104 frames), custom sections start
@ 432. DK is 54 frames; the PHY preset block is 43. `generate.test.ts` pins these
offsets byte-identically — if a generation change moves them, the change is wrong.

### The rate those frame numbers mean: 30 fps

A frame number is only a pose at ONE rate. The pipeline's is **30 fps**, and it
shows up in three places that must never disagree:

- `DTH_FPS` in `apps/desktop/src/poses.rs` — a Daz `.duf` keys in SECONDS, so a
  pose preset's length is `round(maxKeyTime × 30) + 1` frames.
- The Daz side writes the ROM at 30 (the runtime's timeline math, `.DthUtils.dsa`).
- `DTH_FPS` in `apps/web/src/lib/rom/houdini-defaults.ts` — the ONE place the
  studio states it for the Houdini leg: what generation bakes into a new scene,
  what the project check compares against, what the repair writes.

**Houdini's own default is 24**, so a scene nobody set lands every imported ROM
frame between two of its own while the PoseAsset CSV names frames generated at 30.
Per mrpdean, **DazToHue's import node sets the scene FPS itself — when it LOADS
the files.** That is the whole shape of the studio's involvement: the trigger
covers the interactive case and cannot cover a HEADLESS generation, where hython
instantiates the network and sets its parms directly and no file is ever loaded.
So `create_houdini_project` calls `hou.setFps` on the empty scene (before the
network exists — no keyframes to re-time), reads `hou.fps()` back and reports the
scene's own answer rather than the value it asked for; `op_scan` reads it per
project; `validateHoudiniProject` badges a mismatch; `op_defaults` repairs it
beside `$JOB`. A scan with **no** value reports `0` and is treated as UNKNOWN
everywhere — never as wrong (an older stored scan predates the field). The queue
is per PROJECT but the write is per VALUE: a project queued for its timeline
alone can carry an unread `$JOB` (`''`), and `op_defaults` must skip that too —
the "unknown is never repaired" gate has to exist on the WRITING side, not just
in the drawer's queueing filter.

What `hou.setFps` does to keyframes in an ALREADY animated scene is Houdini
behaviour this repo has not measured — the repair says so, and takes its rolling
backup first.

## Generated artifacts (per character)

`generateAll()` (`packages/rom/src/generate.ts`) returns `{fileName, content, target: 'daz'|'houdini'}`:

- `ROM_<Name>_<Genesis>.dsa` — self-contained apply script: inline `config` object
  → `include('../../.DthWorkflow.dsa')` → `ApplyDTHCharacter(config)`. Installed to
  `<Daz library>/Scripts/DTH-Character-Studio/<project>/<character>/`; the shared
  **DTH runtime** (`.DthWorkflow.dsa`, `.DthUtils.dsa`, …) is co-installed once at
  that root (`copyRuntimeFiles` in `apps/web/src/lib/rom/storage/runtime-install.ts`;
  `storage.ts` only re-exports it), along with
  the three VISIBLE user-run scripts + their Content Library artwork
  (`VISIBLE_SCAN_SCRIPTS`, same file):
  **`Build_Genesis_Index.dsa`** (builds the stock figures of every generation and
  scans them into the per-generation morph + bone index behind the autocompletes),
  **`Scan_Frames.dsa`** (open scene's keyed frames → CSV for Import from CSV) and
  **`Fix_Graft_Shell_Surfaces.dsa`** (switches off the surfaces a foreign geograft
  added — switched ON — to an existing GP/DK geoshell; module `DthShellSurfaces.dsa`).
  Two HIDDEN automation twins sit beside them for the Runner:
  `.Build_Genesis_Index_Bulk.dsa` and — runtime v53 — `.Scan_Scene_Bulk.dsa`,
  the per-scene worker of Tools → **Scan project**.
- **The morph index has two halves** (v53): the BASE scan above, and a **scene
  scan** (`DthScanSceneMorphs()` in `DthScanMorphs.dsa`) that indexes what one
  saved scene adds on top — fitted clothing, hair, third-party grafts — into
  `morphs_scenes_<G>.json`, each entry tagged with the scene(s) it was found in.
  The studio merges both at read time and the Morph-name autocomplete offers a
  scene entry only while THAT scene is selected, so two outfits linked to two
  scenes no longer both suggest their "Expand All". Full rules (including why
  the two files must stay separate and why the base row runs first) in
  `.ai/gotchas.md` § the morph autocomplete reads TWO files. Since runtime v56
  the morph scans skip cameras and lights ANYWHERE in the hierarchy, not only
  at scene root — a light/camera parented into a figure or prop used to land
  its float dials in the index as morph suggestions (the node's children still
  scan).
- **Every ROM/export run SCANS its scene** (runtime v55) — how the index stays
  current through the app's CORE flow, with no Tools pass to remember. The
  generated scripts call `DthScanSceneMorphsQuiet` (and `DthScanProductsQuiet`
  when a DIM manifests folder is set — runtime v60; it used to be the per-project
  Daz Products toggle, which now only shows the tab) right after the wrong-scene guard and
  BEFORE the ROM build: the scene is pristine there, which is the truest picture
  of what it wears. Emitted by `indexSyncSnippet` from the `IndexSyncOptions`
  the web layer supplies (`api/generate.ts`), so a pure/web build emits nothing.
  Two rules hold this together:
  - **Never throws.** The run's job is the ROM + the export; a scan problem
    (unsaved scene, no Genesis figure, unwritable app-data) must not fail a
    Runner row for work that succeeded. Both `*Quiet` wrappers swallow and log.
  - **Files under the SOURCE scene**, via the `scenePath` override both scans
    now take: a ROM run's save-as repoints `Scene.getFilename()` to the
    `<stem>_ROM.duf`, and an "Export only" run opened that ROM animation to
    begin with. `dthOpenSceneFile` is the resolved source and is what gets
    passed — anything else files finds under a scene the editor never selects.
  - **…and under a generation it can always name** (runtime v68). The scan
    identifies the generation from a figure's SOURCE ASSET
    (`dthDetectGenesis` → `dthNodeAssetPath`), which in Daz Studio 4 answered
    nothing at all: every scene scanned there was skipped as "no Genesis figure
    could be found", about the figure the same run was keying morphs on. Two
    layers now: `dthNodeAssetPath` walks node → object → shape → geometry (the
    asset rides on the object — the walk the product scan already used, and it
    does resolve in DS4), and a studio-started run passes the CHARACTER's
    generation as the fallback — third argument of `DthScanSceneMorphsQuiet`,
    `genesis` per scene in the bulk sidecar. Detection still wins where it
    works; the fallback only fills a blank, and only for a value
    `dthKnownGenesis` recognises (the generation names the index file).
- **Tools → Scan project** is the one-click bulk pass: a selection of base
  morphs / character morphs / products, turned into ONE `bulk-export` batch —
  the base row first, then one row per linked scene of every character, with a
  sidecar (`dth_scan_config.json`, `scanConfigJson` in `execute-jobs.ts`) naming
  what each scene is due for. One row per SCENE, not per scene-and-kind: opening
  a scene is the slow part, so the morph and product scans share the one open.
  The job-file contract has no per-row parameters — the sidecar IS how a row is
  parameterized, and the worker looks itself up in it by `normalizeSceneKey`.
- `<name>_pose_asset.csv` — the Houdini PoseAsset CSV, written into the
  character's `.dcsmeta` folder (see **Where the app's own per-character files
  live** below) and copied into the export dir by the ROM script's export block.
- Optional: `Export_<Name>_<Genesis>.dsa` (split export), `Export_Hair_…` (one
  `<Name>_Hair_<item>_grooms.abc` per hair item of the open scene), `Scan_Products_…`
  (product scan).
- **Every per-character script leads with the wrong-scene guard** (runtime v36,
  `sceneGuardSnippet` in `dz-snippets.ts`): it embeds the character's linked
  scene paths (normalized like every other scene lookup) and refuses to run —
  error dialog; the ROM script also writes the run log — when the OPEN Daz scene
  isn't one of them (or is unsaved). An empty list (legacy/sceneless definition)
  skips the check.
- **The ROM run log is PER SCENE** (log v2, runtime v54 — `writeRunLog` in
  DthUtils.dsa, pure studio parts in `lib/rom/run-log.ts`). One
  `dth_rom_run_log.json` per CHARACTER is written by every row of a DTH Export
  batch, so the writer MERGES by scene (read → drop this scene's entry → append
  → write) instead of truncating; before v54 a three-scene batch left only the
  last scene's problems and destroyed the rest silently. Each run carries
  `scene` + `sceneName` from `Scene.getFilename()`. Consequences:
  - The studio's ingest merges per scene too (`mergeRomRunLogs`). It has to:
    ingesting DELETES the transport file, so a user who alt-tabs back mid-batch
    splits one batch across two logs — replacing would drop the first half at
    exactly the moment they looked.
  - `failedFrames` (the red row markers) is scoped to the SELECTED scene. Not
    cosmetic: a scene override reorders/inserts/deletes ROM frames, so another
    scene's frame numbers mark the WRONG rows.
  - The merge rule holds on the FAILURE paths too (runtime v65): the generated
    script's `dthWriteFailureLog` (wrong-scene abort, missing runtime,
    unexpected exception) merges per scene instead of truncating with a v1
    record, and export/CSV-delivery failures are filed into the open scene's
    RUN entry (flipping its `ok` and the batch's) — the reader flattens
    `runs[].errors`, so a top-level-only push is invisible to the studio.
  - A run with `scene: ''` (unsaved scene, or a pre-v54 log) can't be
    attributed, so it applies to whatever scene is selected — the old behaviour,
    kept so a log already on disk at upgrade time still reports.
  - Clicking a failure in the report SELECTS its scene before revealing the
    frame (route: `revealFailure`).
- **Scene overrides fold into the ONE ROM script** (runtime v32): it embeds a
  `dthSceneOverrides` map (normalized open-scene path → the few config fields that
  scene changes — a fresh `extraFrames` for a ROM override, the G9 dials for an
  identity override) and merges the open scene's delta onto `dthCharacterConfig`
  before the build. So one script serves the primary AND every outfit scene (like
  the groom map / `sceneConfigLookupSnippet` in `dz-snippets.ts`), replacing the
  old per-scene `ROM_…_<Scene>.dsa`. A **ROM**-override scene still gets its own
  `<Name>_<Scene>_pose_asset.csv` (Houdini has no runtime to select frames); the
  export block picks it by open scene (`sceneCsvLookupSnippet`). `<Scene>` =
  `sceneOverrideSlug(scenePath)` (file stem, `[A-Za-z0-9_]` only); duplicate ROM
  slugs across scenes are refused at save. The legacy per-scene scripts are swept
  on the next save/refresh.
- **Per-scene ROM overrides are implicit — arm on edit, disarm on revert, escalate on
  restructure.** Since schema v24 a `SceneOverride` record holds ONE section-keyed
  `rom` map — `rom[SECTION] = {enabled?, owned?, replaced[], added[]}` — plus `hair`
  and the presence-armed `identity`/`preserve`/`jcm`/`frameZero` blocks; every stored boolean
  gate is gone (a block/entry EXISTING is the arming — `sceneRomArmed`), and both
  layers self-prune: an entry left carrying nothing drops from `rom`
  (`updateRomEntry`, `rom-sections.tsx`), a record left carrying nothing drops from
  `sceneOverrides` (`sceneRecordEmpty`). With a non-primary scene selected the ROM
  grid edits into that record (no toggle). A **value** edit of a base row upserts
  its override copy into its section's `replaced` (green row; the controller derives
  the section from the base pose/group-id maps — the group editors stay
  section-blind); editing it back to the base *content* drops the copy again
  (`overrideCtl.upsertPose` compares with `romPoseEqual` and drops instead of
  storing) — mirroring the identity/preserve writers (`use-scene-selection.ts`),
  which keep their block present exactly while a value differs from the base.
  Appended rows live in the entry's `added` (auto-track later base edits).
  ANY other section edit the sparse layer can't hold — a **structural** row change
  (reorder / insert-between / delete a frame / add a group) OR a **config** change (mode,
  preset asset, GEN art direction, custom JCM path) — ESCALATES the section: the ONE
  writer `patchSectionForScene` (`rom-sections.tsx`) snapshots the merged section config +
  applies the patch into the entry's `owned` (the scene OWNS the whole config), clearing
  `replaced`/`added` AND the `enabled` overlay at the same key — dead sparse layers
  structurally can't linger under an owned section; `applySceneOverride` uses the owned
  config verbatim. Every config control (mode Select, preset
  picker, art-direction editor, JCM path, Add group / Import) is live on a non-primary scene
  and routes through it — so a scene can override anything in the ROM, with ONE exception:
  a **scene-gated section's enable state** (`SCENE_GATED_SECTIONS` in `rom-sections.tsx`,
  currently GEN). GEN's on/off follows the primary scene's GP/DK geograft on EVERY scene —
  derived by `primarySceneDerivation` at character create / primary relink (the geografts
  add bones and all scenes share one skeleton, which the add-scene validation enforces) —
  so its toggle is permanently disabled everywhere (`onSectionEnabledChange` no-ops as the
  backstop; a per-scene enable overlay is refused). The section's CONTENT stays
  per-scene-overridable like any other section's (e.g. a different GEN art direction per
  outfit scene). Per-field green comes
  from a merged-vs-base diff (art-direction frames, preset assets, custom path); the section
  title's `OverrideMark` reset deletes the section's whole `rom` entry (all layers live at
  that one key), plus the `jcm` block for JCM. A section's **enable/disable** stays a
  lightweight overlay (the entry's `enabled`, stored only while it differs from the base):
  `applySceneOverride` flips `enabled` LAST over whichever config (base or owned) applies,
  so a plain toggle doesn't "own"/freeze the section. The **JCM "Modify frames"** grid is
  overridable too (`sceneOverride.jcm = mods[]`, present iff it differs from the base — a
  full replacement like `preserve`). `sceneOverrideBuildsRom`
  is STRUCTURAL (merged-vs-base frame-layout signature), so an art-direction- or jcm-only
  override rides the base CSV. NB the grid value is a Daz **percentage** (`valueToPct`).
  **Hair** rides the record too (`hair: [{nodeLabel}]` — the pre-v24 character-level
  `groomScenes` map folded in; the primary scene may carry a hair-only record), and never
  arms the override (`activeSceneOverrides` ignores it).

  **Generation** (`dsa.ts`): one `buildCharacterConfig(character, romPaths, frames, …)` builds
  the full `dthCharacterConfig`; `buildSceneConfigMap` emits each scene's delta as the
  whitelist-DIFF of `buildCharacterConfig(mergeSceneOverride(…), sceneRomPaths[key],
  sceneFrames[key])` vs the base — so per-scene mode/preset/art-direction/enable all reach the
  runtime automatically (identity/preserve/jcm/frameZero stay explicit for delete-all safety). The host
  (`api/generate.ts`) resolves per-scene `romPaths`/`presetFrames` over each merged override
  (the catalog lookup + native `.duf` measurement can't run in the pure core) and threads the
  maps in. The runtime scene-lookup (`sceneConfigLookupSnippet`) is unchanged: it swaps the
  open scene's delta onto the base config by scene name, falling back to primary. That merge is
  SET-ONLY, so a scene that disables a base-enabled preset block leaves the base's block keys
  (`gpArtDirection`/`gpRomPath`/…) stale on the config — safe only because the runtime gates every
  block read behind its `bIncludeX`, which the delta carries; see `gotchas.md` before touching either.

## Character export zips (`.dcsc.zip`)

One character as one self-contained archive (Operations → Export / Import; the
project-level backup `.dcsp.zip` of backlog C18 is a DIFFERENT, larger unit).
Layout is fixed: `manifest.json` at the root (`characterZipManifestSchema` in
`lib/rom/character-zip.ts` — `format: 'dcs-character'`, its own
`formatVersion`), the character folder under `character/`, the
`.dcsmeta/characters/<folder>` files under `meta/`, avatars under `images/`.
Always packed: definition, notes, Daz scenes, Houdini projects, meta, avatars;
toggled: the regenerable `daz-export` (+ legacy `dth-exports`) and final
`exportSubdir` trees (already-compressed formats are STORED, the rest deflates
at level 1 — level-6 deflate measured "takes forever" on a real character).
Never packed: the transient `.dth_houdini_job/result` transport. Import stages
to `.dcsmeta/import-*`, validates BEFORE touching the live character — and on a
FAILURE the staging folder is deliberately PRESERVED and named in the error:
past the overwrite teardown it holds the only remaining copy of the zip's
content and the keep-captured files, and nothing sweeps `.dcsmeta/import-*`
automatically (the housekeeping sweep covers the app-data scan roots only).
A successful import removes it, then
repoints **everything path-shaped**: the definition (via
`repointCharacterPaths`), the meta records (export-folder record, execute-stamp
keys, run-log scenes, product-scan scenes — pure transforms in
`lib/rom/character-zip.ts`), avatar refs (re-keyed if the id changes), the
Houdini projects' `$JOB` + stored references (the Utils drawer's
`defaults`/`repath` hython ops, best-effort with surfaced warnings), and
regenerates the `.dsa`/CSV. An in-place link OUTSIDE the character folder keeps
its absolute path by design. The zip inside carries the character's own
`schemaVersion` and migrates on read like any definition; a too-new zip or
definition refuses with "update the app".

Two restore modes: project-level drop = wholesale NEW character (zip id kept
unless taken). Character-page import = the **overwrite wizard**
(`mergeImportedCharacter` in `lib/rom/character-zip.ts`, pure + tested): the
ENTITY persists (target id + createdAt), name editable (zip-prefilled), checked
ROM sections/extras from the zip vs. target-kept (forced all-zip across a
generation/gender mismatch; GEN plumbing always follows the zip — its scene IS
the primary now), scenes always wipe-and-replace (zip primary mandatory,
deselected zip scenes' subfolders pruned), Houdini projects add-or-overwrite.
Keep-capture carries what the teardown would lose: unchecked sections' custom
base-ROM files, add-mode `.hip`s (name collisions suffixed), and the target's
avatar/notes when the zip has none.

## The DTH runtime is studio-owned

The `.dsa` runtime (versioned by `RUNTIME_VERSION` in `types.ts`, history above it) lives
in this repo and ships with the app — there is **no external script dependency**;
only the `.duf` pose presets come from the DTH release. The runtime accepts
**inline config only**: file-based config (extra JSONs, art-direction paths) aborts
loudly with a regenerate-in-studio error. When changing generated-script behavior,
bump `RUNTIME_VERSION` — Tools → Refresh assets flags characters generated on
older runtimes as stale.

## Interrupting a run (runtime v73)

A DTH Export can be **stopped**, and the mechanism is worth understanding before
touching either leg: the studio can reach neither half of a run (Daz is driven
by a filesystem-watching plugin, Houdini is a headless hython it spawned), so
the interrupt is a **flag file** that the code the studio DOES own polls.

- The flag is `EXPORT_CANCEL_FILE` (`.dth_export_cancel`) in the character's
  `.dcsmeta` folder — per CHARACTER, so two windows exporting two characters
  don't interrupt each other. `cancelFlagPath()` (dsa.ts) is the ONE rule for
  where it is; the studio writes it (`interruptExportRun`), bakes its path into
  every carrier (`dthCancelPath`), hands it to the runtime (`config.cancelPath`)
  and to 456.py (the job's `cancelPath`).
- **Stop points**, in the order a run meets them: the carrier's entry (skips the
  whole scene), the runtime's block boundaries + its frame-apply loop (probe
  throttled to 750 ms — the flag can live on a network drive), the gate before
  the exporter, and 456.py's between-nodes check. An interrupted ROM returns
  false, so the pre-existing "only export a clean ROM" gate does the rest.
- **What cannot be interrupted**, and must never be promised: a Daz content
  load, `doExport`, the HDA's `do_export`. Synchronous calls inside someone
  else's plugin — the current one always finishes.
- **The counts of an interrupted Daz batch are meaningless.** A row whose script
  saw the flag and returned reports `done`, exactly like a row that exported —
  the Runner cannot tell them apart and neither can the studio. Hence the
  `interrupted` flag on the run (`ActiveExportRun` → the finished snapshot), the
  interrupted run's report carrying NO scene counts, and the hard rule that an
  interrupted batch never continues into Houdini. The Houdini leg is the
  opposite case: 456.py knows exactly, marks the nodes it skipped and sets
  `cancelled: true`.
- **The flag's lifetime is the studio's alone**: cleared at every handoff
  (`executeCharacterJobs`, `startHoudiniExport`) and wherever a run ends
  (both watches, abort, job-file clear). A leftover flag would silently skip
  runs — which is why every runtime that honours it also LOGS it (run log,
  progress log, console) instead of just returning.

## The exporter contract (measured, not documented upstream)

- Bone-scale frames make the DTH Exporter write per-frame reference skeletons to
  `<export dir>/Reference Skeletons/<figure>_frame_<N>.fbx`. The HDA wants
  **absolute** paths in the CSV `file` column, so the studio writes
  `{{DTH_EXPORT_DIR}}` + `{{DTH_EXPORT_NAME}}` tokens and the generated script
  substitutes the real export dir and figure name when copying the CSV next to
  the exporter output.
- The figure name handed to `doExport` is **scene-suffixed at run time**
  (runtime v40): base `exporterFigureName` + `_` + the resolved export
  subfolder, each segment's first letter capitalized ("Kira" in `summertide/`
  exports as `Kira_Summertide`; nesting `/` → `_`, `,` → space) — otherwise
  every scene subfolder holds identically-named files. The PRIMARY scene keeps
  the bare base name ("Kira", never "Kira_Primary") while still exporting into
  its subfolder — matched by scene KEY, not by the folder name "primary". The
  hair pass keeps its own `<slug>_Hair_<item>` names (unique per item
  already).
- **THREE folders are seeded into every new character** (`seedCharacterFolders`),
  each named by a per-project manifest field: `dazSubdir` (`daz3d` — the Daz
  scenes, and nothing generated), `houdiniSubdir` (`houdini` — the `.hiplc`
  files AND the `daz-export` root inside it since the export-root move; `createHoudiniSubdir`
  only gates seeding it EMPTY, the export root brings the folder into being
  either way, which is why the Settings field is no longer disabled with that
  toggle. A `houdini-project` subfolder appeared inside it until v0.68, retired
  since — see the Generate Houdini project entry), and `exportSubdir` (`export`)
  — the character's FINAL export folder, where what Houdini generates for Unreal
  lands. Generation re-creates that last one too, so characters predating the
  setting get theirs.
  DON'T confuse the two "export" folders: `<char>/<houdini>/daz-export` is the
  Daz→Houdini INTERMEDIATE (derived, fixed, studio-written); `<char>/export` is
  the END of the pipeline (user-owned — the studio only creates it, and the
  Houdini job's fallback `exportDirectory` is its natural consumer).
- The **export directory is DERIVED** (schema v29) — not user data, no picker:
  `<character folder>/<houdiniSubdir>/daz-export` (`characterExportRoot`,
  `lib/scene-subfolder.ts`), the manifest value taken straight. **It moved there
  from `<dazSubdir>/dth-exports`** (runtime v64): nothing in Daz ever
  reopens these files — the `.dth`/`.fbx`/`.abc` exist to be imported by
  Houdini — so they belong one hop from the `.hip` that reads them, and the name
  says whose output it is rather than which tool wrote it.
  That also deleted a rule: while the root lived inside the Daz folder it had to
  follow a per-character scenes-folder RENAME, so it derived from the character's
  own primary scene (`scenesRootRelOf`, now gone — a plain `dazSubdir` spelling
  made the rename half-undo itself, the save pointing `exportPath` back at the
  vanished `daz3d/dth-exports`). The Houdini folder has no per-character rename,
  so the manifest value is the whole answer.
  Created at character creation (`seedCharacterFolders`)
  and re-resolved on EVERY save, which is how pre-v29 characters migrate off
  their hand-picked path; it needs host context so it resolves in the web
  layer, never in the pure core (migration Case C). Being derived does NOT
  exempt it from `repointCharacterPaths` — a folder move that doesn't
  immediately re-save (`moveCharactersRoot`) must carry it, or a same-batch
  regenerate aims reference paths (and the `hipRefPrefixFor` computation that
  feeds them) at the old location until some later save. `exportPath: ''` survives only as "not resolved yet" (a loose
  root-level definition, or a definition read outside the desktop app).
  Exports are FLAT under it: `<exportPath>/<scene-subfolder>/`.
  The root only shares a level with SCENE SUBFOLDERS when a project points
  `dazSubdir` and `houdiniSubdir` at the same folder (both empty included), but
  `daz-export` (and the legacy `dth-exports`, real until a character's next save)
  is a RESERVED subfolder name anyway — `sceneSubfolderConflict`
  (`lib/scene-subfolder.ts`) refuses it at every place a subfolder is chosen
  (add-with-copy, replace-with-copy, the card's move/rename chip), judged on the
  first segment and case-insensitively. `rom-animations` is deliberately NOT
  reserved: it lives one level deeper, inside each scene's own subfolder, so it
  can never collide with a sibling. Any NEW subfolder-naming path must call the
  same check.
- **A relocation MOVES the already-exported files** (`migrateExportRoot`,
  api/characters.ts → Rust `move_exports`, exports.rs). Written for v29, reused
  UNCHANGED for the export-root move — which is the payoff of deriving the trigger
  from the paths rather than from a version flag: it fires while the stored path
  still differs from the derived one, which the save then fixes. Idempotent by
  construction. "Derived" MUST be the literally same `characterExportRoot(...)`
  call the save makes: while this trigger spelled the anchor differently, a
  character whose layout disagreed with the project default re-fired it on every
  save and moved its exports back and forth between two trees. What moves is
  exactly `EXPORT_FOLDERS_FILE`'s recorded folders, NEVER the whole old
  directory (the default old path WAS the Houdini folder, `.hiplc` files
  included), each losing its dead `<project>/dth-export/` prefix via
  `migratedExportFolder`. After a CLEAN carry the record is dropped (it names
  the old dir; a stale one would aim the housekeeping's delete at the wrong
  tree). After a PARTIAL carry the FAILED subset is kept in the record, still
  filed under the dir the folders physically remain in — that retained record
  is both the housekeeping guard and the retry trigger: the save repoints
  `exportPath`, so "stored differs from derived" goes false, and without the
  record the leftovers were orphaned silently forever. The retry source is
  trusted only when it matches the stored path or sits INSIDE the character
  folder (a byte-copied project's record can name the ORIGINAL project's tree),
  and `..` spellings are refused outright. Failure membership is judged by
  what is still on disk (`exists` per source), never by parsing the Rust
  failure strings.
  `fsutil::move_tree` (shared with dedup's quarantine) does the work — rename
  fast-path, cross-volume copy-then-delete, link-safe, and it never deletes a
  source without a complete copy in hand. The emptied OLD root then goes via
  `remove_dir_if_empty` — only ever when empty, so a folder still holding
  a failed move or the user's own files stays exactly where it is.
- **A relocation reaches a LIBRARY through Tools → Refresh assets, not through
  the version bump.** `migrateExportRoot` hangs off the character SAVE, which
  covers a character you open and nobody else. Refresh is the sweep that visits
  them all. A stored-vs-derived disagreement is a REGEN cause there
  (`exportRootStale` in the sweep loop): the repoint rewrites `exportPath`,
  which the generated `.dsa` BAKES, so relocating without regenerating leaves
  every installed script exporting into the vacated old root — the sweep
  therefore routes such a character through the regen path, where
  `relocateExportRoot` pairs the file move with the `storage.saveCharacter`
  that rewrites `exportPath` (either half alone is a broken state) and the
  regeneration then reads the fresh path. The skip path only RETRIES leftover
  partial carries (see the retained record above), from a fresh definition
  read, and never needs to rewrite anything. A `houdiniSubdir` change in
  Settings → Project runs the same relocate+regen pairing inline at save time.
  **A `RUNTIME_VERSION` bump does not do this and cannot.** It
  makes Refresh visit everyone, but what it triggers is REGENERATION, and
  generation reads the STORED `exportPath` — so the bump alone re-emits the old
  folder into every script and then stamps the new version over the staleness
  that brought the user there, leaving the character reading as up to date on a
  root it never moved off. The trigger has to be the stored path disagreeing with
  its own derivation. Pinned end-to-end in `export-root-migration.smoke.ts` (the
  only layer that can: vitest can't, because the migration is `isTauri()`-gated).
- **Deleting a character with a KEEP flag still drops the export root**
  (`deleteCharacter`, api/characters.ts). "Keep the Daz files" / "Keep the
  Houdini files" spare a whole subfolder, and one of them contains the export
  root — derived, regenerable, and gigabytes. It hung off `keepDaz` while the
  root lived in the Daz folder; since the export-root move EITHER flag arms it, because a
  character never saved since the move still has its exports at the old location.
  Two candidate roots therefore: the DERIVED one, and the character's STORED
  `exportPath`. The stored one is user data for anything not saved since v29
  (free directory picker), so it must pass three tests — no `..` segment
  (containment is a plain prefix compare that cannot see through traversal),
  inside the character folder, AND named `daz-export`/`dth-exports`.
  Containment alone is not enough:
  the picker's most natural pre-v29 answer was the Houdini folder itself, which
  is contained, and a `keepHoudini` delete would then have recursively removed
  the folder the flag exists to spare. Pinned in `delete-character.test.ts`,
  including that case.
- **A Houdini project generated before a relocation still names the old folder.**
  Its imports break TOGETHER, so `_repair_import_refs`' sibling donor has nothing
  to read the new location off — hence the second donor, `_relocated_donor`
  (material_utils.py): the studio passes the character's current export root as
  `exportDir` — DERIVED by `scanExportRoot` (api/houdini-material.ts) from the
  project + character scope, never taken from a caller or from the stored
  `exportPath`, so the scan and the repath cannot spell it differently — and a
  broken path is rebuilt as `<root>/<its own scene subfolder>/<its own stem>`
  (each parm probed with its OWN extension, so a node with no `.dth` filled in
  still repairs), written only when that file EXISTS.
  **Three things have to line up or the repair is unreachable**, and each was a
  real bug before it was a rule:
  1. `exportDir` reaches the **scan** too, not just the repath (`op_scan` →
     `_project_ref_info(export_dir)`). The scan runs `_repair_import_refs` dry to
     produce `refs.broken`, so without it a moved root reports NOTHING broken.
  2. `planRepath` (`houdini-defaults.ts`) counts **all three** kinds of work —
     `collapsible` + `hipRelative` + `broken` — because it is also the GATE: the
     Utils button is disabled on an empty `targets`. A moved-root project has
     only the third; a pre-v63 project has only the second.
  3. The scan CACHE key (`scanKey`, api/houdini-material.ts) includes the export
     root. A verdict about paths is not a property of the `.hip` alone, and the
     move changes every one of them without touching the file — on mtime alone
     the store keeps serving the pre-move "all resolve".
  Then it surfaces as the card's `broken-refs` badge → Utils → **Make paths
  portable**. `refs.missingTextures` rides the same scan but ends the chain
  early: it is badged and listed, and there is deliberately no repair (a missing
  Daz texture is fixed by reinstalling the product), so it is NOT counted by
  `planRepath` and never gates the button. The TS half of that chain is vitest-pinned
  (`houdini-defaults.test.ts`, `houdini-validate.test.ts`). The Python half has
  no committed test — the repo has no Python harness, `material_utils` runs only
  inside hython. `_relocated_donor` itself touches nothing but `os.path`, so it
  WAS verified ad-hoc (2026-08-09) by stubbing `hou`, importing the module and
  running it against a real temp tree: the post-move layout, a second scene keeping
  its own subfolder, a set whose `.dth` was never exported, an unrelated dangling
  path (correctly refused), a missing/absent root, backslash input, and a flat
  layout. What that does NOT cover is everything around it — `parm.eval()`,
  `unexpandedString()`, the save — so the end-to-end repair is still worth a
  **Dry run** on one real pre-move project before it is trusted.
- Schema v27's **Houdini project folder** is GONE (v29), and with it the
  `<folder>/dth-export/` nesting, `houdiniProjectResolution`, the per-scene
  override and the run-time `dthExportProj` block. The export directory owes
  nothing to Houdini now — the dependency runs the other way: a `.hip` reaches
  the exports by plain relative navigation (`$JOB/…`, below).
- **Generate Houdini project**: `generateHoudiniProject` (api/houdini.ts) →
  Rust `create_houdini_project` (houdini.rs) runs
  `<houdiniInstallFolder>/bin/hython.exe -c` to start a FRESH scene, build
  the DazToHue network BY RUNNING THE DAZTOHUE SHELF TOOL'S OWN SCRIPT
  (hou.shelves.tools — the ground truth; measured on 2.x it builds a geo
  holding the Import→Skin→…→Export SOP chain, and the assets are all
  SOP-level). Deliberately NO template scene and NO synthetic fallback — a
  template rots across versions, and a hand-built approximation is a
  non-working network that looks done; a failed/absent tool leaves the scene
  EMPTY (half-built nodes destroyed) and the UI says to click the shelf tool.
  hython gets HOUDINI_USER_PREF_DIR = the version-MATCHED Houdini docs
  folder (`lib/houdini-version.ts` pairs install `Houdini X.Y.z` ↔ docs
  `houdiniX.Y`; no match = hard error + live Settings warning) — inherited
  env resolved the prefs elsewhere and no otls loaded (measured). It bakes
  `$JOB = <character folder>` (hou.putenv — the programmatic Set Project,
  saved with the hip; the character folder since v0.64, because only a `$JOB`
  ABOVE `$HIP` lets Houdini's file picker collapse hand-picked export paths to
  `$JOB/…` and keep the project movable) and saves `<name>.hiplc` in the
  houdini folder: `houdini/<name>.hiplc`. Every one of a character's scenes
  sits in that one folder, so they share one `$HIP` and Houdini's own
  `$HIP`-relative output (render/, geo/, backup/) collects there for free.
  A dedicated `houdini-project/` subfolder (one per character, fixed name)
  was created beside the scenes until v0.68 and could never attract any of
  that output — `$HIP` is DERIVED from where the hip sits and Set Project
  sets `$JOB`, not `$HIP` — so it stayed empty; `sweepHoudiniProjectDirs`
  (api/houdini.ts) now removes the EMPTY leftovers on every generation (Rust
  `remove_dir_if_empty`, symlink-refusing, houdini.rs), and a NON-empty one
  (a pre-v0.64 project's real `$JOB` output) is kept and named in the Refresh
  assets report. `removeGeneratedHoudiniProject` deletes only the `.hiplc`.
  Generated projects (hip directly in the houdini folder) are studio-managed;
  hand-linked ones stay unlink-only. **RENAMING a project file is safe where
  moving it is not, and that follows from the anchors above**: `$JOB` (the
  character folder) and `$HIP` (the folder the hip sits in) are both FOLDER
  variables, so no baked reference names the file itself — `$HIPNAME`/`$HIPFILE`
  would, and nothing the studio writes uses them. So `renameHoudiniProject`
  (api/houdini.ts) renames in place and the caller repoints `houdiniProjects`,
  while copying stays a copy. Two rules on it: the EXTENSION is carried over,
  never assumed (`.hip`/`.hiplc`/`.hipnc` encode the licence tier — rewriting a
  commercial hip to `.hiplc` mislabels it), and the card offers the rename only
  for a project INSIDE the character folder (`insideCharFolder`, the same gate
  the Daz scenes use — the studio does not rename files in the user's own tree).
  The scan store is keyed by hip PATH, so a rename orphans the old verdict and
  the card reads unscanned until the next sweep — which the linked-set change
  kicks off immediately. That is the honest answer, not a bug to migrate around. Returns whether the network was created
  (HDA not visible to hython → empty scene, UI says "add it from the shelf");
  the UI (houdini-projects-field "Generate project" dialog, name prefilled
  `<Project>_<Character>`) links the result as a Houdini card. Fails loud
  when the scene name already exists or a prerequisite is missing.
  **The fresh network is PREFILLED** (`buildHoudiniPrefill`, houdini-jobs.ts —
  pure, unit-tested; applied by the hython script off the `DTH_PREFILL` env
  JSON, per-parm best-effort so an older HDA just skips what it lacks and
  generation can never fail on it): the CHOSEN scene's import paths
  (`import_character_{dtu,fbx,alembic,rom_fbx}_file` — the ROM FBX is the
  exporter's `<name>_experimental_rom.fbx`, measured on a real export), the
  PoseAsset CSV (`pose_asset_csv_file_path` — needs the CSV-path-driven
  PoseAsset release: absent in 2.5, shipped in the standalone
  `DazToHuePoseAsset.hda` 2.5.1, measured 2026-08-10),
  `export_directory` (TRAILING SLASH — the HDA concatenates it with the
  character name), `import_character_name` (prefilled paths may bypass the
  HDA's auto-fill), and `import_skinning_method` (`characterSkinning`'s
  dqs→`dualquat` / linear→`linear`). Paths ride the same `hipRefPrefixFor`
  prefix as the CSVs — since runtime **v66** that is `$HIP/daz-export/...` for
  the managed layout (every linked project in ONE folder with the exports under
  it), falling back to `$JOB/<houdiniSubdir>/daz-export/...` when projects are
  spread across folders or the export root sits beside rather than under the
  houdini folder — when the gate passes and the project's path style is `hip`;
  absolute otherwise.
  Two things that look like details and are not:
  - **`scenePath` picks the scene** (v0.68 — the Generate dialog's picker, shown
    only with more than one linked scene; an unknown value falls back to the
    primary). Every scene exports into its OWN `daz-export/<subfolder>/` under
    a scene-carrying name, so the pick IS the wiring: before it, a multi-scene
    character's every generated project imported the primary's set and re-aiming
    it was five hand edits. One project per scene.
  - **`export_directory` is the OTHER end of the pipeline** and must never be
    derived from the import paths. The imports READ the Daz→Houdini
    intermediates under `daz-export` (large, regenerable, not backed up);
    this is where Houdini WRITES for Unreal — the character's `export/` folder
    (the project's `exportSubdir`), resolved by the CALLER since only the host
    knows that subdir, and given its own `hipRefPrefixFor` against that folder
    so it comes out `$JOB/export/` (runtime v63; `$HIP/../export/` before it) —
    and it STAYS `$JOB` under v66's `$HIP` swap, because this one folder sits
    beside the houdini folder rather than under it, so `$HIP` cannot reach it
    without the `..` v63 removed. Houdini's own picker agrees: it writes
    `$JOB/export/` here even when `$HIP` is the preferred variable (measured).
    Until v0.68 it carried the export ROOT,
    quietly aiming Houdini's output into the throwaway tree. The Skin node's clothing-vs-body shape lists are NOT
  prefilled: they are black-boxed multiparms, the export files may not exist
  at generation time, and the node ships its own "Auto-Populate Skinned
  Shapes" button for exactly that job. Applied parms come back as the
  report's third segment (`prefilled` on `GeneratedHoudiniProject`).
- **The Unreal leg** (v0.75): the project window's footer bar links
  `.uproject` files; each card's install button opens a DIALOG, not a one-shot
  copy: DTH content (`install_unreal_dth` — the release's
  `Unreal Engine Content/DazToHue` → `Content/DazToHue`) plus every configured
  plugin build matching the project's engine version, all pre-checked, each
  installed with overwrite (a checked item IS the explicit intent the retired
  Ctrl+click used to carry; installs copy over, never delete first). The
  engine version is read from the `.uproject`'s `EngineAssociation` at
  dialog-open (`unreal_project_state`) and NEVER stored — a project can be
  retargeted in Unreal any time; a GUID association (source build) lists every
  build UNCHECKED instead, because a wrong plugin binary is a startup error in
  Unreal. Plugin sources are the `unrealPluginFolders` setting, scanned by
  Rust `scan_unreal_plugins` (a bounded 3-deep walk covering three shapes: a
  plugin folder, a folder of plugins, a multi-build root
  `…/UE_5.7/Plugins/…`). Which engine a build is FOR: the deepest PATH segment
  holding a POSSIBLE engine version wins (major `4..=9` — `plausible_engine_major`;
  a `KawaiiPhysics_5.7_1.21.0.zip` names the plugin's version too and a
  `MyPlugin_2024.1` names a year, and believing either hides the build from
  every project, since matching is by equality), falling back to the
  `.uplugin`'s own `EngineVersion` under the same rule — the path is the signal
  the user can see and fix, a stale manifest field is neither; no version
  anywhere = offered for every engine, which is the deliberately safe answer.
  Matching is TS (`lib/unreal-install.ts`): one build per plugin NAME (the
  install target is `Plugins/<uplugin stem>` — two builds of one name would be
  two writes to one folder), ranked by `buildRank` — a build whose `BuildId`
  equals the engine's beats an exact version LABEL, which beats any-engine,
  which beats a build whose BuildId proves it cannot load. Engine detection
  (`unreal_engine_installs`: HKLM `SOFTWARE\EpicGames\Unreal Engine` subkeys'
  `InstalledDirectory`; the registry can outlive an uninstall — measured on
  the dev machine — so paths are existence-probed) feeds the Settings list
  and the BuildId matching above. Creating the Unreal project itself is
  Unreal's job: the bar's ✨ Generate (a Blueprint-only skeleton bound to a
  detected engine) shipped in v0.76 and was removed one release later —
  Unreal's New Project screen owns the template decision, and a bare
  no-template project is almost never what a production wants. Linking a
  hand-made `.uproject` is the one path.
- **Running a DazToHue shelf tool is now a shared strategy, used twice.**
  `create_houdini_project` (houdini.rs) builds a network by `exec`-ing the
  `daztohue` shelf tool's own script; `op_refresh` (material_utils.py, v0.72)
  does the same with **Refresh Assets** — the vendor's answer to a `.hip` still
  carrying the asset definitions it was built with after the installed DazToHue
  release changed. Neither reimplements what the tool does: the tool's script IS
  the ground truth for that release, so both track a new DazToHue automatically.
  What that costs, and what the code therefore has to do:
  - **The exact tool label is UNMEASURED.** `_refresh_tool` matches a
    normalized label/name containing `refreshassets`, preferring a shelf whose
    own name says DazToHue, and on a miss reports the DazToHue tools it DID see
    — the same diagnosis posture as the generator's `visible` node-type list. A
    miss must be actionable, not a flat "not found".
  - **Nothing detects staleness, before or after.** A `.hip` records no DazToHue
    release, so the refresh is an ACTION on every readable project and never a
    check with a verdict (and it is excluded from the General tab's "N of 3
    checks" count for that reason). Backlog C9 wants a studio-side record of the
    release each generated project was made with; that is the only route to a
    real staleness warning.
  - **`changed` is `hou.hipFile.hasUnsavedChanges()` read after the tool ran**,
    and a project is saved only when it says yes. That is an observation about
    the scene, NOT a claim about what the third-party tool touched — the UI
    copy is worded to match, and the dry run promises "the file was not saved"
    rather than "nothing was written".
  - **Untested against a real DazToHue shelf** as of v0.72 — the smoke specs
    drive the studio's half against a fake that never runs a shelf tool.
- **The project folder is DELIBERATELY empty**, and that is
  not an oversight to fix. `hou.putenv` sets the `$JOB` VARIABLE and nothing
  else; Houdini's File → Set Project additionally materializes the standard
  skeleton (geo/render/tex/…), but that half is compiled into the GUI — `hou`
  exposes no project API whatsoever (measured: the only matches on /project/i
  are `cameraProjection` and `imageLayerProjection`), and `MainMenuCommon.xml`
  registers the menu entry as a bare `h.set_project` action ID with no script
  behind it. hython cannot invoke it, so a skeleton would have to be a
  hand-rolled folder list of ours that drifts from SideFX's. Don't. The empty
  folder is what the user wants (pre-made folders are noise), and every ROP that
  writes there creates its own output folder on first use via its Create
  Intermediate Directories toggle — the absence of an API is itself the hint
  that Houdini expects exactly that.
- **The `dth-exports` junctions are RETIRED (v0.63); what remains is the
  SWEEP.** Earlier versions planted NTFS directory junctions named
  `dth-exports` beside every linked `.hip` and inside the shared
  `houdini-project/` folder so `$HIP/dth-exports/…` paths could resolve;
  reparse points fought Perforce/backup tooling and doubled the folder in
  every file picker, so generated paths are plain-relative now — the
  `hipRefPrefixFor` gate in the bone-scale row above is the WHOLE emission
  rule, and nothing on disk backs it up. The sweep: `sweepExportJunctions`
  (api/houdini.ts) runs on **EVERY generation** through the one funnel
  (`generateCharacterFiles`), removing leftover junctions from exactly the
  places the old code created them — each `hipAnchorDirs` dir, the character's
  houdini folder, and `houdini-project/` — so existing projects shed theirs on
  the next save/refresh, no separate migration. Rust `remove_junction`
  (junction.rs) is strictly reparse-point-safe: it verifies via
  `symlink_metadata` that the path IS a junction before `remove_dir`, refuses
  a real folder (`"not-a-junction"` — the actual export root is itself named
  `dth-exports`, which was the export ROOT's own name until the export-root move — and the
  sweep deliberately keeps hunting the LEGACY name, `LEGACY_EXPORTS_FOLDER`,
  never `EXPORTS_FOLDER`, because the live root now sits in a folder the sweep
  looks in), and reports `"absent"` for nothing-there. Best-effort — a
  locked link waits for the next generation — and the removed paths surface in
  Tools → Refresh assets as "removed N leftover dth-exports junction(s)"
  (`sweptJunctions` on the generate result). The junction-CREATION code
  survives only as a test helper: the sweep's test builds one to prove
  removal never eats the target.
- **The first-Generate-project intro** (#664) was REMOVED together with the
  junction feature in v0.63 — with nothing to decide up front, the dialog is
  just the scene name again; `houdiniPathStyle` is edited in Settings →
  Project, and the machine-local `houdini-intro.json` flag is retired.
- **Which projects a scene selection involves.** A network's identity is the
  `.dth` it imports (`import_character_dtu_file`) — the studio wrote that file
  at a path it computes (`sceneDthPath`), so it names the Daz scene exactly,
  unlike a node or network-box name the user renames freely. 456.py matches on
  it at export time; the DTH Export dialog matches on the same FIELD without
  opening a `.hip` because the background scan records every project's imports
  (`materialScanProject.imports`, hython `_scene_dth_imports`, stored per
  character in `houdini-scan.json`). `hipsForSelectedScenes` (pure) turns
  "these scenes" into "these projects".
  The two sides do NOT normalize identically, and the rule is built around
  that: 456.py's `normalize()` compares through `os.path.realpath` (folding a
  mapped drive to its UNC target and the retired junction spellings old `.hip`s
  still store), while `_scene_dth_imports` uses `os.path.normpath` and
  `sceneDthPath` resolves nothing physical at all — so two spellings the RUN
  folds together can compare unequal in the dialog. Hence a project only ever
  LEAVES the run on a positive match against a DESELECTED scene. Three cases
  keep whatever is ticked instead: a project the scan has not reached, an old
  store entry (`imports: []`), and one whose imports match neither the selected
  nor the deselected scenes — that last is the spelling case, and dropping on
  it would be ignorance wearing knowledge's clothes. A wrongly-kept project
  no-ops in Houdini; a wrongly-dropped one silently skips the Houdini half of a
  run the user asked for.
- **The Houdini export handoff — "Export too" (COMPLETE).** After a Daz bulk
  export, the DazToHue export nodes in a Houdini project run for the scenes the
  user ticked. The toggle sits beside the dialog's Houdini project select,
  appears only once a project is picked, and is off by default (it drives the
  user's own Houdini). Pieces: `lib/rom/houdini-jobs.ts` (job/result contract,
  `houdiniRunStateFrom`),
  `lib/rom/houdini-runtime/456.py` + `headless_export.py` (Houdini's half),
  `api/houdini.ts` (`startHoudiniExport`/`fetchHoudiniRunProgress`) and Rust
  `launch_houdini_job`/`houdini_running` (houdini.rs).
  Both scripts are written into `<appLocalData>/houdini-scripts/` **before
  every run** — not installed once — so they are self-repairing and always
  match the app version. `HOUDINI_SCRIPT_PATH` is deliberately NOT touched
  anymore: MEASURED 2026-08-11 (first headless run), Houdini runs a `456.py`
  found there on the startup EMPTY scene too — the job was consumed against it
  ("nothing to export" in 2 s) and `closeWhenDone` exited hython before the
  project ever loaded. The bootstrap execs 456.py itself, exactly once, after
  the load.
  The run's own watch outlives the Daz batch: the batch finishes and reports,
  THEN Houdini opens (`starting` — 456.py runs only after the scene has loaded,
  which is a long silence on a big project), works (`running done/total`) and
  finishes. Liveness comes from `houdini_running`, without which a result file
  stuck at "running" after the user closed Houdini would poll forever.
  The DAZ leg has its own live channel since Runner v1.2.0: the job file
  carries `progressLogPath` (app-data `export-progress.log`, truncated at
  handoff AND at pickup) + per-row `steps`; the Runner writes the
  `[<percent>] <message>` lines it owns and the generated scripts (runtime
  v72, `dthProgressLog`) append the interior steps on the same per-scene
  scale (`jobStepsForMode`: 5/4/2). `fetchExportRunProgress` parses the log
  (`parseExportProgressLog`/`exportProgressStateFrom`, pure) into
  `running.step`; the header's `ExportPipelinePanel` renders every leg.
  **THE DISPLAY IS ONE TASK LIST + ONE BAR** (Remo, 2026-08-13 — it was a
  card column, a tail-mode log window and a two-level meter row, three
  readouts saying the same thing three ways):
  - **ONE ROW PER JOB**, built by the pure `lib/rom/export-cards.ts`
    (`dazTaskCards`/`houdiniTaskCards`/`unrealTaskCards`): a selected Daz scene
    (subtitle = `EXPORT_MODE_LABELS[mode]`, "ROM + Export"…), a DazToHue
    NETWORK (not a `.hip`), an export set going into ONE Unreal project — two
    sets into one project are two imports, so two rows. Rows carry
    `label` (the unit's own name), `detail` (what will happen to it) and
    `context` (where — the `.hip`, the `.uproject`). Finished rows STAY, ticked
    off; the list is the whole run, not what's left.
  - **ONE bar**, `runPercent(tasks, activeFraction)`: finished rows plus the
    active one's own share (Daz = the progress-log percent; Houdini = the HDA's
    phase-line count over ~9, measured on a full node run, capped at 95%;
    Unreal = a flat 0.5 while importing — it has no signal). Rows are counted
    EQUAL, which they are not (a ROM build is tens of minutes, an import is
    seconds) — nothing here can weigh them, and equal steps are at least
    predictable. With no rows at all the active fraction IS the answer.
  - **ONE status line** printed on the bar: the newest thing the run said, and
    only that (`exportProgressStateFrom` strips the `[pct]` bracket and
    `<stem>: ` prefix for display — the on-disk format is unchanged; the HDA's
    own lines keep their `Houdini; ` prefix, since they say nothing about
    where they came from). The transcript is GONE with the log window: per-leg
    full output lives on disk (Runner progress log, `.dth_houdini_console.log`,
    the Unreal editor log), which is where a post-mortem was read anyway.
  Honesty rules the rows keep: a Daz row shows no mode when the window only
  ADOPTED the run (a job file carries rows, never the dialog's choice — hence
  `ExportRunProgress.mode`, restored from the sidecar for the owner); an Unreal
  row says "Re-import"/"First import" only from the send plan's own probe
  (`UnrealSendPlan.located`, refined by `startUnrealImport`'s per-set
  `existing`), and a plain "Import" when nobody looked.
  The scripts log step START markers too ("generating ROM", …) at the
  already-reached percent. No mid-run toasts: the one report fires at the very
  end.
  Both live buttons are INERT to a plain click (a stray one used to drop the
  watch, reading as "the export vanished"); the way out sits beside them as
  **Interrupt** (see "Interrupting a run" below), which stops the run itself
  and drops the queued Houdini projects with it. Until v0.77 each button hid a
  modifier-revealed hatch instead — Ctrl → Abort / Stop watching — that stopped
  the STUDIO and let the run carry on; both went when a real stop existed, and
  the leftover-file case they also served lives in Settings → App Data.
  RELOAD SURVIVAL: every character handoff writes its plan to the app-data
  sidecar `export-run.json` (characterId, startedAtMs, houdiniProjects/mode,
  scenes, the Daz `mode`, the Unreal targets/sets; deleted on every run end).
  The owning character's editor passes its id as `fetchExportRunProgress`'s
  watcher and RESTORES the full watch from the sidecar after a reload — clock,
  rows (re-armed from the run's `rows` + plan) and the Export-too continuation,
  which previously died silently with the window's memory. Non-owners get display-only adoption, itself rebuilt
  from disk (`rows` + the progress log). The Runner must never learn of the
  sidecar — it rewrites the job file from its own model, so anything stored
  IN the job file beyond the v1.2.0 contract would be dropped at pickup.
  Contract: docs/exporter-plugin-job-file.md.
  **The HOUDINI leg has its own sidecar**, and needed both halves the Daz one
  didn't: `.dth_houdini_run.json` BESIDE the job/result files it describes (per
  character — an app-data singleton would let a second character's leg
  overwrite the first's) carrying the current project, the queue behind it, the
  scene scope, the start time and the report so far; plus a MOUNT-TIME probe,
  because that watch's poll is armed only while something is already being
  watched (`pending || progress || houdini`), so nothing would ever ask.
  `adoptHoudiniRun` re-arms `activeHoudiniRun` from the recorded paths (owning
  character only, and only while a job or result file still exists) and the
  editor rebuilds the queue, the report and the cards from the plan. Without
  it a reload during that leg was INVISIBLE — headless, so no window either:
  hython finished, the studio never reported it, and every queued project
  silently never started. The plan dies with the run (finish, dead, or a
  Ctrl-stop), and a continuing queue writes a fresh one when its next project
  arms. Ordering is the CHAIN's job, not the call site's (`queuePlan`, the twin
  of the Daz sidecar's `queueSidecar`): the finish path awaits its clear before
  the queue advances, but a Ctrl-stop's clear is fired from a synchronous UI
  handler and would otherwise still be in flight when the user starts the next
  run — deleting that run's plan. Reads join the queue too, so an adopt can
  never restore a run the user just stopped watching.
  What a restored window inherits is PRE-FORMATTED lines (`carried` on the run
  report), never entries in the `houdini` array: that array's LENGTH is "how
  many Houdini projects have finished" and drives the task rows, so folding
  the inherited Daz line into it marked the RUNNING project's row done the
  moment a restore landed. `toBeVisible` cannot see that — a finished row stays
  in the list — which is why the smoke asserts `data-task-status` instead.
  Mid-NODE the result also carries a live `activity` channel: 456.py's
  `ActivityCapture` tees `sys.stdout`/`stderr` + `hou.ui.setStatusMessage` while
  `do_export` runs and streams the lines (throttled 0.5 s, rolling 40) into the
  polled file — the studio's only window into the minutes-long synchronous call;
  each node's report entry keeps a capped `log` tail. WHAT the HDA actually
  emits there is unmeasured until the first live run — the capture is
  deliberately broad so that run is the probe; nothing emitted = the chip just
  shows elapsed time.
  MEASURED on the first live run (2026-08-03): 456.py fires BEFORE the main
  window paints, and inline work there holds the window back — the whole batch
  ran against a blank screen and Houdini "opened" only after the last node.
  The batch is therefore DEFERRED to the first event-loop idle
  (`hdefereval.executeDeferred`, 456.py's `launch()`) plus a Qt single-shot
  breather (`STARTUP_BREATHER_MS`) so the viewport finishes its first cook —
  textures included — before `do_export` hogs the main thread. Sessions
  without the module (hython) run inline — no window to wait for.
  Chosen shape was **visible GUI + a startup script reading a job file** (not
  `hrpyc` remote control), mirroring the Daz Runner handoff — **flipped to
  HEADLESS hython 2026-08-11** (Remo's call, reversing his earlier
  watch-it-happen preference once the live progress chip covered it): the
  studio now runs `hython headless_export.py`, which loads the `.hip`
  (`DTH_HOUDINI_HIP`) and runs `456.py` inline (`DTH_HEADLESS` — explicit,
  because an hdefereval import that succeeds without a UI event loop would
  defer the batch into a callback that never fires). Wins: the whole
  window/paint fragility class is gone, and the process's FULL console (C++
  cook chatter the in-process tee can't see) streams into
  `.dth_houdini_console.log` beside the job/result files — and deliberately
  NOT cleared with them (`houdiniRunFilesToClear` lists only the result and
  the job): it is the diagnosis channel a puzzling run is read from
  afterwards, and one bounded file per character — overwritten by the next
  run, never accreting — IS the retention the housekeeping rule asks for.
  The first headless run proved the point by deleting the answer.
  MEASURED 2026-08-12: the log's first real job was a **licensing** failure —
  headless hython needs a license of its own, and on a machine that cannot
  reach its license server (`hserver -l` shows the SideFX CLOUD server;
  `sesictrl print-license` times out) it dies instantly with *"No licenses
  could be found to run this application"*. The studio saw only "the process
  is gone" and reported "Houdini is no longer running" — true, useless, and
  contradicted by the file it had just written. `houdiniDeathReason` (pure,
  houdini-jobs.ts) now reads that log on the DEAD path only and puts its
  headline in the toast; licensing is special-cased because it is the one
  failure that says nothing about the project, the scene or the studio.
  The read is deliberately NARROW, because this file is the whole console: the
  licensing match and the fallback both look at the last 40 lines only (an
  informational "license server" line at startup must not relabel a crash an
  hour later), the fallback quotes only a line that looks like an error, and a
  log longer than 8 lines that ends in cook chatter yields NO reason at all —
  the bare "no longer running" is the honest answer there. Which condition
  counts as dead lives in ONE place, `houdiniRunLooksDead`, because the api
  layer must know it before calling `houdiniRunStateFrom` (it decides whether
  to spend the file read) and a second copy would drift silently. Liveness is the
  TRACKED child (`try_wait` in houdini.rs — immune to the Utils drawer's own
  hython scans) and, once this process has tracked a launch, its answer is
  FINAL: an exited child means dead, never "ask the process list". Falling
  through there would answer "alive" for the user's own open Houdini — this
  audience keeps one open — and a hython that died mid-run would leave the
  result file at "running" and the poll spinning forever. The GUI list is the
  fallback only when no launch was ever tracked (an app restart). The GUI path itself
  still works (456.py's scene-load mechanism + window-wait machinery remain);
  "Open only" still opens the visible GUI via `openScene`. Without
  `DTH_HOUDINI_JOB`, 456.py does nothing at all.
  Networks match scenes by the **`.dth` path**: a `DazToHueImport` stores it in
  `import_character_dtu_file`, and the studio WROTE that file — an identity that
  survives a renamed network, which a name match would not. A project may hold
  several networks; only those importing a selected scene are touched.
  Measured off the installed HDA (all of it recorded in `456.py`'s docstring —
  read that before touching this): `export_trigger` is the button on both
  `DazToHueExport` and `DazToHueGroomExport`; the HDA builds its path as
  `export_directory + character_name + "/"`, a naive concat, so a directory the
  studio writes MUST end in a slash; `do_export` bails via `exit()` on an empty
  directory (SystemExit would kill the whole batch, so such a node is skipped
  before triggering); it shows a "Continue anyway?" dialog on pre-flight
  problems, which the studio answers YES and RECORDS (never swallows) — those
  recorded problems ride the `finished` state out to the toast, which is their
  ONLY surface; and there is NO PDG anywhere, so `do_export` is synchronous and
  sequential is just one call after another. A node's existing
  `export_directory` is respected — only a blank one is filled from the job —
  and the scene is never saved.
  **The instance closes itself when the batch is done** (`closeWhenDone` in the
  job, always set by `startHoudiniExport` — never by "Open only", which takes a
  different path entirely): after the FINAL result flush, 456.py calls
  `hou.exit(suppress_save_prompt=True)` from inside the instance it ran in — a
  user's own Houdini session is never touched, and the save prompt must be
  suppressed or an unattended exit hangs on a dirty scene (a cook alone can
  mark it dirty). The poll is exit-safe by construction: a result whose state
  is `done`/`failed` maps to `finished` in `houdiniRunStateFrom` regardless of
  liveness, so reading the file after Houdini exited reports normally.
  **The handoff clears its own files** (`houdiniRunFilesToClear`, pure): job +
  result both go the moment the poll reaches `finished`/`dead`, since the state
  snapshot already carries everything reported. The one condition is on the JOB
  file — it may only go once a result exists, which PROVES 456.py read it; a
  `dead` verdict with no result can be a Houdini the liveness probe hasn't seen
  yet, and deleting the job under it would break the run it is about to pick up
  (an unconsumed job is simply overwritten by the next run).
- **`$DAZ3D_LIB` houdini.env wiring**: with a Daz library + Houdini docs
  folder(s) configured, `DAZ3D_LIB = "<library>"` is upserted into each
  folder's `houdini.env` (`storage/houdini-env.ts` — pure `upsertHoudiniEnvVar`
  edits ONLY that assignment line, preserving the rest + CRLF). Ensured on
  every Settings save (best-effort) AND by Refresh assets (reported in the
  summary). Never removed — a cleared library folder leaves the last value.
  Houdini reads the file at startup.
- **The delivered CSV is renamed on delivery** (runtime v40): the run-time
  copy writes `<dthExportName>_pose_asset.csv` — the export set's own
  scene-suffixed base (primary: bare) — so one export folder never mixes
  naming patterns. SOURCE CSVs in the character folder keep their studio
  names (`poseAssetFileName`, scene-sluged only for ROM-override scenes) —
  the scene-CSV lookup picks the right SOURCE, the rename names the
  DESTINATION. `sceneExportName` (dsa.ts) is the studio-side mirror of the
  run-time name rule; the export watch builds its expected paths from it.
- **ROM-scene auto-save** (runtime v40): after a CLEAN ROM build — before any
  export — every ROM-building script (ROM_, .Bulk_ROM_Export) saves the scene
  as `<stem>_ROM.duf` into `<sceneDir>/rom-animations/`, so the built ROM
  animation reopens without a rebuild. Bounded: fixed name, overwritten per
  run. `romAnimationPath` (dsa.ts) is THE rule, shared by generation and the
  host, and both read `ROM_ANIMATIONS_FOLDER` — the folder name is ONE constant
  now, because a drift between the emitted `.dsa` and the host's path means the
  studio stats a file Daz never wrote. Renamed from the hidden
  `.ROM_Animations` in **runtime v48** (it holds scenes the user OPENS, so
  hiding it was wrong; the name matches the other studio folders, `daz-export`).
  `migrateRomAnimationFolders` (api/generate.ts) renames an existing one beside
  each linked scene on the next generation — idempotent, and it refuses to
  merge when BOTH folders exist. `LEGACY_ROM_ANIMATIONS_FOLDER` exists only for
  that rename; nothing writes it. FOOTGUN: the save-as REPOINTS `Scene.getFilename()` — every scene-keyed
  lookup (subfolder/groom/CSV snippets, and the wrong-scene guard since v46)
  reads the `dthOpenSceneFile` capture (`openSceneFileSnippet`, emitted once
  per carrier) instead of the live filename; a new scene-keyed snippet must do
  the same.
- **DTH Export runs in one of three Daz MODES** (the dialog's first step; the
  `ExportMode` union in `execute-jobs.ts` owns the mapping):
  `rom-export` → `.Bulk_ROM_Export.dsa` on the source scene (fresh ROM, saved
  ROM animation, full export — the default, and the ONLY mode that writes
  handoff stamps: a stamp claims "this definition has been exported");
  `rom-only` → `.Build_ROM_Animation.dsa` on the source scene (no export, so no
  export dir needed); `export-only` → `.Bulk_Export_Only.dsa` on the scene's
  **saved ROM animation** (exporter + hair over the ROM as it stands, no
  rebuild — for a ROM hand-edited in Daz). Export-only pre-checks the scenes
  whose ROM animation is newer than their delivered `<exportName>_pose_asset.csv`
  (`fetchExecuteScenes`'s `romUnexported`), i.e. unexported as it now stands.
  The Daz Mode dropdown's FOURTH option, `houdini-only` ("Skip Daz — use last
  exports"; `RunChoice` union, same file), is deliberately NOT an
  `ExportMode`: it writes no Daz job at all — the Houdini selection runs
  directly, the standalone version of the after-batch continuation. Its
  per-scene gate is `exportExists` (the delivered `.dth` at `sceneDthPath` is
  on disk); the `.duf` is NOT consulted (Houdini reads the export, not the
  scene, so a missing `.duf` doesn't disable the row there), and the Runner
  gate doesn't apply (no Daz plugin in the path).
- **The DTH Export dialog is ONE page**: two card lists — "Daz scenes" and
  "Houdini projects" (multi-select) — each with its own **Mode** dropdown.
  Houdini modes (`HoudiniRunMode`, execute-jobs.ts): `open` (single-project
  only — `houdiniModeForSelection` flips to `export-selected` when a second
  project is picked), `export-selected` (the default; scoped by the checked
  scenes) and `export-all` (every linked scene). Projects come AUTO-SELECTED
  whenever the probe pre-checks scenes — approximated as ALL linked projects,
  because no studio-side scene↔hip map exists (it lives inside the `.hip`;
  456.py only exports matching networks, so uninvolved projects no-op).
  Multiple selected projects run SEQUENTIALLY (`startHoudiniQueue` in
  dth-export.tsx, remaining projects on a ref): the Houdini job/result files
  are per-character singletons, so two live runs would clobber each other —
  project n+1 starts only when n's watch reports finished (a dead Houdini
  drops the queue; clicking the progress button stops the WATCH and with it
  the studio-driven queue, which the button's tooltip says out loud).
  EXCEPT under `rom-only`: that run writes no fresh `.dth`, so an export
  continuation would re-consume the PREVIOUS exports while the report reads
  as "the new ROM reached Houdini". ROM only therefore never auto-selects
  projects and only `open` is legal — `hipSelectionAfterToggle`
  (execute-jobs.ts) makes the project checkbox a radio there, the dialog
  disables both export modes, and `executeCharacterJobs` throws on any other
  combination as the loud backstop.
- **A saved ROM animation stands in for its source scene** (runtime v46): since
  export-only job rows OPEN `rom-animations/<stem>_ROM.duf`, every generated
  script embeds `romAnimationSourceMap` (rom path → source scene) and resolves
  `dthOpenSceneFile` through it right after the capture. So the guard and every
  scene-keyed lookup behave as if the source scene were open — which it
  effectively is. Running ANY generated script on a ROM animation by hand works
  the same way now (it used to abort as a foreign scene).
- **Export-folder housekeeping**: every generation records the layout's
  export-relative folders in `.dth_export_folders.json` (the character's
  `.dcsmeta` folder) and
  deletes RECORDED folders that fell out of the layout — a renamed/cleared
  project folder can't leave its old tree behind. `staleExportFolders`
  (execute-jobs.ts) is deliberately conservative: same export dir only, plain
  relative paths only (no `..`/absolute — tamper-safe), parents of kept
  folders survive, failed deletes stay recorded for retry. Clearing
  `exportPath` deletes nothing (those are the user's last exports), it only
  drops the record.
- **The Unreal-side `.dth` is a JSON manifest naming its own outputs**
  (MEASURED on three real exports, `dth_version` 2.5): keys `character_name`,
  `skinning_method`, `source_skeleton`/`target_skeleton`, and the collections
  `skeletal_meshes` (each `{file, materials, name}` — `file` is the ABSOLUTE
  path of `<export>/<Character>/Skeletal Meshes/SKM_<Character>.fbx`),
  `animation_curves` (`{file, type}`, `.txt`), plus `cloth_panels`,
  `cloth_panel_proxies`, `detached_props`, `collision_proxy` and `pose_assets`
  — all EMPTY in every export seen here, so their shapes are unknown.
  `dthExportFiles` (unreal-jobs.ts) therefore walks the whole manifest for
  strings ending in `.fbx` instead of reading `skeletal_meshes`: it costs
  nothing and covers the sections nobody has measured. Not to be confused with
  the Daz-side `.dth` under `daz-export/`, which names the Daz→Houdini
  intermediates the HDA READS.
- **A Houdini run NAMES its networks before it exports them** (456.py's
  `targets` in the result file: node path, scene, and the title of the network
  box around it). The task rows are one per network, and could previously only
  label the ones already finished — everything ahead read "Network 2" where the
  user had a name. The box title wins: a multi-network project's nodes are all
  `DazToHueExport`, `…1`, `…2`, and the box comment (NOT `name()`, which is an
  internal id) is the only human-meaningful label the setup has — the same rule
  the scan's `_network_box_label` measured. An older 456.py sends no targets,
  and then only finished networks can be named, which is the pre-existing
  behaviour rather than a guess.
- **A character has EXPORT SETS, not "an export".** `<export>/<name>/DTH_<name>.dth`,
  where `<name>` is the HDA's `character_name` parm — the USER's, not the
  studio's. Measured: `LaraCroft_G81` has `LaraCroft`, `LaraClassic` and
  `LaraNaked`, none of them the character's name. So `unrealExportSets`
  (api/unreal-import.ts) SCANS for them; the earlier
  `DTH_<character.name>.dth` guess found nothing on the first real character.
  One job carries every set (`imports[]`), because the handoff is a single job
  file and a second write replaces a pending one — but the run's TASK LIST
  still shows one row per set, because that is one import each.
- **A Houdini project declares the export SETS it writes** (`exportSets` on the
  project scan — each export node's `character_name`, which the HDA
  concatenates onto `export_directory`). Read in the scan pass beside
  `imports`, because opening a `.hip` is the expensive part and it is already
  open. Empty = NOT KNOWN (an unscanned project, or a scan entry stored before
  the field existed) — never "writes nothing", and the dialog's `runSets`
  collapses to `null` on one unknown project so every rule falls back instead
  of concluding the run produces nothing. Without it "does this Unreal project
  have what THIS RUN makes?" was unanswerable and the pre-selection asked "does
  it have ANY set of this character?" — which ticked a project for a run about
  to export a variant it had never seen.
- **The DTH Export dialog's third leg** (`unrealProjects`): selected Unreal
  projects ride the Daz run record AND the Houdini run plan — the send fires
  when the whole Houdini queue drains, minutes later, possibly in a reloaded
  window, so both sidecars carry it or a reload drops it silently. Pre-selection
  is `fetchUnrealSendPlan`, which is `locateSets` (see the entry below) run once
  per linked project: NOT a `Content/DazToHue/<set>` existence check — the whole
  point is that it finds a set the user MOVED. A project is ticked when it holds
  a set THIS RUN will write (`runSets`), never merely a set of this character.
  The studio cannot read an editor's asset registry from out here, so a set
  whose assets were RENAMED reads as absent — un-ticking a row the user can
  tick, never ticking one they didn't mean.
  Two rules the dialog enforces on top, both earned: a **rom-only** run is not
  sendable at all (it writes no export, so the send could only hand over the
  previous one while the run reads as this ROM reaching Unreal), and a ticked
  project with NO ticked export set refuses Start rather than starting a run
  whose Unreal leg silently does not exist.
- **The STUDIO decides where a re-import lands, not the bridge.** MEASURED
  2026-08-13, first real end-to-end run: the bridge's asset-registry lookup
  (`get_tag_value('AssetImportData')`) found nothing and imported a second copy
  into `/Game/DazToHue/LaraClassic`, beside the `/Game/Characters/Lara` the user
  already had. The match DATA was never missing — the `.uasset` header names
  exactly the FBX the job carries:

      SKM_LaraClassic.uasset → RelativeFilename ".../export/LaraClassic/Skeletal Meshes/SKM_LaraClassic.fbx"

  So the API call was the weak link and the filesystem is not. `locateSets`
  (api/unreal-import.ts) BFS-walks `Content/` for `*_<set>.uasset` (every asset
  the pipeline creates is `<PREFIX>_<set>`), maps `Content/X/Y` → `/Game/X/Y`
  via `unrealContentPath`, and the job (`UNREAL_JOB_VERSION` 4) carries that as
  `destination` + `existing: true`. The bridge then imports where it is told;
  its registry search survives only as the fallback for `existing: false`.
  Measured cost on the real project: 195 folder reads, capped at 2000.
  It always imports the **`.dth`**, never the FBX files directly — the `.dth`
  is what triggers mrpdean's pipeline (materials, curves, post-process ABP);
  the file list is for FINDING assets, not for importing. Two folders holding
  one set (a leftover duplicate) makes the pick arbitrary — first found wins.
- **Housekeeping's orphan GCs** (app launch + "Clean up now",
  api/maintenance.ts): per-project `.dcsmeta` character dirs + avatars, and —
  since the deferred-findings pass — per-character SCRIPT dirs in the Daz
  library (`Scripts/DTH-Character-Studio/<project>/<character>/`), the
  app-external counterpart of the in-app character delete (it also mops the
  old-name dir a mid-rename generation failure leaks). The library sweep's
  gates, stricter than app-data because it reaches the user's territory: only
  DIRECTORIES inside a KNOWN project's folder (recents is the registry — an
  unknown project folder can belong to a machine that never opened here and is
  never touched; the shared runtime at the root is files, never candidates),
  live-character sets are UNIONED per sanitized folder name (two projects can
  legitimately share one), and per project the same strict pre-walk +
  zero-problem scan as the meta GC (an unreadable definition is a character
  that EXISTS, not one whose scripts are orphaned).
- **A byte-copied project re-mints its manifest id on first open of the new
  path** (api/projects.ts `remintCopiedProjectId`): the app-data product-scan
  store (`product-scans/<manifest id>/<character id>/`) keys on that id, so a
  copy otherwise cross-pollinates scan rows with the original forever. The
  already-known path is presumptively the ORIGINAL and is never re-minted (it
  owns the store); a MOVED project — old path dead — keeps its id. Residual,
  deliberate: two copies both opened before this shipped are both in recents
  and stay collided until one is deleted/re-created.
- **Cross-window recents writes go through a native compare-and-swap**
  (`write_text_file_if_unchanged`, fsutil.rs — one process-wide lock; every
  window shares the one Tauri process): another window's interleaved write is
  a 'conflict' + re-read + re-apply here, never a silently dropped registry
  entry. The command is generic on purpose — `assets.json`'s per-window queue
  is the next candidate if its cross-window gap ever bites.
- No export directory set ⇒ the ROM is still fully generated; ticked Bone scale
  rows are a harmless no-op (no validation links the two).
- The export block ALWAYS nests each run under the open scene's own subfolder
  (runtime v37; the old `exportSceneSubfolders` toggle is gone — schema v26):
  an embedded map — normalized scene path → the scene's folder name below the
  scenes root (`sceneExportSubfolders` in dsa.ts; the primary's is "primary") —
  with the scene-file STEM as the run-time fallback for unmapped scenes. The
  scenes root is HOST-resolved (`deriveScenesRootRel`, web
  `lib/scene-subfolder.ts` — one rule shared with the scene cards UI and the
  scenes-folder move) and threaded through `generateAll`. Every linked scene
  lives in its own subfolder since v26 (primary → "primary" at creation,
  extras seeded from the sanitized scene name, never empty); the Refresh sweep
  physically moves legacy root-dwelling scene files into subfolders
  (`ensureSceneSubfolders`, api/generate.ts — host-side, file moves can't be a
  pure migration step).
- `referenceFrames()` (generate.ts) hands the exporter the same absolute frames
  the CSV references — the 1:1 mapping is test-pinned.
- **Bulk runs** (runtime v40): every job-file row points at the character's
  hidden `.Bulk_ROM_Export.dsa` (`BULK_ROM_EXPORT_SCRIPT`,
  `toBulkRomExportScriptDsa` — the combined script with `exportWithRomScript` +
  `exportHairAssets` FORCED on; generated whenever an export dir is set,
  dot-prefixed so the Content Library hides it, swept when the dir clears).
  It always builds the ROM and always exports everything; the toggles govern
  only the visible per-character scripts. The v38 `bulk-export` script
  argument is RETIRED — arguments passed through `DzScript::execute` never
  reached `getArguments()` (measured; the Runner now executes plainly). The
  job file (contract v2) is JSON — `{version, type, progress, jobs[]}`, plus a
  Runner-written `jobsDone` (Runner v1.1.1+; the reader derives it from the row
  statuses when absent) — with
  ONE bulk-script row per scene (docs/exporter-plugin-job-file.md). Lifecycle:
  the Runner RENAMES it (`running_` prefix) on pickup — the "started" signal;
  only an un-renamed file is abortable (deletion) — then OWNS `progress` +
  per-job statuses inside the file. The studio (api/execute.ts) polls the
  renamed file, shows "Exporting n%", deletes it at progress 100 and toasts
  the outcome (failed rows + errors); a running file whose Daz exited below
  100 is a dead run (cleaned + reported). No export-folder watching anymore —
  the old delivered-CSV mtime watch is gone.
- **A claimed batch's leftover file is HOUSEKEEPING, not a run control.**
  "Only an un-renamed file is abortable" is the CONTRACT's rule (the Runner
  owns the file after its rename) — it was never a rule about the user, who
  can be left with a spinning button and a blocked handoff when a batch stalls
  inside a live Daz (a modal in the way, a Runner that died mid-batch). The
  hatch is `clearExporterJobFiles()` (api/execute.ts: deletes BOTH names,
  settles both before throwing, drops the in-memory `activeRun`), reached from
  **Settings → App Data** (the readout + its signature-guarded confirm, #775).
  It had a twin on the character page until v0.77 — Ctrl on the live progress
  button — retired with the arrival of a real Interrupt: what it ends is the
  STUDIO's watch and the block on the next handoff, never the run, and a
  Runner that is genuinely working carries on and can even rewrite the file on
  its next row. Say that in the UI rather than implying the run was stopped.
  No stamp rollback either (unlike `abortExporterJobs`): a claimed batch may
  already have exported scenes, and re-flagging those as never handed off
  would describe work that DID happen as work that didn't. A status poll can
  straddle the delete — `fetchExportRunProgress` re-checks `activeRun` is
  still ITS captured run before calling a vanished file a dead run, so the
  losing poll reports nothing instead of toasting a sticky "run died" over a
  deliberate abort.
- **Every script handed to the Runner must run UNATTENDED — no modals, ever.**
  The Runner executes job rows inside a Daz that is often minimized, so any
  `MessageBox` is an invisible dead stop: the row never completes, the batch
  sits below 100 and the studio's watch spins forever. Since the unattended
  launches MINIMIZE Daz themselves (`DazLaunchVisibility`, `api/execute.ts` →
  `minimize_app_window`), "often" is now "by default, whenever the studio
  started it" — this rule got stricter, not looser. Learned on
  Build_Genesis_Index (#653), where even the final SUMMARY box would have held
  a successful build below done. The pattern: the visible Content-Library
  script keeps its dialogs (that path is interactive on purpose); the handoff
  gets a hidden dot-prefixed **bulk twin** (`.Build_Genesis_Index_Bulk.dsa`,
  runtime v52 — installed by `HIDDEN_ROOT_SCRIPTS` in
  storage/runtime-install.ts) whose runtime entry point takes a `bulk` flag:
  questions resolve to their safe default (the Runner's row runs in a fresh
  empty scene per the contract — nothing to lose, nobody to answer), summaries
  `print()` to the Daz log (the studio panel owns the outcome toast), and
  failures **`throw`** so the Runner marks the row `failed` + `error` and the
  studio toasts the reason — a bulk failure must never end as a silent success.
  Any NEW handoff (bulk morph/product scans, future Tools jobs) follows this
  law, and the handoff self-heals the install first
  (`copyRuntimeFiles(scriptsRoot)` — marker-skipped when current) so the
  button works right after an app update.
- **The shared export watch is single-consumer** (api/execute.ts): the
  in-memory `activeRun` scopes the ONE global job file to the feature that
  armed it, and `fetchExportRunProgress(watcher?)` is DESTRUCTIVE on a
  finished/dead run — it deletes the file, drops the watch and returns the one
  outcome snapshot, so exactly one caller may consume an outcome (the owner
  toasts it; everyone else only displays). Character editors adopt
  `characterId: ''` — "someone's batch is live: show busy, never toast". A run
  that belongs to NO character carries a **sentinel** characterId —
  `PROJECT_SCAN_RUN` (`'#project-scan'`, Tools → Scan project; it absorbed the
  retired `'#genesis-index'` run when the two panels merged) — and is
  consumed ONLY by the caller passing that sentinel as its `watcher`; every
  mismatched watcher/run pairing (an editor's mount/focus refresh during an
  index build, the Tools panel polling during a character export) is served
  the display-only `''` adoption instead, so no stray refresh can eat another
  feature's outcome. The rule is stated ONCE for all of them — any
  `'#'`-prefixed characterId is a sentinel — so a new no-character batch is a
  new sentinel constant + exactly one owning panel that passes it, with no
  further casing in `fetchExportRunProgress`. Handoff writers never clobber a LIVE batch
  either: all four (executeCharacterJobs, generateRomAnimation,
  openSceneInRunningDaz, startProjectScan) refuse while a sub-100 `running_`
  file exists and Daz is up, and sweep only a finished (100) one —
  executeCharacterJobs additionally recovers a DEAD one (sub-100, Daz gone),
  same as the watch. startProjectScan reuses the ~10s claim-wait when Daz was
  already "running": an unclaimed handoff (Daz shutting down, or no Runner
  polling) is taken back — file deleted, watch dropped, error reported — never
  left pending forever; while a handoff waits un-renamed the Tools panel
  offers Abort (`abortProjectScanRun` — no stamps to roll back), and the
  panel gates on `fetchExportRunnerGate` exactly like the export dialog. It
  also writes its sidecar BEFORE the job file: the Runner can claim the batch
  the moment the job file appears, and a row that beat its own config would
  fail for nothing.
- **Runner gate**: the export dialog blocks Start while the installed Runner
  DLL is missing or OLDER than the bundled one (`runnerGate` in
  storage/releases.ts, `fetchExportRunnerGate`), deep-linking to Settings →
  General (`/settings?tab=general`). The installed version is read from the
  DLL's VERSIONINFO (the runner carries one since v1.0.3); "up to date" stays
  a byte-compare. A NEWER installed runner, or an unreadable state, never
  blocks.
- **`type: 'open-scene'` (contract v3) is the second job kind** — one row, NO
  script, used to open a scene in a Daz that is ALREADY running (a forwarded
  command-line open is dropped once a scene is loaded) and to raise its window,
  which the studio can't do itself: Windows blocks `SetForegroundWindow` from a
  background process. For this type only, the Runner must skip its end-of-batch
  `newEmptyScene()` — the scene staying loaded IS the feature. **The `type`
  field is the capability handshake**: a Runner that predates a type rejects the
  file as foreign and never renames it, so `openSceneInRunningDaz`
  (api/execute.ts) writes the job, watches ~10s for the rename, and on
  non-pickup takes the file back and falls back to the old "Daz is already
  open" dialog. Deliberately NOT gated on the installed version the way the
  export dialog is (`runnerGate`, above): the handshake already self-describes,
  and an open that quietly degrades to the previous behaviour beats one blocked
  behind an update prompt. One global job file + one batch at a time, so an
  open-scene request is REFUSED while an export batch is pending or genuinely
  running.

## PoseAsset CSV eras & templates

Ground-truth exports live in `packages/rom/src/templates/`: G9 (2.0-era CURVE
tail) and G8.1 (pre-2.0 CTL tail) spliceable templates + the fixed G9 physics
block. Generation **splices** custom rows into the template at
`CUSTOM_SECTIONS_PLACEHOLDER` when a validated template exists
(`poseAssetCsvValidated`); otherwise it emits custom-only rows flagged
`experimental`. The CSV is the only artifact whose format depends on the installed
DTH release (`poseAssetCsvEra`, `POSEASSET_CSV_BREAKING_VERSIONS = ['2.0']`).

Per-generation capability (figure base, strength dials, template, measured base
frame counts) lives in the `GENERATIONS` table in `types.ts` — G9 and G8.1 have
validated templates; G8/G3 ship partial support (custom-only fallback).

## Hard rules

- **Never rewrite users' downloaded Daz assets.** Dedup/install may only MOVE
  redundant copies (quarantine) or choose which version installs.
- **MIS rows must have an empty `file` column** — anything else is an
  AttributeError in the HDA import.
- The Daz side says **"hair"**, the Houdini/Unreal side says **"groom"** — keep
  user-facing wording consistent per side.
