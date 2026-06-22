import { z } from 'zod'

/**
 * Domain model for a DTH character and its ROM setup, following the official
 * "Guide To Creating Custom ROMs".
 *
 * A ROM is the fixed sequence of the eight pose asset categories (sections).
 * Each section is enabled or disabled, and runs in one of two modes:
 *  - preset: covered by the pre-defined DTH ROMs/pose assets (the usual case
 *    for RET, JCM and FAC; for GEN the Golden Palace / Dicktator ROMs) —
 *    compiled into the bIncludeJCM/FAC/GP/DK flags of DthWorkflow.dsa
 *  - custom: a list of GROUPS (suffix, generation method) holding ordered
 *    poses — compiled into the extra-JSON frames of DthWorkflow.dsa and the
 *    PoseAsset node CSV
 * Frame numbers are never stored — they are computed from section/group/pose
 * order at generation time, so the outputs cannot de-sync.
 */

/** The eight official pose asset categories, in canonical ROM order. */
export const ROM_SECTIONS = ['RET', 'JCM', 'FAC', 'EXP', 'GEN', 'PHY', 'FBM', 'MISC'] as const
export const romSectionSchema = z.enum(ROM_SECTIONS)
export type RomSection = z.infer<typeof romSectionSchema>

export const SECTION_LABELS: Record<RomSection, string> = {
  RET: 'Retargeting',
  JCM: 'Joint Corrective',
  FAC: 'Face',
  EXP: 'Expressions',
  GEN: 'Genitalia',
  PHY: 'Physics',
  FBM: 'Full Body',
  MISC: 'Miscellaneous',
}

/**
 * Per-section capability matrix, extracted from the PoseAsset node's CSV
 * parser (see docs/poseasset-csv-spec.md). FBM and MISC are flat lists.
 */
export const GROUPED_SECTIONS: ReadonlyArray<RomSection> = ['JCM', 'FAC', 'EXP', 'GEN', 'PHY']
/** Groups whose label is a driver-bone list (the CSV `bones` column). */
export const BONE_LABEL_SECTIONS: ReadonlyArray<RomSection> = ['JCM', 'GEN', 'PHY']
/** Groups carrying a generation method (PHY has physics params instead). */
export const METHOD_SECTIONS: ReadonlyArray<RomSection> = ['JCM', 'FAC', 'EXP', 'GEN']
/** Groups carrying a Calculate From setting. */
export const CALC_FROM_SECTIONS: ReadonlyArray<RomSection> = ['FAC', 'EXP', 'GEN', 'PHY']

/** Categories whose poses carry a reference skeleton FBX (CSV `file` column). */
export const REFERENCE_FBX_SECTIONS: ReadonlyArray<RomSection> = ['GEN', 'FBM', 'MISC']

export const sectionModeSchema = z.enum(['preset', 'custom'])
export type SectionMode = z.infer<typeof sectionModeSchema>

/** Which modes each section supports (DTH only ships presets for some). */
export const SECTION_MODES: Record<RomSection, ReadonlyArray<SectionMode>> = {
  RET: ['preset'],
  JCM: ['preset', 'custom'],
  FAC: ['preset', 'custom'],
  EXP: ['custom'],
  GEN: ['preset', 'custom'],
  PHY: ['preset', 'custom'],
  FBM: ['custom'],
  MISC: ['custom'],
}

/** One pre-defined DTH pose preset (.duf) from the DazToHue Poses folder. */
export interface DthPoseAsset {
  /** File name without extension, e.g. "G9 DQS JCM FAC - Base". */
  name: string
  /** Path relative to the Poses folder, with forward slashes. */
  relPath: string
  genesis: GenesisVersion | null
  skinning: 'linear' | 'dqs' | null
  section: RomSection | null
  /** JCM assets only: whether the FAC poses are baked into the base ROM. */
  includesFac: boolean
}

