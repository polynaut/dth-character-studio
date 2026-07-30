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
| **Art direction** | Named override frames inside the GP/DK preset blocks (e.g. `VaginaOpen` @ GP frame 96) carrying their own morph values (`ART_DIRECTION_CATALOG`). |
| **JCM morph mods** | Rules riding custom morphs along the shipped joint-corrective bends: per bone/axis, a signed `drives[]` list (angle range → value range; the **sign of the angle extreme picks the bend direction**). Split into runtime `positive[]`/`negative[]` by `jcmMorphModForRuntime` at generation. |
| **Bone scale** | Per-pose flag (`boneScaleRef`) marking a morph that scales bones. Only meaningful in **GEN and FBM** (`REFERENCE_FBX_SECTIONS`) — a reference path on a MIS row breaks the HDA import. |
| **Frame-0 morphs** | "Add morphs on frame 0" (schema v28, runtime v44): a name+value list (`frameZeroMorphs` → `config.frameZeroMorphs`) the runtime sets + keys at frame 0 on EVERY figure-tree node carrying the name (figure, geografts, fitted clothing — one clothing "Expand All" row reaches every outfit piece of the open scene; with no other keys the value holds across the whole ROM). Deliberately UNVALIDATED — no morph scan needed, a scene without the morph skips it with a Daz-log warning, never a run-log failure. Per-scene `sceneOverride.frameZero` = presence-armed full replacement like `preserve`. |
| **Groom / hair** | Daz-side it's "hair", Houdini-side "groom". Hair is ALWAYS per scene by presence (no more `groomMode` — removed in schema v20): a scene's `groomScenes` items ARE its hair, none listed → nothing excluded. The generated script hides them for the ROM export (hide-only, needs Exporter Plugin ≥ 2.0.1 = `MIN_GROOM_EXPORTER_VERSION`), and a separate `Export_Hair_…` script exports EACH hair item of the open scene ON ITS OWN (runtime v33) as `<Name>_Hair_<item>_grooms.abc` — for every item it hides the other wearables (incl. the other hair items) and exports just that one, so Houdini gets one alembic per hair asset. A newly linked scene gets its detected hair PRE-SELECTED by one shared rule — `seedSceneHair` (`lib/groom-detect.ts`) — at all three places a scene reaches a character: creation, the first primary link, and Add scene. It was inlined at the first two and missing from the third, so added outfit scenes (the ones that most often bring their own hair) silently started empty. Any new scene-linking path must call it. |
| **Figure detection** | The native `scene_wearables` (`poses.rs`) also returns the scene's base **`figure`** node (the non-conformed node whose id/name starts with "Genesis"). The pure inverse `genesisFromFigureNode(id)` (`types.ts`, the reverse of `genesisFigureNode`) maps `Genesis9` / `Genesis8_1Female` → generation (+ gender for the gendered gens; null for G9). The **create-character dialog** uses it to auto-select Genesis + gender from the picked scene's contents (best-effort, both fields stay editable) — reading what's IN the scene, not guessing from its filename. The **add-scene dialog** validates a candidate EXTRA scene from the same read (`scene-compat.tsx`, "Validation" table): same generation (+ gender where the figure id carries it), exactly ONE figure root (`figures`), an EMPTY animation timeline (`animationFrames` ≤ 1 — the ROM script fills the timeline itself), and the same GP/DK geograft set as the primary scene (gender's closest proxy, matched over the conformed items' id/label). A definite fail blocks Add behind an explicit "Add anyway" switch; an unreadable scene degrades to unchecked and never blocks. The **create-character dialog** runs the character-independent subset (`sceneCreateRows`: one figure root + empty timeline) behind a "Create anyway" switch. The same read also DRIVES two character fields via `primarySceneDerivation` (never continuously): the **GEN section's `enabled`** (on ⟺ the scene carries a GP/DK geograft; its editor toggle is permanently disabled; re-derived by the missing-primary relink flow) and the **gender** (figure id for the gendered gens, geograft for the neutral G9 — DK → male, GP → female; a G9 BOTH-grafts scene also sets `presetAssets` to GP+DK explicitly, since the gender-based auto default would include only one block). Gender is applied by `createCharacter` ONLY — **baked at creation, nothing changes it afterwards** (the relink flow deliberately applies just the GEN part). The manual Gender fields are gone — the create dialog shows it read-only and the Identity row is display-only. |
| **Scene override** | A per-EXTRA-scene delta (`sceneOverrides` on `Character`, schema v17; per-panel gates since v20): four independently-armed panels — **ROM** (`enabled` + `poses`/`additions`: replaced rows keyed by the base pose's **id**, content swaps, frame stays, + additions appended at group ends; `flatSectionGroupId` covers flat sections without a stored group), **identity** (`identity.enabled` + G9 FACS-detail/flexion/tear-UV), **groom** (no override gate — hair is per scene by presence via `groomScenes`, never a `sceneOverride` field), **preserve** (`preserve.enabled` + own `morphs`/`nodeTransforms` — a FULL replacement of the base preserve lists, emitted even when empty so a scene can clear them). `applySceneOverride` merges ROM; `mergeSceneOverride` yields the scene's effective character (ROM sections + identity dials). All gates default OFF, so a fresh scene starts fully disabled; arming identity/preserve seeds from the base. `activeSceneOverrides` (any panel armed + scene still in `extraScenes`) is THE single gate; `sceneOverrideBuildsRom` narrows to the ROM subset that also mints a scene-suffixed CSV. Disabled/unlinked overrides keep their data; their files retire on the next save. |

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

## Generated artifacts (per character)

`generateAll()` (`packages/rom/src/generate.ts`) returns `{fileName, content, target: 'daz'|'houdini'}`:

- `ROM_<Name>_<Genesis>.dsa` — self-contained apply script: inline `config` object
  → `include('../../.DthWorkflow.dsa')` → `ApplyDTHCharacter(config)`. Installed to
  `<Daz library>/Scripts/DTH-Character-Studio/<project>/<character>/`; the shared
  **DTH runtime** (`.DthWorkflow.dsa`, `.DthUtils.dsa`, …) is co-installed once at
  that root (`copyRuntimeFiles` in `apps/web/src/lib/rom/storage.ts`), along with
  the two VISIBLE user-run scripts + their Content Library artwork:
  **`Build_Genesis_Index.dsa`** (builds the stock figures of every generation and
  scans them into the per-generation morph + bone index behind the autocompletes)
  and **`Scan_Frames.dsa`** (open scene's keyed frames → CSV for Import from CSV).
- `<name>_pose_asset.csv` — the Houdini PoseAsset CSV, written next to the
  character JSON and copied into the export dir by the ROM script's export block.
- Optional: `Export_<Name>_<Genesis>.dsa` (split export), `Export_Hair_…` (one
  `<Name>_Hair_<item>_grooms.abc` per hair item of the open scene), `Scan_Products_…`
  (product scan).
- **Every per-character script leads with the wrong-scene guard** (runtime v36,
  `sceneGuardSnippet` in `dz-snippets.ts`): it embeds the character's linked
  scene paths (normalized like every other scene lookup) and refuses to run —
  error dialog; the ROM script also writes the run log — when the OPEN Daz scene
  isn't one of them (or is unsaved). An empty list (legacy/sceneless definition)
  skips the check.
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

## The DTH runtime is studio-owned

The `.dsa` runtime (versioned by `RUNTIME_VERSION` in `types.ts`, history above it) lives
in this repo and ships with the app — there is **no external script dependency**;
only the `.duf` pose presets come from the DTH release. The runtime accepts
**inline config only**: file-based config (extra JSONs, art-direction paths) aborts
loudly with a regenerate-in-studio error. When changing generated-script behavior,
bump `RUNTIME_VERSION` — Tools → Refresh assets flags characters generated on
older runtimes as stale.

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
- The **Houdini project folder** (schema v27, `houdiniProjectFolder`) nests the
  whole export under `<exportPath>/<folder>/dth-export/<scene-subfolder>/` so
  Houdini Set-Project's `<exportPath>/<folder>` and imports via
  `$JOB/dth-export/…`. Resolved at RUN time (`houdiniProjectResolution` in
  dsa.ts): per-scene override map (presence-based like hair — '' is a real
  value, "this scene exports flat"; hasOwnProperty, never truthiness) →
  base → '' = the flat pre-v27 layout, emitted byte-identically. NEW
  characters seed `<Project>_<Character>` (`defaultHoudiniProjectFolder`, the
  create flow); existing ones stay '' — their layout must not move. The export
  watch (`expectedSceneCsvRel`) mirrors the same resolution.
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
  `$JOB = <exportPath>/<houdiniProjectFolder>` (hou.putenv — the
  programmatic Set Project, saved with the hip) and saves `<name>.hiplc` in
  the houdini folder NEXT TO the project folder (which is seeded with its
  dth-export/): `houdini/<name>.hiplc` + `houdini/<folder>/dth-export/`.
  Generated projects (hip directly in the export dir) are studio-managed:
  the remove dialog's "Keep houdini files" toggle (default on = unlink only)
  can delete the scene file + the whole project folder
  (`removeGeneratedHoudiniProject`, path-guarded); hand-linked projects stay
  unlink-only. Returns whether the network was created (HDA not visible
  to hython → empty scene, UI says "add it from the shelf"); the UI
  (houdini-projects-field "Generate project" dialog, name prefilled
  `<Project>_<Character>`) links the result as a Houdini card. Fails loud
  when the scene name already exists or a prerequisite is missing.
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
  as `<stem>_ROM.duf` into `<sceneDir>/.ROM_Animations/`, so the built ROM
  animation reopens without a rebuild. Bounded: fixed name, overwritten per
  run. FOOTGUN: the save-as REPOINTS `Scene.getFilename()` — every scene-keyed
  lookup (subfolder/groom/CSV snippets) reads the `dthOpenSceneFile` capture
  (`openSceneFileSnippet`, emitted once per carrier) instead of the live
  filename; a new scene-keyed snippet must do the same.
- **Export-folder housekeeping**: every generation records the layout's
  export-relative folders in `.dth_export_folders.json` (character folder) and
  deletes RECORDED folders that fell out of the layout — a renamed/cleared
  project folder can't leave its old tree behind. `staleExportFolders`
  (execute-jobs.ts) is deliberately conservative: same export dir only, plain
  relative paths only (no `..`/absolute — tamper-safe), parents of kept
  folders survive, failed deletes stay recorded for retry. Clearing
  `exportPath` deletes nothing (those are the user's last exports), it only
  drops the record.
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
  job file (contract v2) is JSON — `{version, type, progress, jobs[]}` — with
  ONE bulk-script row per scene (docs/exporter-plugin-job-file.md). Lifecycle:
  the Runner RENAMES it (`running_` prefix) on pickup — the "started" signal;
  only an un-renamed file is abortable (deletion) — then OWNS `progress` +
  per-job statuses inside the file. The studio (api/execute.ts) polls the
  renamed file, shows "Exporting n%", deletes it at progress 100 and toasts
  the outcome (failed rows + errors); a running file whose Daz exited below
  100 is a dead run (cleaned + reported). No export-folder watching anymore —
  the old delivered-CSV mtime watch is gone.
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
