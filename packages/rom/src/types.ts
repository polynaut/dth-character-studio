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

// --- Generous string bounds -------------------------------------------------
// Character JSONs are shared between users, so a hostile definition is in scope.
// Persisted strings carry GENEROUS upper bounds: the goal is rejecting absurd
// multi-megabyte values (a memory/UI DoS vector), never constraining real use.
// A validation-only tightening is not a shape change — no schema-version bump
// and no migration step (see the decision tree atop migrate.ts).

/** Names, labels, ids, morph/node/property names, version strings. */
const MAX_NAME_LENGTH = 500
/** Filesystem paths (Windows practical limits are far below this). */
const MAX_PATH_LENGTH = 4096
/** Joined display lists (e.g. a product's capped "used by" labels). */
const MAX_JOINED_LENGTH = 2048
/**
 * `image` may legitimately be a `data:` URL kept verbatim (see the web layer's
 * canonicalImage) — allow a reasonable inline image, reject multi-MB blobs.
 */
const MAX_IMAGE_LENGTH = 1_000_000
/** Arrays of paths (linked scenes/projects, preset selections). */
const MAX_PATH_LIST = 1000

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
  node: z.string().max(MAX_NAME_LENGTH),
  /** Internal property name, e.g. "body_bs_BodyTone". */
  prop: z.string().max(MAX_NAME_LENGTH),
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
  id: z.string().max(MAX_NAME_LENGTH),
  name: z.string().max(MAX_NAME_LENGTH),
  morphs: z.array(morphSchema),
  /**
   * Optional reference skeleton FBX for poses that scale bones (e.g.
   * Proportion Height). Only meaningful in GEN and FBM categories.
   */
  referenceFbx: z.string().max(MAX_PATH_LENGTH).default(''),
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
  id: z.string().max(MAX_NAME_LENGTH),
  /** Driver bone(s) for JCM/GEN/PHY groups (the CSV `bones` column), e.g. "ball_l". */
  label: z.string().max(MAX_NAME_LENGTH).default(''),
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
  id: z.string().max(MAX_NAME_LENGTH),
  rom: z.enum(['gp', 'dk']),
  /** Relative offset from the ROM block start (see the frame map). */
  frame: z.number(),
  name: z.string().max(MAX_NAME_LENGTH),
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
  presetAssets: z.array(z.string().max(MAX_PATH_LENGTH)).max(MAX_PATH_LIST).default([]),
  /** GEN preset mode: per-character art direction for the pre-made ROM frames. */
  artDirection: z.array(artDirectionFrameSchema).default([]),
  /** Only used in custom mode. */
  groups: z.array(romGroupSchema).default([]),
  /**
   * JCM custom mode: an absolute path to a custom `.duf` pose preset, loaded as
   * the base ROM exactly like a pre-defined DTH JCM asset.
   */
  customAssetPath: z.string().max(MAX_PATH_LENGTH).default(''),
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
 * The validated PoseAsset-CSV template a generation ships, described by the
 * BAKED lengths its ground-truth export fixed. The gate
 * ({@link poseAssetCsvValidated}) and the splice read the SAME numbers from
 * here, so a base/GP that measures differently (a future or custom asset)
 * can't silently desync the CSV — it falls to the experimental path instead.
 */
export interface GenerationTemplate {
  /** Baked base-ROM length (RET+JCM+FAC); the custom sections continue after it. */
  baseFrames: number
  /** Baked GP (Golden Palace) block length, when the template bakes one. */
  gpFrames?: number
  /**
   * CSV era the template's control rows target, or `null` when era-independent
   * (G8.1 targets the pre-2.0 HDA and is byte-identical across releases).
   */
  era: PoseAssetCsvEra | null
  /** The template bakes a GP (GEN) block (stripped when GP is off). */
  allowGen: boolean
  /** A fixed PHY preset block can be spliced in after the GP block. */
  allowPhys: boolean
}

/**
 * Per-generation facts, so a new generation is one table row (+ one template
 * file in generate.ts) instead of a literal string-compare scattered across the
 * figure-node, skinning, strength-dial and template-splice code. Keyed by
 * {@link GenesisVersion}, so the compiler forces a row for every enum member.
 */