/** One morph dialed on one node at a given frame. */
export const morphSchema = z.object({
  /** Scene node the property lives on, e.g. "Genesis9". */
  node: z.string(),
  /** Internal property name, e.g. "body_bs_BodyTone". */
  prop: z.string(),
  value: z.number(),
  /**
   * Value the sawtooth returns to on the frames around the pose (default 0).
   * For morphs already dialed in as part of the base shape.
   */
  base: z.number().optional(),
  /** Resolve `base` from the morph's current scene value at apply time. */
  autoBase: z.boolean().optional(),
})
export type Morph = z.infer<typeof morphSchema>

/**
 * One ROM pose (= one frame, computed from order). The name becomes the
 * morph name in Unreal (letters/numbers/underscores only; `_l`/`_r` suffixes
 * are appended automatically from the group suffix).
 */
export const romPoseSchema = z.object({
  /** Stable row id for grid editing. */
  id: z.string(),
  name: z.string(),
  morphs: z.array(morphSchema),
  /**
   * Optional reference skeleton FBX for poses that scale bones (e.g.
   * Proportion Height). Only meaningful in GEN and FBM categories.
   */
  referenceFbx: z.string().default(''),
})
export type RomPose = z.infer<typeof romPoseSchema>

/** The PoseAsset node knows no "none" — every group is Left, Centre or Right. */
export const groupSuffixSchema = z.enum(['left', 'centre', 'right'])
export type GroupSuffix = z.infer<typeof groupSuffixSchema>

/**
 * default: inherit the node's Global Generation Method.
 * individual: each pose calculated in isolation.
 * additive: first pose is the base, the rest are additives to it (EyelidsClosed pattern).
 * cumulative: each pose adds to all previous ones in the group (AnusOpen pattern).
 * advancedAdditive: the node's extended additive mode.
 */
export const generationMethodSchema = z.enum([
  'default',
  'individual',
  'additive',
  'cumulative',
  'advancedAdditive',
])
export type GenerationMethod = z.infer<typeof generationMethodSchema>

/** What the group's morph deltas are calculated against. */
export const calculateFromSchema = z.enum(['default', 'restPose', 'animationFrame'])
export type CalculateFrom = z.infer<typeof calculateFromSchema>

export const romGroupSchema = z.object({
  id: z.string(),
  /** Driver bone(s) for JCM/GEN/PHY groups (the CSV `bones` column), e.g. "ball_l". */
  label: z.string().default(''),
  suffix: groupSuffixSchema.default('centre'),
  method: generationMethodSchema.default('default'),
  calculateFrom: calculateFromSchema.default('default'),
  poses: z.array(romPoseSchema).default([]),
})
export type RomGroup = z.infer<typeof romGroupSchema>

/**
 * Art direction for a frame INSIDE a pre-made GP/DK ROM block: morph values
 * stamped onto `startFrame + frame` after the ROM is loaded (the
 * GP9_ArtDirection.json mechanism in DazToHue-Scripts, now per character).
 */
export const artDirectionFrameSchema = z.object({
  id: z.string(),
  rom: z.enum(['gp', 'dk']),
  /** Relative offset from the ROM block start (see the frame map). */
  frame: z.number(),
  name: z.string(),
  morphs: z.array(morphSchema).default([]),
})
export type ArtDirectionFrame = z.infer<typeof artDirectionFrameSchema>

/**
 * The art-directable frames of the pre-made ROMs, from the official frame
 * maps and guides. `required` frames ship empty in the preset — without art
 * direction the generated morph does nothing.
 */
export const ART_DIRECTION_CATALOG: Record<
  'gp' | 'dk',
  ReadonlyArray<{ frame: number; name: string; required: boolean; note?: string }>
