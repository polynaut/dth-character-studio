# Domain — ROM, artifacts, invariants

Part of the domain reference — `.ai/domain.md` is the index.

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
| **Morph floor / dialed-walked gate** | Every pose morph sawtooths: keyed to `value` on its own frame, back to `0` on the neighbours — the floor is ALWAYS `0` (schema v34 / runtime v82). The per-morph `base`/`autoBase` floors (v31–v33, autoBase on by default) are RETIRED, for a measured reason: **the DTH Exporter's FBX pass excludes every morph whose ROM keys VARY from the base mesh** (see `.ai/gotchas-daz.md`), so a non-zero floor shipped a shaped alembic base against an unshaped FBX base — the drift the HDA's validation view shows — and shrank every HDA-generated morph to the leftover headroom (spike − floor) instead of the full range. The replacement is a fail-loud GATE with TWO legs: `checkDialedWalkedMorphs` (DthUtils.dsa) covers frameDatas — right BEFORE the frame-0 reset (which would zero the evidence), it reads every walked dial's frame-0 scene value; any \|value\| > 0.001 files a `failedMorphs` entry PER walking FRAME — value named, ERC-driven flagged ("zero the CONTROLLING dial") — so the export gate skips the export and the studio report marks the frames red with the reason. GP/DK **art-direction** morphs never enter frameDatas (they key through `applyArtDirectionData` → `createMorphFrame`, same 0 floor), so that function runs the same per-dial check itself (`dialedWalkedVerdict`), reading each dial at first encounter BEFORE keying it and still applying the morph. Both legs run for real in the sandbox harness (`dialed-walked-gate.test.ts`). The build continues: one report names every offender. The intended workflow: a walked morph's dial is 0 in the export scene, and its shape reaches Unreal through the HDA-generated morph. Runs after the frame-0 morphs apply (v74 order), so a frame-0 morph that is ALSO walked is caught — that combination drifts like any dial. `morphJson` emits node/prop/value only. |
| **Art direction** | Named override frames inside the GP/DK preset blocks (e.g. `VaginaOpen` @ GP frame 96) carrying their own morph values (`ART_DIRECTION_CATALOG`). |
| **JCM morph mods** | Rules riding custom morphs along the shipped joint-corrective bends: per bone/axis, a signed `drives[]` list (angle range → value range; the **sign of the angle extreme picks the bend direction**). Split into runtime `positive[]`/`negative[]` by `jcmMorphModForRuntime` at generation. |
| **Bone scale** | Per-pose flag (`boneScaleRef`) marking a morph that scales bones. Only meaningful in **GEN and FBM** (`REFERENCE_FBX_SECTIONS`) — a reference path on a MIS row breaks the HDA import. The CSV carries `{{DTH_EXPORT_DIR}}/Reference Skeletons/{{DTH_EXPORT_NAME}}_frame_<N>.fbx`; the generated `.dsa` resolves both tokens at CSV-copy time, `{{DTH_EXPORT_DIR}}` via **`dthRefDir`** — the run-time export dir, or (per-project `houdiniPathStyle` on `hip`, the default — the app-global Settings key of the same name is LEGACY pre-v0.61, kept only so old settings.json files still parse, `storage/settings.ts`) **`$HIP/daz-export/<scene subfolder>`** (runtime v66; `$JOB/<houdiniSubdir>/daz-export/…` in v63–v65, `<dazSubdir>/dth-exports` before v64) — a prefix swap on the absolute export ROOT so the resolved scene subfolder rides along. Whether project-relative paths are emitted at all is **HOST-decided** (the pure core just obeys the `hipRefPrefix` argument, `''` = absolute): `generateCharacterFiles` computes it via **`hipRefPrefixFor`** (`lib/scene-subfolder.ts`), which needs at least one linked project, all of them inside the character folder, and the export root inside it too — then picks the anchor in TWO tiers (v66): **`$HIP/<rel>`** when every project shares ONE folder and the export root sits under it (the standard layout since v64 put `daz-export` inside `houdini/`), else **`$JOB/<rel>`**, which encodes no depth and so still serves projects spread across folders or an export root beside the houdini one. The `$HIP` tier restores an anchor-COUNT gate — `$HIP` names the `.hip`'s own folder, so two anchor folders are two different `$HIP`s — but only to CHOOSE the tier, never to fall back to absolute. Anything else — no project yet, a hand-linked `.hip` in the user's own tree (its `$JOB` is whatever the user set), an export root outside the character folder, or style `absolute` — yields `''`. **`$HIP` where it reaches, `$JOB` where it cannot (runtime v66).** `$JOB` IS the character folder: scene state saved with the `.hip` (`hou.putenv`, the programmatic Set Project), baked by `create_houdini_project` since v0.64 and repairable from the Utils drawer. `$HIP` is the folder the `.hip` sits in, DERIVED rather than stored, so it cannot drift the way `$JOB` does. **The anchor question is settled by measuring Houdini, not by preference** (`hou.text.collapseCommonVars`, the call behind the HDA's file picker — re-measured on a real project 2026-08-10): `<char>/houdini/daz-export/…` → `$HIP/daz-export/…`, `<char>/export/` → `$JOB/export/`. v63 chose `$JOB` because the exports then sat BESIDE the houdini folder, reachable only as `$HIP/../…` — which encodes the scene's DEPTH, so a project one folder deeper broke every path. v64 moved them INSIDE it, which retired that `..` and with it the reason; v66 follows the picker again. `$JOB` keeps everything `$HIP` cannot express without climbing out (`<char>/export`, pre-v64 layouts) and every character whose projects are spread across FOLDERS, where no single `$HIP` exists. **Verified live 2026-08-08** (v63): a freshly generated project came out with every import, CSV and export path reading `$JOB/…` and resolving in Houdini. **Verified in hython 2026-08-10** (v66) against a real project: root priority `$HIP`→`$JOB`→`$DAZ3D_LIB`, `_collapse_ref` sending daz-export to `$HIP/…` and `<char>/export` to `$JOB/…`, `_shorten_job_ref` rewriting the v63–v65 form on DazToHue nodes only, and `_rehome_hip_ref` unchanged. Still unmeasured, both eras: the `hip-relative` badge appearing on a pre-v63 project, and a full generate→open round trip under v66. Pre-v63 projects keep `$HIP/../…`: flagged by `validateHoudiniProject`'s `hip-relative` check and rewritten by Utils → Make paths portable (`_rehome_hip_ref`). v63–v65 projects keep `$JOB/…`: NOT flagged (it resolves — badging it would teach the eye to ignore the badge), only shortened by the same action (`_shorten_job_ref`). |
| **Frame-0 morphs** | "Morphs set at frame 0" (schema v28, runtime v44; since the v35 preserve-morphs retirement it sits at the TOP of the character page's **Advanced options** panel, where the retired list sat — no longer a panel of its own): a name+value list (`frameZeroMorphs` → `config.frameZeroMorphs`) the runtime sets + keys at frame 0 — with an EMPTY `node` on EVERY figure-tree node carrying the name (figure, geografts, fitted clothing — one clothing "Expand All" row reaches every outfit piece of the open scene; with no other keys the value holds across the whole ROM). A row's `node` (schema v32 / runtime v74, matched by internal name OR label like `applyKeyData`, filled by the autocomplete pick) narrows it to that one item — needed because auto-follow puts a figure FBM's twin dial on every conformed item under the SAME name, so a broadcast fit value meant for one bag deformed the whole outfit (the 2026-08-14 `FBMExpandAll -100%` report). Deliberately UNVALIDATED — no morph scan needed, a scene without the morph (or the scoped node) skips it with a Daz-log warning, never a run-log failure. Per-scene `sceneOverride.frameZero` = presence-armed full replacement like `preserve`. **Ordering (v74):** frame-0 morphs apply at the very START of the build (before every preset block — the close-out baseline reads scene state and must see them). Code-derived consequence: a frame-0 morph that is ALSO a posed morph loses its value to `resetFrameDatasAtFrame`, which re-keys frame 0 to 0 over it (the sawtooth floor is always 0 since v82). The sibling "Preserve morphs after ROM loading" list retired in schema v35 / runtime v83 — the targeted DTH release holds those values across the ROM load itself. That premise turned out G8-only (the G9 base ROM `.duf`s carry explicit zero keys, see `.ai/gotchas-daz.md`), so runtime v101 replaced the manual list with the automatic `restoreZeroedDials` pass: after all preset blocks, a root-figure dial whose pre-ROM RAW baseline (`memorizeRawDials`, getRawValue — ERC shares stay out, so driven halves are never candidates and a restore cannot double-apply) is non-zero and whose post-load keys are ALL ~0 (zeroed flat, never walked) gets every key flattened back to that baseline. `preserveNodeTransforms` (memorize-before / restore-after) is unchanged. |
| **Groom / hair** | Daz-side it's "hair", Houdini-side "groom". Hair is ALWAYS per scene by presence: a scene's `groomScenes` items ARE its hair, none listed → nothing excluded. The generated script hides them for the ROM export (hide-only, needs Exporter Plugin ≥ 2.0.1 = `MIN_GROOM_EXPORTER_VERSION`), and a separate `Export_Hair_…` script exports EACH hair item of the open scene ON ITS OWN (runtime v33) as `<Name>_Hair_<item>_grooms.abc` — for every item it hides the other wearables (incl. the other hair items) and exports just that one, so Houdini gets one alembic per hair asset. Whether the DTH Export flow RUNS that per-item pass for a scene is the per-scene **"Export hair items"** switch (schema v37 `sceneOverrides[].exportHair`, runtime v96; the Daz scene cards' **Scene utils** drawer, `daz-scene-utils-panel.tsx`): absent = default (primary ON, extras OFF), stored only while the choice differs, resolved by `sceneHairExportEnabled` (ONE rule for the switch and dsa.ts's embedded `dthHairExportByScene` gate). The switch is AUTO-decided on every hair-list change of a non-primary scene (`autoExportHair`, web `lib/groom-detect.ts` — the editor's list edit AND the add-scene seeding route through it): hair differing from the primary's — even partly — arms it, a full match (or an emptied list) clears it back to the default; the manual switch holds only until the next hair edit re-decides. Each scene card's badge row shows the effective state as a hair glyph (`Waves`, lit/dimmed — third row, before the PRIMARY badge). It gates ONLY the export pass — the hide bracket keeps hiding, and the standalone `Export_Hair_…` script stays ungated as the manual escape hatch. The switch is ALSO what DTH Export's **"Hair items only"** mode (`hair-only`, runtime v97) lists by: its panel shows only the switch-on scenes and runs the hidden `.Bulk_Hair_Export.dsa` — the same per-item pass, unattended, nothing else (see domain-exporter.md's mode bullet). A newly linked scene gets its detected hair PRE-SELECTED by one shared rule — `seedSceneHair` (`lib/groom-detect.ts`) — at all five places a scene reaches a character: creation, the first primary link, Add scene, REPLACE primary, and the missing-primary RELINK. The relink is the SAME scene at a new path, so it first REPOINTS an existing record to the final path (like a move/rename — `repointLinkedScene`) and seeds only a record-less target; a record keyed on the dead old path would never match the scene again. Any new scene-linking path must call it. |
| **Figure detection** | The native `scene_wearables` (`poses.rs`) also returns the scene's base **`figure`** node (the non-conformed node whose id/name starts with "Genesis"). The pure inverse `genesisFromFigureNode(id)` (`types.ts`, the reverse of `genesisFigureNode`) maps `Genesis9` / `Genesis8_1Female` → generation (+ gender for the gendered gens; null for G9). The **create-character dialog** uses it to auto-select Genesis + gender from the picked scene's contents (best-effort, both fields stay editable) — reading what's IN the scene, not guessing from its filename. The **add-scene dialog** validates a candidate EXTRA scene from the same read (`scene-compat.tsx`, "Validation" table): same generation (+ gender where the figure id carries it), exactly ONE figure root (`figures`), an EMPTY animation timeline (`animationFrames` ≤ 1 — the ROM script fills the timeline itself), and the same GP/DK geograft set as the primary scene (gender's closest proxy, matched over the conformed items' id/label). A definite fail blocks Add behind an explicit "Add anyway" switch; an unreadable scene degrades to unchecked and never blocks. The **create-character dialog** runs the character-independent subset (`sceneCreateRows`: one figure root + empty timeline) behind a "Create anyway" switch. The same read also DRIVES two character fields via `primarySceneDerivation` (never continuously): the **GEN section's `enabled`** (on ⟺ the scene carries a GP/DK geograft; its editor toggle is permanently disabled; re-derived by the missing-primary relink flow) and the **gender** (figure id for the gendered gens, geograft for the neutral G9 — DK → male, GP → female; a G9 BOTH-grafts scene also sets `presetAssets` to GP+DK explicitly, since the gender-based auto default would include only one block). Gender is applied by `createCharacter` ONLY — **baked at creation, nothing changes it afterwards** (the relink flow deliberately applies just the GEN part). The manual Gender fields are gone — the create dialog shows it read-only and the Identity row is display-only. **REPLACING the primary is gated on the character having NO extra scenes** (`daz-scene-field.tsx`: the card's replace button is rendered-but-disabled with the reason as its tooltip, and `onReplacePick`/`applyReplace` both re-check). Every extra was validated against the CURRENT primary — above all `geograftRow`, since each scene must produce the primary's skeleton — so swapping the primary re-decides that reference and a GP-less replacement would leave validated extras silently mismatched. Re-validating and unlinking failures automatically is worse than making the user unlink and re-add, which runs the real per-scene validation. The missing-primary RELINK flow (`onPick`/`applyLink`, offered only when the primary FILE is gone) deliberately bypasses this gate: there is no primary left to compare a replacement against and the character must become openable again, so it swaps `scenePath` and re-derives GEN while the extras stay linked unchecked — the accepted escape hatch for the mismatch the replace gate forbids. |
| **Scene override** | A per-EXTRA-scene delta (`sceneOverrides` on `Character`, schema v17; **presence-armed** since v24 — there is no stored boolean, a block EXISTS iff it overrides). Five armable panels: **ROM** (one section-keyed `rom` entry per section — `owned` = the section's full config, else the sparse `replaced` (by base pose **id**, content swaps, frame stays) + `added` (appended at group ends; `flatSectionGroupId` covers flat sections with no stored group), `enabled` overlaid last), **identity** (G9 FACS-detail/flexion/tear-UV), **preserve** (own `nodeTransforms`), **jcm** (replaces `jcmMorphMods`), **frameZero** (v28, replaces `frameZeroMorphs`) — the last three are FULL replacements, emitted even when empty so a scene can clear the base list. **hair** rides the record by presence and never arms it (a hair-only record, e.g. the primary scene's, must not activate an empty override), and so does `exportHair` (v37, the "Export hair items" switch — `sceneRecordEmpty` counts it, `activeSceneOverrides` ignores it). `applySceneOverride` merges ROM; `mergeSceneOverride` yields the scene's effective character (ROM sections + jcm). `activeSceneOverrides` (any panel armed + scene still in `extraScenes`) is THE single gate; `sceneOverrideBuildsRom` narrows to the ROM subset that also mints a scene-suffixed CSV; `sceneRecordEmpty` prunes a record that means what NO record means. Unlinked overrides keep their data; their files retire on the next save. |

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

The playbar **RANGE** is the same story one value later (v0.86). The Import
node sets the playbar from the Alembic FILE itself when it loads one — mrpdean
shared the node's own Python (2026-08-19): read the Alembic SOP's
`Alembic SOP Info` rows for `Start Frame`/`End Frame`,
`hou.playbar.setFrameRange(fstart, fend)`, force-cook
`alembic_import_hack/alembic_cache`, `hou.setFrame(0)`. Unlike the FPS the
right value is not the studio's to state — it is whatever the project's own
Alembic answers (and those Start/End rows are frames AT THE CURRENT FPS, so
the FPS write comes first and re-times them). The studio reproduces the
routine in two places that must stay in step: the tail of
`create_houdini_project` (houdini.rs — generation re-runs it deliberately,
because the `.dth` callback is best-effort and skipped when the export hasn't
run) and `_apply_alembic_timeline` (material_utils.py — `op_defaults` beside
`$JOB`/FPS). The Alembic SOP is found by TYPE (`alembic` with a `fileName`
parm) with the vendor's named path preferred; `op_scan` reports both sides as
`timeline` (each with its own `known` flag — a project with no Alembic yet is
UNKNOWN, never wrong); `validateHoudiniProject` badges `timeline-differs`;
`timelineRangeDiffers` (houdini-defaults.ts) is the ONE comparison shared by
badge, Defaults row and repair queue. NOT yet verified in a live hython run —
`hou.playbar.*` headless is per docs, and the info-tree read needs a non-forced
cook first (both marked in the code).

## Generated artifacts (per character)

`generateAll()` (`packages/rom/src/generate.ts`) returns `{fileName, content, target: 'daz'|'houdini'}`:

- `ROM_<Name>_<Genesis>.dsa` — self-contained apply script: inline `config` object
  → `include(dthRuntimeDir + "/.DthWorkflow.dsa")` (normally resolved two levels
  up from the script's own folder, falling back to the baked install root — see
  the v84 entry in `schema-history.md`) → `ApplyDTHCharacter(config)`. Installed to
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
  `.ai/gotchas-web.md` § the morph autocomplete reads TWO files. Since runtime v56
  the morph scans skip cameras and lights ANYWHERE in the hierarchy, not only
  at scene root — a light/camera parented into a figure or prop used to land
  its float dials in the index as morph suggestions (the node's children still
  scan).
- **Every ROM/export run SCANS its scene** (runtime v55) — how the index stays
  current through the app's CORE flow, with no Tools pass to remember. The
  generated scripts call `DthScanSceneMorphsQuiet` (and `DthScanProductsQuiet`
  when a DIM manifests folder is set — runtime v60; the per-project
  Daz Products toggle only shows the tab) right after the wrong-scene guard and
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
  - **The merge is why a starting run RETIRES the previous report** — and why
    it retires it PER SCENE, on disk as well as on screen (`api/run-log-store.ts`,
    a leaf module so `api/execute/jobs.ts` stays out of an import cycle through
    `characters.ts` → `generate.ts`). Without it the merge folds the last run's
    failures into the new run's report, and the character page's focus refetch
    re-raises the old red banner (and the red morph rows) while the new run is
    still working.
    - **The rule is one function** — `scenesRetiredByRun(mode, scenes)` in the
      pure `execute-jobs.ts` — read by BOTH halves, so the report on screen and
      the report on disk cannot disagree: the disk half is
      `clearSceneRunLogs(metaDir, …)` from the handoff, the screen half
      `useRomRunLog().forgetScenes` from `DthExportAction`'s `onExported`.
    - **A run retires the scenes it RE-RUNS, and no others.** A DTH Export batch
      is a user-made selection and "Generate new ROM" (`generateRomAnimation`,
      the scene card's menu → `DazSceneField`'s `onRomRebuildStarted`) is one
      scene; wiping the log would throw away findings for scenes that have
      nothing coming to rewrite them, because nothing is going to re-run them.
      Keying by the SOURCE scene is correct because `ApplyDTHCharacter` writes
      the run log BEFORE the generated script's save-as repoints the open scene.
    - **Plus the untagged `''` entries** (a v1 log, or a run from an unsaved
      scene) on any ROM-rebuilding batch: they name no scene, so no future run
      can ever replace them — left alone they pin the report through every clean
      run from then on.
    - **`export-only` retires NOTHING.** It rebuilds no ROM: the verdict it
      would be deleting still describes the ROM it is about to export — the
      failed-morph rows included — and a clean export writes no run log to
      replace it with (the export carrier only touches the log on failure, see
      `dthExportLogProblem`). The cost is that a repeated export failure appends
      its message again; that is what main did too, and it beats losing the ROM
      report over a run that changed nothing.
    - `dropSceneRuns` returns the same object when no named scene has an entry —
      the "nothing changed" signal both the store (skip the write) and the hook
      (keep the memoized ROM subtree) rely on. It drops an `unreadable` log
      whole (a broken FILE, not a scene).
    - Both handoffs clear BEFORE the job file lands, not after: a Daz that is
      already up polls for that file and can be writing its own run log within
      the second. The cost is `generateRomAnimation`'s two-window race — the
      window that loses `assertHandoffOwned` has already retired the scene it
      never got to run.
    - The finish report is unaffected either way — `scriptRunFailures` only
      counts entries written since the handoff.
  - The red row markers match by MORPH IDENTITY — `morphKey` = `node|prop`
    (`lib/rom/run-log.ts`) — never by the log's frame numbers: frames are
    recomputed from row order on every edit, so a stored frame describes the
    ROM as it was when the run happened, and frame matching kept a POSITION red
    through deletions/reorders (whatever morph moved into it). Scoped to the
    SELECTED scene (`failedMorphKeysByScene` → `failedMorphKeysForScene`, the
    normalizing accessor): a failure is a per-scene fact — the dialed-walked
    gate reads the dial values of the scene the row RAN in, so the primary's
    "dialed at 0.089" says nothing about an extra scene's grid, and the brief
    unscoped version (#880) kept the THICK scene red over rows its run never
    accused (2026-08-18). An UNTAGGED run (unsaved scene / pre-v54 log, scene
    `''`) can't be pinned on a scene and marks every grid — the honest
    fallback. The report card can therefore sit over an all-clean grid when a
    non-failing scene is selected; its copy says "with the reporting scene
    selected", and clicking a failure switches to that scene first — via
    `matchLinkedScene`, because the log carries Daz's `Scene.getFilename()`
    spelling (forward slashes) and `selectScene` honors only the character's
    STORED spelling: a raw `selectScene(run.scene)` silently no-oped back to
    the primary, and under per-scene scoping that left the clicked failure's
    red rows unreachable.
  - The contract identity matching rests on: `logRunFailedMorph` call sites
    must log the definition's VERBATIM `node`/`prop` (keyDatas carry them
    verbatim — `nodeName: morph.node` — as does the art-direction path). An
    entry logged from display labels (`setPropertyByName`, used only for the
    workflow options, logs `oNode.getLabel()`) silently never marks a row.
  - The merge rule holds on the FAILURE paths too (runtime v65): the generated
    script's `dthWriteFailureLog` (wrong-scene abort, missing runtime,
    unexpected exception) merges per scene instead of truncating with a v1
    record, and export/CSV-delivery failures are filed into the open scene's
    RUN entry (flipping its `ok` and the batch's) — the reader flattens
    `runs[].errors`, so a top-level-only push is invisible to the studio.
  - Scene attribution still matters for the REPORT (findings are listed under
    the scene that produced them — the frame numbers it shows are per scene)
    and for the reveal jump: clicking a failure SELECTS its scene first (route:
    `revealFailure` — an override-added row only exists in its own scene's
    grid), then scrolls to the first row walking that morph. A run with
    `scene: ''` (unsaved scene, or a pre-v54 log) names no scene, so it reveals
    in place.
  - **Four channels, and the split is the export gate** (runtime v79):
    `errors` + `failedMorphs` are counted by `runLogProblemCount`, so they make
    `ApplyDTHCharacter` return false and the generated script skip the export;
    `warnings` and `keyProblems` are NOT — they are reported and stepped over.
    File under `warnings` only what leaves the exported artifacts correct. The
    studio renders the report on errors OR warnings (amber when the export ran,
    red when it did not), so "reported" never means "invisible": the failure
    that forced the split was a row marked `done` that exported nothing.
    `keyProblems[]` carries the individual keys the interpolation pass could not
    stamp — node path, dial, key index, frame, and what Daz reports instead of
    LINEAR — capped per kind by the runtime, with exact counts in the message.
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
  **Hair** rides the record too (`hair: [{nodeLabel}]`; the primary scene may
  carry a hair-only record), and never
  arms the override (`activeSceneOverrides` ignores it) — same for the
  per-scene `exportHair` switch (v37; see the Groom/hair row above).

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
  block read behind its `bIncludeX`, which the delta carries; see `gotchas-core.md` before touching either.

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
