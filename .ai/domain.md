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
| **Groom / hair** | Daz-side it's "hair", Houdini-side "groom". Hair is ALWAYS per scene by presence (no more `groomMode` — removed in schema v20): a scene's `groomScenes` items ARE its hair, none listed → nothing excluded. The generated script hides them for the ROM export (hide-only, needs Exporter Plugin ≥ 2.0.1 = `MIN_GROOM_EXPORTER_VERSION`), and a separate `Export_Hair_…` script exports EACH hair item of the open scene ON ITS OWN (runtime v33) as `<Name>_Hair_<item>_grooms.abc` — for every item it hides the other wearables (incl. the other hair items) and exports just that one, so Houdini gets one alembic per hair asset. |
| **Figure detection** | The native `scene_wearables` (`poses.rs`) also returns the scene's base **`figure`** node (the non-conformed node whose id/name starts with "Genesis"). The pure inverse `genesisFromFigureNode(id)` (`types.ts`, the reverse of `genesisFigureNode`) maps `Genesis9` / `Genesis8_1Female` → generation (+ gender for the gendered gens; null for G9). The **create-character dialog** uses it to auto-select Genesis + gender from the picked scene's contents (best-effort, both fields stay editable) — reading what's IN the scene, not guessing from its filename. |
| **Scene override** | A per-EXTRA-scene delta (`sceneOverrides` on `Character`, schema v17; per-panel gates since v20): four independently-armed panels — **ROM** (`enabled` + `poses`/`additions`: replaced rows keyed by the base pose's **id**, content swaps, frame stays, + additions appended at group ends; `flatSectionGroupId` covers flat sections without a stored group), **identity** (`identity.enabled` + G9 FACS-detail/flexion/tear-UV), **groom** (`groom.enabled`, a UI gate only — hair lists live per scene in `groomScenes`), **preserve** (`preserve.enabled` + own `morphs`/`nodeTransforms` — a FULL replacement of the base preserve lists, emitted even when empty so a scene can clear them). `applySceneOverride` merges ROM; `mergeSceneOverride` yields the scene's effective character (ROM sections + identity dials). All gates default OFF, so a fresh scene starts fully disabled; arming identity/preserve seeds from the base. `activeSceneOverrides` (any panel armed + scene still in `extraScenes`) is THE single gate; `sceneOverrideBuildsRom` narrows to the ROM subset that also mints a scene-suffixed CSV. Disabled/unlinked overrides keep their data; their files retire on the next save. |

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
  **DTH runtime** (`.DthWorkflow.dsa`, `.DthUtils.dsa`, scan scripts) is co-installed
  once at that root (`copyRuntimeFiles` in `apps/web/src/lib/rom/storage.ts`).
- `<name>_pose_asset.csv` — the Houdini PoseAsset CSV, written next to the
  character JSON and copied into the export dir by the ROM script's export block.
- Optional: `Export_<Name>_<Genesis>.dsa` (split export), `Export_Hair_…` (one
  `<Name>_Hair_<item>_grooms.abc` per hair item of the open scene), `Scan_Products_…`
  (product scan).
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
- **Per-scene ROM overrides are implicit — arm on edit, disarm on revert.** With a
  non-primary scene selected the ROM grid edits into a `SceneOverride` (no toggle):
  editing a base row upserts its override copy (green row); editing it back to the
  base *content* drops the copy again (`group-card.tsx` `patchPose` compares against
  the base pose with `posesEqual` from `@dth/rom` and calls `resetPose`). This mirrors
  the identity/preserve writers (`use-scene-selection.ts`), which likewise derive
  `enabled` from "differs from base". `onOverrideChange` (`rom-editor-section.tsx`)
  then derives the ROM gate from "has any override rows", so a fully-reverted scene
  generates no `dthSceneOverrides` delta and no per-scene CSV. NB the grid value is a
  Daz **percentage** (`valueToPct`): base `1` shows as `100`, so a revert types `100`.

## The DTH runtime is studio-owned

The `.dsa` runtime (currently `RUNTIME_VERSION = 32`, history in `types.ts`) lives
in this repo and ships with the app — there is **no external script dependency**;
only the `.duf` pose presets come from the DTH release. The runtime accepts
**inline config only**: file-based config (extra JSONs, art-direction paths) aborts
loudly with a regenerate-in-studio error. When changing generated-script behavior,
bump `RUNTIME_VERSION` — Tools → Refresh assets flags characters generated on
older runtimes as stale.

## The exporter contract (measured, not documented upstream)

- Bone-scale frames make the DTH Exporter write per-frame reference skeletons to
  `<export dir>/Reference Skeletons/<figure>_frame_<N>.fbx`. The HDA wants
  **absolute** paths in the CSV `file` column, so the studio writes a
  `{{DTH_EXPORT_DIR}}` token and the generated script substitutes the real export
  dir when copying the CSV next to the exporter output.
- No export directory set ⇒ the ROM is still fully generated; ticked Bone scale
  rows are a harmless no-op (no validation links the two).
- `referenceFrames()` (generate.ts) hands the exporter the same absolute frames
  the CSV references — the 1:1 mapping is test-pinned.

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