> = {
  gp: [
    { frame: 96, name: 'VaginaOpen', required: false, note: 'beyond the default pose' },
    { frame: 97, name: 'VaginaSqueeze', required: false },
    { frame: 98, name: 'VaginaStretch', required: false },
    { frame: 100, name: 'AnusOpen', required: true, note: 'no keyframes in the preset ROM' },
    { frame: 101, name: 'AnusContraction', required: true, note: 'no keyframes in the preset ROM' },
    { frame: 103, name: 'ClitorisErect', required: false },
  ],
  dk: [
    { frame: 13, name: 'ScrotumBendBackward', required: false, note: 'dth_dk9_* correctives' },
    { frame: 14, name: 'ScrotumBendForward', required: false, note: 'dth_dk9_* correctives' },
    { frame: 15, name: 'ScrotumBendLeft', required: false, note: 'dth_dk9_* correctives' },
    { frame: 16, name: 'ScrotumBendRight', required: false, note: 'dth_dk9_* correctives' },
    { frame: 17, name: 'ScrotumTwistLeft', required: false, note: 'dth_dk9_* correctives' },
    { frame: 18, name: 'ScrotumTwistRight', required: false, note: 'dth_dk9_* correctives' },
    { frame: 19, name: 'ScrotumStretch', required: false, note: 'dth_dk9_* correctives' },
    { frame: 20, name: 'ScrotumCompact', required: false, note: 'dth_dk9_* correctives' },
    { frame: 21, name: 'TesticleMoveOut_l', required: false, note: 'dth_dk9_* correctives' },
    { frame: 22, name: 'TesticleMoveIn_l', required: false, note: 'dth_dk9_* correctives' },
    { frame: 23, name: 'TesticleMoveUp_l', required: false, note: 'dth_dk9_* correctives' },
    { frame: 24, name: 'TesticleMoveDown_l', required: false, note: 'dth_dk9_* correctives' },
    { frame: 25, name: 'TesticleMoveForward_l', required: false, note: 'dth_dk9_* correctives' },
    { frame: 26, name: 'TesticleMoveBackward_l', required: false, note: 'dth_dk9_* correctives' },
    { frame: 27, name: 'TesticleMoveOut_r', required: false, note: 'dth_dk9_* correctives' },
    { frame: 28, name: 'TesticleMoveIn_r', required: false, note: 'dth_dk9_* correctives' },
    { frame: 29, name: 'TesticleMoveUp_r', required: false, note: 'dth_dk9_* correctives' },
    { frame: 30, name: 'TesticleMoveDown_r', required: false, note: 'dth_dk9_* correctives' },
    { frame: 31, name: 'TesticleMoveForward_r', required: false, note: 'dth_dk9_* correctives' },
    { frame: 32, name: 'TesticleMoveBackward_r', required: false, note: 'dth_dk9_* correctives' },
    { frame: 34, name: 'ForeskinCoverStage01', required: false, note: 'required for uncircumcised setups' },
    { frame: 35, name: 'ForeskinCoverStage02', required: false, note: 'required for uncircumcised setups' },
    { frame: 36, name: 'ForeskinCoverStage03', required: false, note: 'required for uncircumcised setups' },
    { frame: 37, name: 'ForeskinCoverStage04', required: false, note: 'required for uncircumcised setups' },
    { frame: 38, name: 'ForeskinCoverStage05', required: false, note: 'required for uncircumcised setups' },
    { frame: 40, name: 'ForeskinBendDown', required: false, note: 'uncircumcised setups only' },
    { frame: 41, name: 'ForeskinBendUp', required: false, note: 'uncircumcised setups only' },
    { frame: 42, name: 'ForeskinBendLeft', required: false, note: 'uncircumcised setups only' },
    { frame: 43, name: 'ForeskinBendRight', required: false, note: 'uncircumcised setups only' },
    { frame: 44, name: 'ForeskinTwistLeft', required: false, note: 'uncircumcised setups only' },
    { frame: 45, name: 'ForeskinTwistRight', required: false, note: 'uncircumcised setups only' },
    { frame: 48, name: 'PenisContraction', required: false },
    { frame: 50, name: 'AnusOpen', required: true, note: 'no keyframes in the preset ROM' },
    { frame: 51, name: 'AnusContraction', required: true, note: 'no keyframes in the preset ROM' },
    { frame: 53, name: 'PenisScale', required: false },
  ],
}