export interface GenerationDescriptor {
  /** Base scene-node name of the unrenamed figure. */
  figureBase: string
  /** Earlier generations ship per-gender figures; G9 is gender-neutral. */
  figureHasGender: boolean
  /** DTH-recommended skinning when the JCM asset doesn't state one. */
  skinningDefault: 'linear' | 'dqs'
  /** The FACS-detail / flexion strength dials exist only on Genesis 9 figures. */
  hasStrengthDials: boolean
  /** The validated PoseAsset-CSV template, or `null` when none ships. */
  template: GenerationTemplate | null
}

export const GENERATIONS: Record<GenesisVersion, GenerationDescriptor> = {
  G9: {
    figureBase: 'Genesis9',
    figureHasGender: false,
    skinningDefault: 'dqs',
    hasStrengthDials: true,
    template: { baseFrames: 328, gpFrames: 104, era: '2.0', allowGen: true, allowPhys: true },
  },
  'G8.1': {
    figureBase: 'Genesis8_1',
    figureHasGender: true,
    skinningDefault: 'dqs',
    hasStrengthDials: false,
    // Era-independent: the G8.1 CTL-tail template targets the pre-2.0 HDA and
    // the base assets are byte-identical across releases (188 frames anywhere).
    template: { baseFrames: 188, era: null, allowGen: false, allowPhys: false },
  },
  G8: {
    figureBase: 'Genesis8',
    figureHasGender: true,
    skinningDefault: 'linear',
    hasStrengthDials: false,
    template: null,
  },
  G3: {
    figureBase: 'Genesis3',
    figureHasGender: true,
    skinningDefault: 'linear',
    hasStrengthDials: false,
    template: null,
  },
}

/**
 * The scene-node name of an unrenamed base figure — the default `node` for new
 * ROM entries. G9 is gender-neutral; earlier generations ship per-gender
 * figures (Daz node names have no dots/spaces: Genesis8_1Female).
 */
export function genesisFigureNode(genesis: GenesisVersion, gender: Gender): string {
  const d = GENERATIONS[genesis]
  return d.figureHasGender ? `${d.figureBase}${gender === 'female' ? 'Female' : 'Male'}` : d.figureBase
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
  name: z.string().max(MAX_NAME_LENGTH),
  keepValue: z.number(),
})
export type PreserveMorph = z.infer<typeof preserveMorphSchema>

const rangeSchema = z.object({ start: z.number(), end: z.number() })

const jcmMorphModDriveSchema = z.object({
  morphName: z.string().max(MAX_NAME_LENGTH),
  range: z.object({ angle: rangeSchema, value: rangeSchema }),
})

/**
 * Drives morphs proportionally to a bone rotation across the JCM ROM
 * (DthWorkflow.dsa `options.jcmMorphMods`).
 */