export const romSectionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: sectionModeSchema.default('custom'),
  /**
   * Preset mode: selected DTH pose preset file names (e.g.
   * "GP9 - Golden Palace.duf"). Usually one entry; GEN may select several.
   * Empty means "auto" — derived from genesis/skinning at generation time.
   */
  presetAssets: z.array(z.string()).default([]),
  /** GEN preset mode: per-character art direction for the pre-made ROM frames. */
  artDirection: z.array(artDirectionFrameSchema).default([]),
  /** Only used in custom mode. */
  groups: z.array(romGroupSchema).default([]),
  /**
   * JCM custom mode: an absolute path to a custom `.duf` pose preset, loaded as
   * the base ROM exactly like a pre-defined DTH JCM asset.
   */
  customAssetPath: z.string().default(''),
})
export type RomSectionConfig = z.infer<typeof romSectionConfigSchema>

export function defaultSections(): Record<RomSection, RomSectionConfig> {
  const config = (enabled: boolean, mode: SectionMode): RomSectionConfig => ({
    enabled,
    mode,
    presetAssets: [],
    artDirection: [],
    groups: [],
    customAssetPath: '',
  })
  return {
    RET: config(true, 'preset'),
    JCM: config(true, 'preset'),
    FAC: config(true, 'preset'),
    EXP: config(false, 'custom'),
    GEN: config(false, 'preset'),
    PHY: config(false, 'custom'),
    // FBM (custom full-body morphs) starts disabled — a new character without a
    // pre-filled ROM has nothing to put there until the user adds morphs.
    FBM: config(false, 'custom'),
    MISC: config(false, 'custom'),
  }
}

const sectionsSchema = z.object({
  RET: romSectionConfigSchema,
  JCM: romSectionConfigSchema,
  FAC: romSectionConfigSchema,
  EXP: romSectionConfigSchema,
  GEN: romSectionConfigSchema,
  PHY: romSectionConfigSchema,
  FBM: romSectionConfigSchema,
  MISC: romSectionConfigSchema,
})
export type RomSections = z.infer<typeof sectionsSchema>

export const genesisVersionSchema = z.enum(['G3', 'G8', 'G8.1', 'G9'])
export type GenesisVersion = z.infer<typeof genesisVersionSchema>

/** Decides what applies for GEN: female → Golden Palace, male → Dicktator. */
export const genderSchema = z.enum(['female', 'male'])
export type Gender = z.infer<typeof genderSchema>

/** Which gender a GEN preset asset belongs to (null = not gender-specific). */
export function genAssetGender(assetName: string): Gender | null {
  if (/golden ?palace|gp9/i.test(assetName)) return 'female'
  if (/dicktator|dk9/i.test(assetName)) return 'male'
  return null
}

/** The geograft node GEN morphs usually live on. */
export function genDefaultNode(gender: Gender): string {
  return gender === 'female' ? 'GoldenPalace_G9' : 'DicktatorG9'
}

/**
 * Which pre-made genitalia ROMs the GEN preset section includes: explicit
 * asset selection wins, otherwise the gender decides.
 */
export function genRomIncludes(
  gender: Gender,
  presetAssets: Array<string>,
): { gp: boolean; dk: boolean } {
  if (presetAssets.length === 0) {
    return { gp: gender === 'female', dk: gender === 'male' }
  }
  return {
    gp: presetAssets.some((a) => /golden ?palace|gp9/i.test(a)),
    dk: presetAssets.some((a) => /dicktator|dk9/i.test(a)),
  }
}

export const preserveMorphSchema = z.object({
  name: z.string(),
  keepValue: z.number(),
})
export type PreserveMorph = z.infer<typeof preserveMorphSchema>

const rangeSchema = z.object({ start: z.number(), end: z.number() })

const jcmMorphModDriveSchema = z.object({
  morphName: z.string(),
  range: z.object({ angle: rangeSchema, value: rangeSchema }),
})

/**
 * Drives morphs proportionally to a bone rotation across the JCM ROM
 * (DthWorkflow.dsa `options.jcmMorphMods`).
 */
export const jcmMorphModSchema = z.object({
  boneLabel: z.string(),
  /** Rotation axis, e.g. "XRotate". */
  axis: z.string(),
  positive: z.array(jcmMorphModDriveSchema).default([]),
  negative: z.array(jcmMorphModDriveSchema).default([]),
})
export type JcmMorphMod = z.infer<typeof jcmMorphModSchema>

/**
 * Version of the character-JSON **schema** — independent of the app version.
 * Bump this ONLY when the stored character shape changes in a way old/new JSONs
 * must be migrated across: a field is **added, renamed, or removed**, or its
 * meaning/type changes. Pure app improvements that don't touch the persisted
 * shape must NOT bump it.
 *
 * Stamped onto every saved character as `schemaVersion`. A stored value below
 * this means the JSON predates a schema change and is a migration candidate;
 * above it means the JSON came from a newer build. The migration framework that
 * acts on the difference is a later addition — this constant is its groundwork.
 *
 * History:
 *   1 — initial versioned schema (the shape as of its introduction).
 *   2 — added `projectName` + `projectPath`.
 *   3 — added `exportPath`.
 *   4 — added `exportSceneSubfolders`.
 *   5 — added `exportWithRomScript`.
 *   6 — removed `targetSkeleton` (was never used in generation).
 */
export const CHARACTER_SCHEMA_VERSION = 6

export const characterSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Path or URL to a recognition image; optional. */
  image: z.string().default(''),
  /**
   * Absolute path to the Daz scene (`.duf`) this character was created from.
   * Read-only provenance shown in the editor; empty for characters made before
   * the scene-based create flow.
   */
  scenePath: z.string().default(''),
  /**
   * Additional Daz scenes (`.duf`) — outfit / look variants linked to this
   * character beyond the primary `scenePath`. Each opens in Daz; they live in
   * the character's Daz-scenes folder (next to the primary scene).
   */
  extraScenes: z.array(z.string()).default([]),
  /**
   * Houdini project files (`.hip` / `.hipnc` / `.hiplc`) linked to this character.
   * Each opens in Houdini; they live in the character's Houdini folder. No
   * thumbnails — the cards show the Houdini logo.
   */
  houdiniProjects: z.array(z.string()).default([]),
  genesis: genesisVersionSchema.default('G9'),
  gender: genderSchema.default('female'),
  /** G9 detail strengths set at frame 0 (DthWorkflow.dsa applies them when > 0). */
  facsDetailStrength: z.number().default(1),
  flexionStrength: z.number().default(1),
  /** Zero the active genital ROM's morphs (Golden Palace or Dicktator) at the
   *  first custom frame, so they don't leak into the full-body/custom poses. */
  resetGenBeforeApplying: z.boolean().default(true),
  /** Morph values restored after ROM loading (e.g. breast position). */
  preserveMorphs: z.array(preserveMorphSchema).default([]),
  /** Node transforms memorized before and restored after ROM loading (e.g. eyes). */
  preserveNodeTransforms: z.array(z.object({ nodeLabel: z.string() })).default([]),
  jcmMorphMods: z.array(jcmMorphModSchema).default([]),
  sections: sectionsSchema.default(defaultSections()),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** DTH Character Studio version that last wrote this character ('' = unknown,
   *  e.g. created before this was tracked). Stamped on every save. */
  studioVersion: z.string().default(''),
  /** Name of the project this character belongs to, stamped on every save
   *  (provenance — the character lives in this project's library). Empty for
   *  characters last written before this was tracked. */
  projectName: z.string().default(''),
  /** Absolute path of the owning project's library folder, stamped on save. */
  projectPath: z.string().default(''),
  /**
   * Export directory for the DTH Exporter plugin (v1.8.1+). When set, the
   * generated Daz script runs the exporter (`doExport`) into this folder after
   * building the ROM — empty = no auto-export. The exporter creates its own
   * `<characterName>` subfolder here, so this should be a folder OUTSIDE the
   * project's character directory.
   */
  exportPath: z.string().default(''),
  /**
   * When `exportPath` is set, also nest the export under a subfolder named after
   * the Daz scene open in Daz when the script runs (`Scene.getFilename()`), so a
   * character's scene/outfit variants export side by side. The exporter's own
   * `<characterName>` subfolder is created inside that. No effect without an
   * export path, or when no scene is loaded/saved at run time.
   */
  exportSceneSubfolders: z.boolean().default(false),
  /**
   * When `exportPath` is set, whether the auto-export runs inside the ROM script
   * (`true`, the default — one combined `<Name>_<Genesis>.dsa`) or is split into
   * a separate `Export_<Name>_<Genesis>.dsa` that only runs the exporter +
   * delivers the CSV, leaving `ROM_<Name>_<Genesis>.dsa` to build the ROM. Split
   * lets you re-export without rebuilding the (slow) ROM. No effect without an
   * export path.
   */
  exportWithRomScript: z.boolean().default(true),
  /**
   * Character-JSON schema version (see {@link CHARACTER_SCHEMA_VERSION}). Stamped
   * on every save. The default is the BASELINE `1` — never the live constant —
   * so a JSON written before versioning existed (no field) reads as 1, which is
   * correctly *below* any future bumped version and thus a migration candidate.
   */
  schemaVersion: z.number().int().positive().default(1),
})
export type Character = z.infer<typeof characterSchema>