export const jcmMorphModSchema = z.object({
  boneLabel: z.string().max(MAX_NAME_LENGTH),
  /** Rotation axis, e.g. "XRotate". */
  axis: z.string().max(MAX_NAME_LENGTH),
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
 * acts on the difference is `migrateCharacterData` (see `migrate.ts`).
 *
 * To bump it: (1) edit `characterSchema`; (2) bump this constant + add a History
 * line below; (3) add a `migrate.test.ts` case. Add a `characterMigrations` step
 * in `migrate.ts` ONLY for a rename/restructure or a computed value — an additive
 * field with a zod default and a removed field need none (zod fills/strips them),
 * and a value needing host context resolves in web `parseCharacter`, not the core.
 * The full decision tree + copy-paste templates live atop `migrate.ts`.
 *
 * History:
 *   1 — initial versioned schema (the shape as of its introduction).
 *   2 — added `projectName` + `projectPath`.
 *   3 — added `exportPath`.
 *   4 — added `exportSceneSubfolders`.
 *   5 — added `exportWithRomScript`.
 *   6 — removed `targetSkeleton` (was never used in generation).
 *   7 — added `generatedDthVersion` (the DTH release the PoseAsset CSV was last
 *       generated for; additive with a '' default — no migration step needed).
 *   8 — added `products` / `productsUnmatched` / `productsScannedAt` (the Daz
 *       Products scan; additive with [] / '' defaults — no migration step needed).
 */
export const CHARACTER_SCHEMA_VERSION = 8

/**
 * Version of the generated **script runtime** — the bundled DTH `.dsa` runtime
 * plus the shape of the scripts the studio emits. Independent of the app version
 * and of {@link CHARACTER_SCHEMA_VERSION}. Bump this whenever a studio update
 * changes the runtime files or the generated-script output in a way that means
 * already-generated scripts on disk should be regenerated. Pure app/UI changes
 * that don't alter generated output must NOT bump it.
 *
 * Stamped into every generated Daz script header as `// DTH-Runtime: v<N>`, so a
 * script on disk can be read back to learn which runtime produced it. A value
 * below this — or no marker at all (a script generated before this existed) —
 * means the script is stale and "Refresh assets" should regenerate it.
 *
 * History:
 *   1 — initial runtime version (the runtime + generated-script shape as of its
 *       introduction; earlier scripts carry no marker and read as out-of-date).
 *   2 — added the DthProducts.dsa runtime + the generated Scan_Products_<Name>.dsa
 *       script (the Daz Products scan feature).
 *   3 — product scan keys its output by the open Daz scene (per-scene CSVs in a
 *       per-character folder) and reads texture-based matching, so existing scan
 *       scripts must be regenerated to write the new per-scene layout.
 *   4 — product scan attributes an unmatched decorative node (a zipper, a flower
 *       trim) to a product already matched in the same scene when the node's name
 *       is the basename of a file that product installs ("Manifest Match"), so
 *       figure-parented sub-parts stop landing in "unmatched".
 *   5 — product scan reads ALL of a node's material map channels (normal, bump,
 *       roughness, metallic, …), not just the diffuse map, so a sub-part whose only
 *       file texture is on a non-diffuse channel still texture-folder matches.
 *   6 — product scan attributes an unmatched GROUP/null node to the product its
 *       matched children belong to ("Group Match"), and writes an unmatched-node
 *       diagnostics file next to each per-scene CSV.
 *   7 — product scan runs its structural attribution passes (parent→child, name↔file,
 *       child→parent) to a fixpoint, so a match made by one pass unblocks another
 *       (e.g. a decoration parented to a node that only the group pass matches).
 *   8 — keyword matching requires TWO distinct shared keywords (the scene-Genesis
 *       bonus only ranks, never promotes a one-word match) and folds in the morph
 *       parameter path, so a morph like "SL_Glutes Top Inflate" stops mis-filing
 *       under "Summertide Swimwear Top" and matches its real product instead.
 *   9 — product scan writes the unmatched-node diagnostics file only when something
 *       is unmatched (a clean scan writes none and removes a stale prior report).
 *  10 — product scan writes a temporary "_debug-matches-<scene>.txt" dumping the
 *       asset fields behind each match (to diagnose a surprising keyword attribution).
 *  11 — keyword matcher counts distinct shared keywords with arrays + hasOwnProperty
 *       instead of `for…in` over a plain object: Daz's QtScript leaves enumerable
 *       members on Object.prototype, which inflated the count and silently defeated
 *       the two-keyword gate (e.g. "GP_Minora_Inflate Inside" → "Inside the Asylum
 *       Bundle" on the lone word "inside"). Temporary match-debug dump removed.
 *  12 — product scan synthesizes products from the content library's
 *       data/<Vendor>/<Product> folders as a last resort, so content with no DIM /
 *       LOCAL_USER metadata (e.g. unofficial products) is still recognised — named by
 *       its folder, with artist/version read from the content's own files.
 *  13 — the ROM script writes a run log (dth_rom_run_log.json in the character
 *       folder) recording every morph that couldn't be applied and any unexpected
 *       error, and ends with a dialog when there were problems (the studio reads
 *       the log back). Missing morphs can no longer shorten the timeline: frame
 *       slots come from the declaration, NaN frames are logged + skipped, and the
 *       legacy per-frame loop no longer aborts a frame on the first missing morph.
 *       The character script is now always named ROM_<Name>_<Genesis>.dsa.
 *  14 — v13 regression fix: the generated script's include() moved back to the
 *       TOP level — Daz resolves include() via its legacy-include mechanism,
 *       which fails inside try/catch ("URIError: Legacy Include"), breaking every
 *       v13 script before it ran. The catch-all now guards only the call (a
 *       typeof check covers a missing runtime), the export block is skipped when
 *       the ROM build aborts, and the Daz dialogs are short + generic — the
 *       details live in the studio, which ingests the run log.
 *  15 — generator fix (not a runtime-API change; bumped to force regeneration of
 *       affected scripts): a base-less character (no JCM/GEN/PHY preset — e.g.
 *       FBM-only, or custom JCM groups) now starts its first custom frame at 0
 *       instead of 1, re-aligning the PoseAsset CSV / exporter reference frames
 *       with the Daz timeline (removed a Math.max(...,0) off-by-one). Also
 *       hardens the generated .dsa/CSV against injection: control chars are
 *       stripped from names in comment headers, commas/newlines from CSV group
 *       labels + reference-FBX paths.
 *  16 — runtime-API change: preset-block lengths (base/gp/dk/phys) are no longer
 *       hard-coded in the runtime (was iRomFrames 328/617, gp 104, dk 54, phys 43).
 *       The studio measures each from the actual .duf and threads them in as
 *       config/options.presetFrames; the runtime sizes every block from those and
 *       fails loud (logRunError + abort) if a count is missing — so a custom or
 *       future-DTH preset of non-standard length can't silently desync the Daz
 *       timeline from the PoseAsset CSV. Scripts generated before v16 carry no
 *       presetFrames and must be regenerated (Tools → Refresh assets).
 *  17 — DS6 keyframe-drift workaround: on Daz Studio 6 every ROM morph key is
 *       stamped CONSTANT instead of LINEAR (and the session default matches).
 *       DS6's animation engine drifts Linear ROM keys across the timeline
 *       (mrpdean, June 2026); converting all keys to Constant after applying
 *       is his validated fix. DS4 behavior unchanged (Linear). The final
 *       interpolation pass now also covers the FAC mouth node, whose keys a
 *       root-only pass never touched.
 *  18 — Scan_Morphs_<Genesis>.dsa scripts (G9/G8.1/G8/G3) + the shared
 *       .DthScanMorphs.dsa runtime: scan every morph dial (DzMorph modifiers +
 *       controller float properties) on a selected unrenamed figure AND its
 *       descendants (grafts, clothing) into a per-generation
 *       JSON in the studio's app-data folder — the Morph-name autocomplete's
 *       index. Install-time templating bakes the app-data path into the
 *       wrappers; no generated-script API change.
 *  19 — Genesis 8/8.1 support: the mouth ROM pass now runs only when a mouth
 *       pose asset was actually resolved (G9 is the only generation that ships
 *       one — G8.1's FAC frames live in its base ROM, and its figures have no
 *       separate mouth node to require). The figure-root error message no
 *       longer claims "Genesis 9" (the root has always come from the user's
 *       selection, any generation works). Non-G9 generated configs zero the
 *       G9-only FACS-detail/flexion strengths so runs don't log a spurious
 *       "property not found" failure.
 *  20 — ApplyDTHCharacter returns FULL success (finished AND zero run-log
 *       problems) instead of just "didn't abort". The generated combined
 *       script gates its export block on it, so a ROM with failed morphs no
 *       longer ships a PoseAsset CSV/FBX as if it were good — fix and re-run.
 *       Regenerate scripts (Tools → Refresh assets) to pick up the stricter
 *       `=== true` gate.
 */
export const RUNTIME_VERSION = 20

/**
 * DTH releases at which the generated **PoseAsset CSV** format changed in a
 * breaking way, ascending. A release's CSV *era* is the highest entry that is
 * `<=` it (see {@link poseAssetCsvEra}); two releases in the same era produce
 * interchangeable CSVs, so a character generated under one is NOT stale under the
 * other. A character's CSV needs regenerating only when its era differs from the
 * active release's era.
 *
 *   2.0 — the trailing control rows changed format: pre-2.0 nodes read/write
 *         CTLGROUP/CTL rows, 2.0+ reads/writes CURVEGROUP/CURVE (verified
 *         against the DazToHuePoseAsset.hda of every release on hand: 1.9.6 =
 *         CTL, 2.0/2.1/2.2.1/2.4.3 = CURVE; import_from_csv exists in ALL of
 *         them — an earlier note claiming 2.4.3 introduced CSV import was
 *         wrong). Era '' (pre-2.0) is the old-Houdini pipeline: the G8.1
 *         template targets it; the G9 template targets the 2.0 era.
 *
 * When a future release changes the CSV, add its version here AND teach
 * {@link toPoseAssetCsv} to emit the matching variant for that era — both shipped
 * in the same studio update, so a user switching to that release is flagged for a
 * refresh while everyone on an earlier release stays "all good".
 */
export const POSEASSET_CSV_BREAKING_VERSIONS = ['2.0'] as const

/**
 * The CSV era of a generated PoseAsset file: `''` (pre-2.0, the CTL-rows /
 * old-Houdini pipeline) or one of the {@link POSEASSET_CSV_BREAKING_VERSIONS}
 * baselines. The domain of {@link poseAssetCsvEra} and the era arguments the
 * generators take.
 */
export type PoseAssetCsvEra = '' | (typeof POSEASSET_CSV_BREAKING_VERSIONS)[number]

/**
 * Compare two dotted version strings numerically (segment-wise; missing segments
 * count as 0; '' sorts below everything). Returns >0 when `a` > `b`, <0 when
 * `a` < `b`, 0 when equal. e.g. `compareDthVersions('2.4.10', '2.4.3') > 0`.
 */
export function compareDthVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * The CSV era of a DTH release: the highest {@link POSEASSET_CSV_BREAKING_VERSIONS}
 * entry that is `<=` `release`, or '' when the release predates the first baseline
 * (or no release is given). Two releases with the same era have interchangeable
 * PoseAsset CSVs — the studio uses this to decide both which CSV variant to emit
 * and whether an already-generated CSV is out of date.
 */
export function poseAssetCsvEra(release: string): PoseAssetCsvEra {
  if (!release) return ''
  let era: PoseAssetCsvEra = ''
  for (const v of POSEASSET_CSV_BREAKING_VERSIONS) {
    if (compareDthVersions(release, v) >= 0) era = v
  }
  return era
}

/**
 * One installed Daz product a product scan matched to an asset used in the
 * character's scene. Written by the generated `Scan_Products_<Name>.dsa` to the
 * scan CSV, then stored onto the character when the user accepts the results.
 * All fields but `name` default to '' so a sparse manifest still parses.
 */
export const productRecordSchema = z.object({
  name: z.string().max(MAX_NAME_LENGTH),
  sku: z.string().max(MAX_NAME_LENGTH).default(''),
  artist: z.string().max(MAX_NAME_LENGTH).default(''),
  version: z.string().max(MAX_NAME_LENGTH).default(''),
  productType: z.string().max(MAX_NAME_LENGTH).default(''),
  /** How the scan tied this product to a scene asset, e.g. "SKU Match",
   *  "Direct Match", "Keyword Match", "Third-Party Match", "Genesis Base Match". */
  matchMethod: z.string().max(MAX_NAME_LENGTH).default(''),
  /** What the product appears to be used for in the scene — distinct roles of the
   *  matched assets, joined (e.g. "Clothing; Geograft"). Heuristic; '' when unknown. */
  usage: z.string().max(MAX_JOINED_LENGTH).default(''),
  /** The specific scene assets that matched this product (labels, capped + joined),
   *  so you can see exactly why it's in the scene. */
  usedBy: z.string().max(MAX_JOINED_LENGTH).default(''),
  /** The Daz scene(s)/outfit(s) this product was found in — basenames of the open
   *  scene file(s) that were scanned (e.g. "KiraDefault_G9_GP"). A character can
   *  have several scenes; the studio merges per-scene scans and lists every scene a
   *  product appears in here. Empty for scans that captured no saved scene. */
  scenes: z.array(z.string().max(MAX_NAME_LENGTH)).max(MAX_PATH_LIST).default([]),
})
export type ProductRecord = z.infer<typeof productRecordSchema>

/**
 * A scene asset (a node or a non-zero morph) a product scan could NOT tie to an
 * installed product — surfaced alongside the matched products so the user can
 * attribute it manually.
 */
export const unmatchedAssetSchema = z.object({
  name: z.string().max(MAX_NAME_LENGTH),
  technicalName: z.string().max(MAX_NAME_LENGTH).default(''),
  /** "Node" or "Morph". */
  assetType: z.string().max(MAX_NAME_LENGTH).default(''),
  /** Native source file the asset loaded from (the `.duf`/`.dsf` path Daz reports
   *  for it), or '' when unknown. Provenance the scan captures without the DIM
   *  manifests — the folder segments often name the vendor/product. */
  sourceFile: z.string().max(MAX_PATH_LENGTH).default(''),
  /** Author + revision read from the source file's own `asset_info` block (DSON),
   *  '' when unreadable. This is how unofficial products (absent from DIM, hence
   *  unmatched) still surface an artist and a real version. */
  artist: z.string().max(MAX_NAME_LENGTH).default(''),
  version: z.string().max(MAX_NAME_LENGTH).default(''),
  /** The Daz scene(s)/outfit(s) this asset was found unmatched in (scene-file
   *  basenames). Same per-scene attribution as {@link productRecordSchema.scenes}. */
  scenes: z.array(z.string().max(MAX_NAME_LENGTH)).max(MAX_PATH_LIST).default([]),
})
export type UnmatchedAsset = z.infer<typeof unmatchedAssetSchema>

export const characterSchema = z.object({
  id: z.string().max(MAX_NAME_LENGTH),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  /** Path or URL to a recognition image; optional (may be a `data:` URL). */
  image: z.string().max(MAX_IMAGE_LENGTH).default(''),
  /**
   * Absolute path to the Daz scene (`.duf`) this character was created from.
   * Read-only provenance shown in the editor; empty for characters made before
   * the scene-based create flow.
   */
  scenePath: z.string().max(MAX_PATH_LENGTH).default(''),
  /**
   * Additional Daz scenes (`.duf`) — outfit / look variants linked to this
   * character beyond the primary `scenePath`. Each opens in Daz; they live in
   * the character's Daz-scenes folder (next to the primary scene).
   */
  extraScenes: z.array(z.string().max(MAX_PATH_LENGTH)).max(MAX_PATH_LIST).default([]),
  /**
   * Houdini project files (`.hip` / `.hipnc` / `.hiplc`) linked to this character.
   * Each opens in Houdini; they live in the character's Houdini folder. No
   * thumbnails — the cards show the Houdini logo.
   */
  houdiniProjects: z.array(z.string().max(MAX_PATH_LENGTH)).max(MAX_PATH_LIST).default([]),
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
  preserveNodeTransforms: z
    .array(z.object({ nodeLabel: z.string().max(MAX_NAME_LENGTH) }))
    .default([]),
  jcmMorphMods: z.array(jcmMorphModSchema).default([]),
  sections: sectionsSchema.default(defaultSections()),
  createdAt: z.string().max(MAX_NAME_LENGTH),
  updatedAt: z.string().max(MAX_NAME_LENGTH),
  /** DTH Character Studio version that last wrote this character ('' = unknown,
   *  e.g. created before this was tracked). Stamped on every save. */
  studioVersion: z.string().max(MAX_NAME_LENGTH).default(''),
  /** Name of the project this character belongs to, stamped on every save
   *  (provenance — the character lives in this project's library). Empty for
   *  characters last written before this was tracked. */
  projectName: z.string().max(MAX_NAME_LENGTH).default(''),
  /** Absolute path of the owning project's library folder, stamped on save. */
  projectPath: z.string().max(MAX_PATH_LENGTH).default(''),
  /**
   * Export directory for the DTH Exporter plugin (v1.8.1+). When set, the
   * generated Daz script runs the exporter (`doExport`) into this folder after
   * building the ROM — empty = no auto-export. The exporter creates its own
   * `<characterName>` subfolder here, so this should be a folder OUTSIDE the
   * project's character directory.
   */
  exportPath: z.string().max(MAX_PATH_LENGTH).default(''),
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
   * The DTH release the PoseAsset CSV was last generated for (e.g. "2.4.3"); ''
   * when never generated, or generated with no DTH release configured. The CSV is
   * the only artifact tied to the DTH release, so its provenance lives here in the
   * app-owned JSON (the CSV itself can't carry a version — the Houdini HDA parser
   * reads every row's first column as a type). Detection compares its
   * {@link poseAssetCsvEra} to the active release's; Refresh re-stamps it.
   */
  generatedDthVersion: z.string().max(MAX_NAME_LENGTH).default(''),
  /**
   * Daz products this character uses, as stored from the most recent product
   * scan (the generated `Scan_Products_<Name>.dsa` analyses the open scene and
   * writes a CSV; the user reviews + stores it from the character page). Empty
   * until a scan is stored. Provenance only — does NOT affect generation.
   */
  products: z.array(productRecordSchema).default([]),
  /** Scene assets the last stored scan could not match to a product — kept for
   *  manual review next to {@link products}. */
  productsUnmatched: z.array(unmatchedAssetSchema).default([]),
  /** ISO timestamp the products above were last stored from a scan; '' = never. */
  productsScannedAt: z.string().max(MAX_NAME_LENGTH).default(''),
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
 * Without an explicit selection the DTH-recommended DQS is assumed — except
 * for generations DTH ships no DQS ROM for (G8, G3, Linear-only), where the
 * auto-selected asset can only be Linear; an explicit DQS pick still wins.
 */
export function characterSkinning(
  character: Pick<Character, 'sections'> & Partial<Pick<Character, 'genesis'>>,
): 'linear' | 'dqs' {
  const jcm = character.sections.JCM
  const asset =
    jcm.mode === 'preset' ? jcm.presetAssets[0] : jcm.mode === 'custom' ? jcm.customAssetPath : undefined
  if (asset) return /\bDQS\b/i.test(asset) ? 'dqs' : 'linear'
  return GENERATIONS[character.genesis ?? 'G9'].skinningDefault
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
 * THE single source of the preset-block frame math: the last preset frame on the
 * timeline — the frame the custom sections continue after — as the sum of the
 * measured preset ROM blocks (base ROM when JCM is a base, then GP / DK / Physics
 * when included). Returns **-1** when there is NO preset block, so the first
 * custom pose lands at frame 0 (matching the Daz runtime's `startFrame = 0` for a
 * base-less ROM). NEVER clamp the -1 to 0 — that desyncs the CSV from Daz.
 *
 * Every other preset-offset in the codebase derives from this: {@link presetFrameCount}
 * (+1), {@link genRomStartFrame}, and generate.ts's CSV splice / reference-frame /
 * custom-row placement all call it, so the Daz and Houdini artifacts can't drift.
 */
export function presetEndFrame(
  sections: RomSections,
  gender: Gender,
  frames: PresetFrames,
): number {
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const roms = genRomIncludes(gender, sections.GEN.presetAssets)
  return (
    (jcmIsBaseRom(sections) ? frames.base - 1 : -1) +
    (genPreset && roms.gp ? frames.gp : 0) +
    (genPreset && roms.dk ? frames.dk : 0) +
    (sections.PHY.enabled && sections.PHY.mode === 'preset' ? frames.phys : 0)
  )
}

/**
 * Absolute timeline frame of the first custom pose — one past {@link presetEndFrame}.
 * Mirrors the offset generate.ts applies so the editor shows the same absolute
 * frames it generates. A base-less ROM has presetEndFrame -1, so the count is 0.
 */
export function presetFrameCount(
  sections: RomSections,
  gender: Gender,
  frames: PresetFrames,
): number {
  return presetEndFrame(sections, gender, frames) + 1
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

/** One pose visited by {@link walkCustomPoses}. */
export interface CustomPoseWalk {
  section: RomSection
  config: RomSectionConfig
  group: RomGroup
  pose: RomPose
  /** 0-based index across all enabled custom sections in canonical order — the
   *  single source of relative frame numbers (the first custom pose is 0). */
  relativeFrame: number
  /** True for the first pose of its group — where a CSV GROUP header is emitted. */
  firstInGroup: boolean
}

/**
 * THE single walk over the enabled custom sections → groups → poses, in canonical
 * order, numbering each pose 0-based. `flattenRom`, the PoseAsset CSV custom rows
 * and the exporter reference frames all consume this, so they agree on which pose
 * sits at which frame by construction (empty groups yield nothing).
 */
export function* walkCustomPoses(sections: RomSections): Generator<CustomPoseWalk> {
  let relativeFrame = 0
  for (const { section, config } of customSections(sections)) {
    for (const group of config.groups) {
      let firstInGroup = true
      for (const pose of group.poses) {
        yield { section, config, group, pose, relativeFrame, firstInGroup }
        relativeFrame++
        firstInGroup = false
      }
    }
  }
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
  for (const { section, group, pose, relativeFrame } of walkCustomPoses(sections)) {
    frames.push({
      frame: relativeFrame,
      section,
      name: pose.name,
      morphs: pose.morphs,
      group,
      pose,
    })
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