/**
 * UUID with a fallback for non-secure contexts: newId() is
 * unavailable over plain http (e.g. the LAN dev URL), where it would make
 * every add/mirror click die silently.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Filesystem-safe base name used for generated files, e.g. "ElectraG9".
 * Keeps underscores — the DTH Exporter allows letters, numbers and
 * underscores in character names (no spaces or symbols).
 */
export function characterSlug(character: Pick<Character, 'name'>): string {
  return character.name.replace(/[^A-Za-z0-9_]+/g, '') || 'Character'
}

/**
 * Skinning is not stored — it is defined by the selected JCM preset asset
 * (e.g. "G9 DQS JCM FAC - Base.duf"). DQS = 328 base frames, linear = 617.
 * Without an explicit selection the DTH-recommended DQS is assumed.
 */
export function characterSkinning(character: Pick<Character, 'sections'>): 'linear' | 'dqs' {
  const jcm = character.sections.JCM
  const asset =
    jcm.mode === 'preset' ? jcm.presetAssets[0] : jcm.mode === 'custom' ? jcm.customAssetPath : undefined
  if (asset) return /\bDQS\b/i.test(asset) ? 'dqs' : 'linear'
  return 'dqs'
}

/** The sections whose frames the studio generates (enabled custom sections, in ROM order). */
export function customSections(
  sections: RomSections,
): Array<{ section: RomSection; config: RomSectionConfig }> {
  return ROM_SECTIONS.filter(
    (section) => sections[section].enabled && sections[section].mode === 'custom',
  ).map((section) => ({ section, config: sections[section] }))
}

/**
 * Measured frame lengths of the preset ROM blocks for a specific character,
 * read on the fly from the actual `.duf` pose assets (see apps/desktop
 * `pose_asset_frames`). Nothing is hard-coded — a custom asset measures exactly
 * the same way a DTH one does. `base` is the base ROM (JCM/RET/FAC) at the
 * character's skinning; `gp`/`dk`/`phys` are 0 when that block isn't included.
 */
export interface PresetFrames {
  base: number
  gp: number
  dk: number
  phys: number
}

/** Whether JCM contributes a base ROM block — a preset, or a custom asset path. */
export function jcmIsBaseRom(sections: RomSections): boolean {
  const jcm = sections.JCM
  return (
    jcm.enabled &&
    (jcm.mode === 'preset' || (jcm.mode === 'custom' && jcm.customAssetPath.trim() !== ''))
  )
}

/**
 * Absolute timeline frame of the first custom pose — the sum of the measured
 * preset ROM blocks preceding the custom sequence (base ROM when JCM is a base,
 * then GP / DK / Physics when included). Mirrors the lastPresetFrame math in
 * generate.ts so the editor shows the same absolute frames it generates.
 */
export function presetFrameCount(
  sections: RomSections,
  gender: Gender,
  frames: PresetFrames,
): number {
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const roms = genRomIncludes(gender, sections.GEN.presetAssets)
  const lastPresetFrame =
    (jcmIsBaseRom(sections) ? frames.base - 1 : -1) +
    (genPreset && roms.gp ? frames.gp : 0) +
    (genPreset && roms.dk ? frames.dk : 0) +
    (sections.PHY.enabled && sections.PHY.mode === 'preset' ? frames.phys : 0)
  return Math.max(lastPresetFrame, 0) + 1
}

/**
 * Absolute timeline start frame of a pre-made GEN ROM block (GP or DK), so the
 * editor can show absolute art-direction frame numbers. The base JCM ROM comes
 * first; the workflow then applies DK before GP, so GP follows DK when both are
 * present.
 */
export function genRomStartFrame(
  sections: RomSections,
  gender: Gender,
  rom: 'gp' | 'dk',
  frames: PresetFrames,
): number {
  const base = jcmIsBaseRom(sections) ? frames.base : 0
  const roms = genRomIncludes(gender, sections.GEN.presetAssets)
  return rom === 'dk' ? base : base + (roms.dk ? frames.dk : 0)
}

export interface FlatFrame {
  /** 0-based: the first custom frame is 0 (Daz timelines are 0-based). */
  frame: number
  section: RomSection
  name: string
  morphs: Array<Morph>
  group: RomGroup
  pose: RomPose
}

/** Flattens the enabled custom sections into the frame sequence — the single source of frame numbers. */
export function flattenRom(sections: RomSections): Array<FlatFrame> {
  const frames: Array<FlatFrame> = []
  let frame = 0
  for (const { section, config } of customSections(sections)) {
    for (const group of config.groups) {
      for (const pose of group.poses) {
        frames.push({
          frame: frame++,
          section,
          name: pose.name,
          morphs: pose.morphs,
          group,
          pose,
        })
      }
    }
  }
  return frames
}

export function countPoses(sections: RomSections): number {
  return customSections(sections).reduce(
    (sum, { config }) => sum + config.groups.reduce((s, group) => s + group.poses.length, 0),
    0,
  )
}

/**
 * Builds sections from a flat frame list (DazToHue-Scripts FBM JSONs, legacy
 * studio data): consecutive frames of the same section become one group in
 * that section, which is enabled and switched to custom mode.
 */
export function sectionsFromFlatFrames(
  frames: Array<{ section: string; name: string; morphs: Array<Morph> }>,
): RomSections {
  const sections = defaultSections()
  let lastSection: RomSection | null = null
  for (const frame of frames) {
    const section = (ROM_SECTIONS as ReadonlyArray<string>).includes(frame.section)
      ? (frame.section as RomSection)
      : 'MISC'
    const config = sections[section]
    config.enabled = true
    config.mode = 'custom'
    const pose: RomPose = {
      id: newId(),
      name: frame.name,
      morphs: frame.morphs,
      referenceFbx: '',
    }
    const lastGroup = config.groups[config.groups.length - 1]
    if (section === lastSection && lastGroup) {
      lastGroup.poses.push(pose)
    } else {
      config.groups.push({
        id: newId(),
        label: '',
        suffix: 'centre',
        method: 'default',
        calculateFrom: 'default',
        poses: [pose],
      })
    }
    lastSection = section
  }
  return sections
}

/**
 * Clones a left-suffixed group as its right-side counterpart, mirroring
 * left/right markers in morph property names (best effort).
 */
export function mirrorGroup(group: RomGroup): RomGroup {
  const swap = (value: string) =>
    value
      .replace(/Left/g, 'Right')
      .replace(/left/g, 'right')
      .replace(/_l\b/g, '_r')
      .replace(/\bL_/g, 'R_')
  return {
    ...group,
    id: newId(),
    suffix: 'right',
    label: swap(group.label),
    poses: group.poses.map((pose) => ({
      id: newId(),
      name: pose.name,
      referenceFbx: pose.referenceFbx,
      morphs: pose.morphs.map((morph) => ({ ...morph, prop: swap(morph.prop) })),
    })),
  }
}
