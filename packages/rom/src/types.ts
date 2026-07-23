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

/**
 * Categories whose poses carry a reference skeleton FBX (CSV `file` column).
 * GEN and FBM only — matching the DTH Custom ROM Guide. The HDA's CSV parser
 * *reads* a `file` column on MIS rows too, but the node has no matching
 * parameter, so a non-empty MIS file makes the whole import fail (measured
 * on HDA 2.4.3, July 15 2026). Never emit it there.
 */
export const REFERENCE_FBX_SECTIONS: ReadonlyArray<RomSection> = ['GEN', 'FBM']

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
  /** Stable row id for grid editing (minted on read when absent — schema v19,
   *  the same pattern as the v18 JCM rule/drive ids). NEVER reaches generated
   *  output: `morphJson` emits node/prop/value/base/autoBase only, on every
   *  path (extraFrames, art direction). */
  id: z.string().max(MAX_NAME_LENGTH).default(() => newId()),
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
   * Whether this pose scales bones (e.g. Torso Length, Proportion Height). Unreal
   * can't drive bone scale from a morph alone, so the DTH Exporter writes a
   * per-frame reference-skeleton FBX for such a frame and the studio fills that
   * FBX's path into the PoseAsset CSV automatically (a `{{DTH_EXPORT_DIR}}` token
   * the generated Daz script resolves against the real export dir at run time).
   * Only meaningful in GEN/FBM categories (see {@link REFERENCE_FBX_SECTIONS});
   * ignored everywhere else — generation never emits a reference FBX for other
   * sections (a stray flag on a MIS row would break the HDA's CSV import).
   */
  boneScaleRef: z.boolean().default(false),
})
export type RomPose = z.infer<typeof romPoseSchema>

/** The PoseAsset node knows no "none" — every group is Left, Centre or Right. */
export const groupSuffixSchema = z.enum(['left', 'centre', 'right'])
export type GroupSuffix = z.infer<typeof groupSuffixSchema>

/**
 * The token a group's suffix appends to its pose names to form the final
 * Unreal morph name (the HDA appends `_l`/`_r`; centre appends nothing). The
 * ONE encoding of that mapping — validation's collision keys and the CSV
 * side's baked-name resolution (csv.ts) both consume it, so the sites can't
 * drift apart.
 */
export const GROUP_SUFFIX_TOKENS: Record<GroupSuffix, string> = {
  left: '_l',
  centre: '',
  right: '_r',
}

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
  /** Relative offset from the ROM block start (see the frame map). Constrained
   *  to a whole, non-negative offset: the runtime stamps morphs at
   *  `startFrame + frame`, so a negative/fractional value would silently key
   *  into a NEIGHBORING block — corrupting exactly the frame alignment the
   *  product exists to guarantee. (Validation-only tightening — no schema-
   *  version bump, per the policy above.) */
  frame: z.number().int().nonnegative(),
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

/**
 * The default mode of a section — the FIRST entry of its {@link SECTION_MODES}
 * row (preset where DTH ships one, else custom). THE single source both
 * {@link defaultSections} and the per-section schema healing consume: a
 * partially-written file like `{ RET: { enabled: true } }` must heal its
 * missing `mode` to the SECTION's default, not a global 'custom' — RET-custom
 * fails the SECTION_MODES superRefine (rejecting the whole character), and a
 * partial GEN healed to custom silently generated a different ROM.
 */
export function defaultSectionMode(section: RomSection): SectionMode {
  return SECTION_MODES[section][0]
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
  const config = (section: RomSection, enabled: boolean): RomSectionConfig => ({
    enabled,
    // Single source with the schema healing: SECTION_MODES[section][0].
    mode: defaultSectionMode(section),
    presetAssets: [],
    artDirection: [],
    groups: [],
    customAssetPath: '',
  })
  return {
    RET: config('RET', true),
    JCM: config('JCM', true),
    FAC: config('FAC', true),
    EXP: config('EXP', false),
    GEN: config('GEN', false),
    // Preset-first like GEN — the editor drops to 'custom' on enable when the
    // installed release ships no PHY asset for the character's generation.
    PHY: config('PHY', false),
    // FBM (custom full-body morphs) starts disabled — a new character without a
    // pre-filled ROM has nothing to put there until the user adds morphs.
    FBM: config('FBM', false),
    MISC: config('MISC', false),
  }
}

/**
 * The section's config schema with ITS mode default ({@link defaultSectionMode})
 * instead of the generic 'custom': a partial object like `{ enabled: true }`
 * under RET must heal to RET-preset, not RET-custom (which the SECTION_MODES
 * superRefine would reject, hard-failing the whole character), and a partial
 * GEN must heal to the preset mode `defaultSections()` gives it, not to a
 * silently different custom ROM.
 */
function sectionConfigSchema(section: RomSection) {
  return romSectionConfigSchema.extend({
    mode: sectionModeSchema.default(defaultSectionMode(section)),
  })
}

const sectionsSchema = z
  .object({
    // Per-key defaults from defaultSections() (function form → a fresh object per
    // parse): a hand-edited / partially-written file missing a section HEALS to
    // that section's default instead of hard-failing the whole character — the
    // tolerant posture everywhere else in the schema. The per-SECTION config
    // schema extends that healing to sub-key granularity (a present-but-partial
    // section object heals its mode to the section's own default).
    RET: sectionConfigSchema('RET').default(() => defaultSections().RET),
    JCM: sectionConfigSchema('JCM').default(() => defaultSections().JCM),
    FAC: sectionConfigSchema('FAC').default(() => defaultSections().FAC),
    EXP: sectionConfigSchema('EXP').default(() => defaultSections().EXP),
    GEN: sectionConfigSchema('GEN').default(() => defaultSections().GEN),
    PHY: sectionConfigSchema('PHY').default(() => defaultSections().PHY),
    FBM: sectionConfigSchema('FBM').default(() => defaultSections().FBM),
    MISC: sectionConfigSchema('MISC').default(() => defaultSections().MISC),
  })
  // SECTION_MODES was advisory data — nothing rejected a crafted file putting a
  // section into a mode it doesn't support (e.g. RET custom), whose groups would
  // then walk into generation, emit rows no HDA parser knows AND shift every
  // subsequent custom frame. Fail loud at parse instead of desyncing silently.
  .superRefine((sections, ctx) => {
    for (const section of ROM_SECTIONS) {
      if (!SECTION_MODES[section].includes(sections[section].mode)) {
        ctx.addIssue({
          code: 'custom',
          path: [section, 'mode'],
          message: `${section} does not support '${sections[section].mode}' mode`,
        })
      }
    }
  })
  // Duplicate group/pose ids HEAL on parse (shared, hand-edited JSONs are in
  // scope — reject would brick the file): a duplicated group id merges the two
  // groups' `groupRanges` frame spans in the generated FBM meta and makes a
  // scene override's `additions` land in both groups; a duplicated pose id
  // double-applies a scene override's replacement row. Re-mint the LATER
  // occurrences — the FIRST keeps the stored id, so any override keyed on it
  // keeps its (previously ambiguous) target deterministically.
  .transform((sections) => {
    const groupIds = new Set<string>()
    const poseIds = new Set<string>()
    for (const section of ROM_SECTIONS) {
      for (const group of sections[section].groups) {
        if (groupIds.has(group.id)) group.id = newId()
        groupIds.add(group.id)
        for (const pose of group.poses) {
          if (poseIds.has(pose.id)) pose.id = newId()
          poseIds.add(pose.id)
        }
      }
    }
    return sections
  })
export type RomSections = z.infer<typeof sectionsSchema>

/**
 * The stable group id of a flat FBM/MISC section's IMPLICIT group — the one the
 * editor shows before any pose is stored (flat sections have exactly one group
 * and no group management). Shared between the editor and
 * `applySceneOverride`, so a scene override's added frames can key a flat
 * section that has no stored group yet.
 */
export function flatSectionGroupId(section: RomSection): string {
  return `flat-${section}`
}

/** A morph value held (restored) after the ROM load — name + the value to keep. */
export const preserveMorphSchema = z.object({
  name: z.string().max(MAX_NAME_LENGTH),
  keepValue: z.number(),
})
export type PreserveMorph = z.infer<typeof preserveMorphSchema>

/** A node whose transform is memorized before and restored after the ROM load. */
export const preserveNodeTransformSchema = z.object({ nodeLabel: z.string().max(MAX_NAME_LENGTH) })
export type PreserveNodeTransform = z.infer<typeof preserveNodeTransformSchema>

/**
 * A per-Daz-scene ROM override — "the same character in another scene/outfit":
 * most frames stay exactly as the base ROM defines them, a few rows are
 * REPLACED (other morphs / other values on the same frame) and a few extra
 * frames are APPENDED for morphs only that scene's assets have (e.g. clothing
 * morphs). The base structure is never edited through an override — sections,
 * groups and row order come from `sections`; an override only substitutes row
 * content by pose id and appends rows at group ends. Generation compiles the
 * merged result (see `applySceneOverride`) into its own scene-suffixed script +
 * CSV pair, so the default artifacts and the per-scene ones coexist.
 */
export const sceneOverrideSchema = z.object({
  /** Absolute path of the linked extra Daz scene (`.duf`) this override is for.
   *  Repointed alongside `scenePath`/`extraScenes` on folder moves. */
  scenePath: z.string().max(MAX_PATH_LENGTH),
  /**
   * Whether the ROM override panel is armed for this scene — the ROM-frames
   * gate, parallel to `identity.enabled` / `groom.enabled` below. Armed, the
   * scene's merged rows drive its config delta + its own PoseAsset CSV; disarmed
   * keeps the stored rows (re-arming restores them) but stops contributing.
   * Defaults OFF so a freshly-minted override for a new scene starts fully
   * disabled — the user opts each panel in.
   */
  enabled: z.boolean().default(false),
  /**
   * Replaced rows: each pose's `id` names the BASE pose it substitutes, so the
   * replacement survives base-row reordering. An entry whose base pose no
   * longer exists is simply ignored (never breaks the merge).
   */
  poses: z.array(romPoseSchema).default([]),
  /**
   * Appended rows, per group (`groupId` = the base group's id, or
   * {@link flatSectionGroupId} for a flat section with no stored group). Always
   * appended AFTER the group's base poses — an override can't insert between
   * existing frames. Entries for a group that no longer exists are ignored.
   */
  additions: z
    .array(
      z.object({
        groupId: z.string().max(MAX_NAME_LENGTH),
        poses: z.array(romPoseSchema).default([]),
      }),
    )
    .default([]),
  /**
   * Per-scene GENESIS-9 identity override (FACS detail / flexion strength / UE5
   * tear UV) — the same three values as the base character's G9 fields. Its
   * `enabled` gates the panel + generation exactly like the ROM `enabled` above;
   * off keeps the stored values but stops contributing.
   */
  identity: z
    .object({
      enabled: z.boolean().default(false),
      facsDetailStrength: z.number().default(1),
      flexionStrength: z.number().default(1),
      applyUE5TearUV: z.boolean().default(false),
    })
    .default({ enabled: false, facsDetailStrength: 1, flexionStrength: 1, applyUE5TearUV: false }),
  /**
   * Per-scene HAIR override gate. The hair lists already live per scene in
   * `groomScenes` (keyed by scene path); this only opts the Hair panel in for a
   * non-primary scene so it reads like the other overrides.
   */
  groom: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  /**
   * Per-scene "preserve after ROM loading" lists (Advanced options) — the scene's
   * OWN morph-hold + node-transform lists, a full replacement of the base ones
   * when `enabled` (so an outfit scene can add, edit AND remove entries). Armed,
   * both lists override the base even when empty (an empty list means "preserve
   * nothing for this scene").
   */
  preserve: z
    .object({
      enabled: z.boolean().default(false),
      morphs: z.array(preserveMorphSchema).default([]),
      nodeTransforms: z.array(preserveNodeTransformSchema).default([]),
    })
    .default({ enabled: false, morphs: [], nodeTransforms: [] }),
})
export type SceneOverride = z.infer<typeof sceneOverrideSchema>

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
  /** Fixed PHY preset block length, when the template can splice one (`allowPhys`). */
  physFrames?: number
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
  /** The stock figure asset file names — the rename-proof identity the runtime's
   *  auto-select and the standalone scripts match figures by. */
  assetFiles: Array<string>
  /** The validated PoseAsset-CSV template, or `null` when none ships. */
  template: GenerationTemplate | null
}

export const GENERATIONS: Record<GenesisVersion, GenerationDescriptor> = {
  G9: {
    figureBase: 'Genesis9',
    figureHasGender: false,
    skinningDefault: 'dqs',
    hasStrengthDials: true,
    assetFiles: ['genesis9.dsf'],
    template: {
      baseFrames: 328,
      gpFrames: 104,
      physFrames: 43,
      era: '2.0',
      allowGen: true,
      allowPhys: true,
    },
  },
  'G8.1': {
    figureBase: 'Genesis8_1',
    figureHasGender: true,
    skinningDefault: 'dqs',
    hasStrengthDials: false,
    assetFiles: ['genesis8_1female.dsf', 'genesis8_1male.dsf'],
    // Era-independent: the G8.1 CTL-tail template targets the pre-2.0 HDA and
    // the base assets are byte-identical across releases (188 frames anywhere).
    template: { baseFrames: 188, era: null, allowGen: false, allowPhys: false },
  },
  G8: {
    figureBase: 'Genesis8',
    figureHasGender: true,
    skinningDefault: 'linear',
    hasStrengthDials: false,
    assetFiles: ['genesis8female.dsf', 'genesis8male.dsf'],
    template: null,
  },
  G3: {
    figureBase: 'Genesis3',
    figureHasGender: true,
    skinningDefault: 'linear',
    hasStrengthDials: false,
    assetFiles: ['genesis3female.dsf', 'genesis3male.dsf'],
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
 * Inverse of {@link genesisFigureNode}: recover the generation — and, for the
 * gendered generations, the gender — from a scene figure node's id/name
 * (`Genesis9` → G9, `Genesis8_1Female` → G8.1 + female). Accepts a raw DSON ref
 * too (a leading `#` and URL-encoding are stripped), so a wearable's
 * `conformTarget` (`#Genesis8_1Male`) maps the same way. `gender` is `null` for
 * the gender-neutral G9; the whole result is `null` when the name matches no
 * known figure (e.g. a user-renamed figure) — the caller keeps its default.
 */
export function genesisFromFigureNode(
  nodeName: string,
): { genesis: GenesisVersion; gender: Gender | null } | null {
  let name = nodeName.trim().replace(/^#/, '')
  try {
    name = decodeURIComponent(name)
  } catch {
    // Leave a malformed %-escape as-is rather than throwing on it.
  }
  const lower = name.toLowerCase()
  // Longest figureBase first, so `Genesis8_1` wins over the `Genesis8` prefix.
  const versions = (Object.keys(GENERATIONS) as Array<GenesisVersion>).sort(
    (a, b) => GENERATIONS[b].figureBase.length - GENERATIONS[a].figureBase.length,
  )
  for (const genesis of versions) {
    const d = GENERATIONS[genesis]
    const base = d.figureBase.toLowerCase()
    if (!lower.startsWith(base)) continue
    const suffix = lower.slice(base.length) // '' | 'female' | 'male' | other
    if (suffix !== '' && suffix !== 'female' && suffix !== 'male') continue
    const gender: Gender | null = d.figureHasGender && suffix ? suffix : null
    return { genesis, gender }
  }
  return null
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

const rangeSchema = z.object({ start: z.number(), end: z.number() })

export const jcmMorphModDriveSchema = z.object({
  /** Stable row id for grid editing (minted on read when absent). NEVER reaches
   *  the generated runtime output — jcmMorphModForRuntime strips it. */
  id: z.string().max(MAX_NAME_LENGTH).default(() => newId()),
  morphName: z.string().max(MAX_NAME_LENGTH),
  range: z.object({ angle: rangeSchema, value: rangeSchema }),
})
export type JcmMorphModDrive = z.infer<typeof jcmMorphModDriveSchema>

/**
 * Drives morphs proportionally to a bone rotation across the JCM ROM
 * (DthWorkflow.dsa `options.jcmMorphMods`). A rule holds one signed `drives[]`
 * list: each drive's direction (which way the bone bends) is inferred from its
 * angle-range sign, so there is no separate positive/negative selector — the
 * runtime still consumes split lists, so generation splits them (see
 * {@link jcmMorphModForRuntime}).
 */
export const jcmMorphModSchema = z.object({
  /** Stable row id for grid editing (minted on read when absent). Not part of the
   *  generated runtime output (jcmMorphModForRuntime never spreads the rule). */
  id: z.string().max(MAX_NAME_LENGTH).default(() => newId()),
  boneLabel: z.string().max(MAX_NAME_LENGTH),
  /** Rotation axis, e.g. "XRotate". */
  axis: z.string().max(MAX_NAME_LENGTH),
  drives: z.array(jcmMorphModDriveSchema).default([]),
})
export type JcmMorphMod = z.infer<typeof jcmMorphModSchema>

/**
 * Which way a JCM drive corrects — inferred from its angle range's sign (the
 * extreme angle furthest from rest). A rest-only / zero range counts as positive;
 * the grid flags such ranges, so it shouldn't reach here in practice.
 */
export function jcmDriveDirection(drive: JcmMorphModDrive): 'positive' | 'negative' {
  const { start, end } = drive.range.angle
  const extreme = Math.abs(end) >= Math.abs(start) ? end : start
  return extreme < 0 ? 'negative' : 'positive'
}

/**
 * The runtime `.dsa` still consumes a rule as split positive/negative drive
 * lists; the studio stores one signed `drives[]` and splits it here at generation
 * time, so the emitted `options.jcmMorphMods` contract is byte-for-byte unchanged.
 */
/** A drive as emitted to the runtime — the stored drive minus the editor-only id. */
export type RuntimeJcmDrive = Omit<JcmMorphModDrive, 'id'>
export function jcmMorphModForRuntime(mod: JcmMorphMod): {
  boneLabel: string
  axis: string
  positive: Array<RuntimeJcmDrive>
  negative: Array<RuntimeJcmDrive>
} {
  const positive: Array<RuntimeJcmDrive> = []
  const negative: Array<RuntimeJcmDrive> = []
  for (const drive of mod.drives) {
    // Emit ONLY morphName + range (no editor-only `id`), so the generated
    // options.jcmMorphMods contract stays byte-for-byte unchanged.
    const clean: RuntimeJcmDrive = { morphName: drive.morphName, range: drive.range }
    ;(jcmDriveDirection(drive) === 'negative' ? negative : positive).push(clean)
  }
  return { boneLabel: mod.boneLabel, axis: mod.axis, positive, negative }
}

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
 *   9 — added `applyUE5TearUV` (G9 tear-UV toggle; additive with a `false` default
 *       — no migration step needed).
 *  10 — replaced the per-pose free-text `referenceFbx` path with a `boneScaleRef`
 *       boolean. The DTH Exporter now auto-generates the reference-skeleton FBXs and
 *       the studio computes their CSV paths, so the manual path is gone (migration
 *       step: a non-empty old path → `true`).
 *  11 — removed `resetGenBeforeApplying` (removal — zod strips it, no migration
 *       step). Block tails never leaking is runtime v26 behavior now, not a
 *       choice: the generated FBM meta always sets the reset flags, and the
 *       gen-block close-out is unconditional. The off position only reproduced
 *       the dangling-tail bug.
 *  12 — added `imageScene` (the linked scene whose preview the avatar mirrors,
 *       so the editor can re-sync it when Daz rewrites the preview on a scene
 *       save; additive with a '' default — no migration step. Pre-existing
 *       scene-derived avatars self-heal: the sync adopts a source scene when
 *       the stored avatar still byte-matches that scene's current preview).
 *  13 — added `groomNodes` (hair items excluded from the DTH export via
 *       unfit+unparent around doExport; additive with a [] default — no
 *       migration step).
 *  14 — added `groomMode` ('scene' = groom lives in the ROM scene and the
 *       groom bracket excludes it at export; 'separate' = classic
 *       separate-scene workflow, lists inert; additive with a 'scene' default —
 *       no migration step).
 *  15 — `groomNodes` (v13, never released) became the per-SCENE `groomScenes`
 *       (a character's outfit scenes carry different hair styles; the script
 *       resolves the open scene's list at run time). Removal+addition — zod
 *       strips the old flat list and fills the new default; no migration step.
 *  16 — a JCM "Modify frames" rule's split `positive[]` / `negative[]` drive
 *       lists merged into one signed `drives[]`; direction is inferred from each
 *       drive's angle-range sign now (the positive/negative selector was
 *       redundant). Restructure — migration step concatenates the two lists.
 *  17 — added `sceneOverrides` (per-Daz-scene ROM overrides: replaced rows +
 *       appended frames for outfit scenes; additive with a [] default — no
 *       migration step needed).
 *  18 — added a stable `id` to each JCM "Modify frames" rule AND drive (grid row
 *       keys; minted on read via a zod default — no migration step). Never
 *       reaches the generated output: `jcmMorphModForRuntime` emits drives without
 *       it, so the runtime contract stays byte-for-byte unchanged.
 *  19 — added a stable `id` to each pose MORPH row (and thereby each
 *       art-direction morph row — both are `morphSchema`), mirroring v18:
 *       grid row keys, minted on read via a zod default — no migration step.
 *       Never reaches the generated output: `morphJson` emits
 *       node/prop/value/base/autoBase only on every path (extraFrames,
 *       gp/dkArtDirection), so the .dsa config contract stays byte-for-byte
 *       unchanged.
 *  20 — added per-scene `identity` (G9 FACS/flexion/tear-UV), `groom` (hair
 *       gate) and `preserve` (own preserve-morph / node-transform lists) blocks
 *       to `sceneOverrideSchema`, generalizing per-scene overrides beyond ROM.
 *       Additive nested objects with zod defaults — no migration step (hair
 *       lists stay in `groomScenes`; `groom.enabled` is just the panel opt-in).
 *       The ROM `enabled` gate's default flipped true → false so a fresh override
 *       starts fully disabled; this needs no step either — every stored override
 *       already carries an explicit `enabled`, so nothing relies on the default
 *       on read. Also REMOVED `groomMode` (the "hair lives in scenes" toggle):
 *       hair is now always per-scene by presence — a scene's `groomScenes` items
 *       ARE its hair, none means none. A removed field needs no step (zod strips
 *       the old value on read); the old 'separate' choice just stops excluding.
 */
export const CHARACTER_SCHEMA_VERSION = 20

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
 *  21 — Generation now writes a per-character `Open_Scene_<Character>.dsa` (opens
 *       the scene in an already-running Daz from the Content Library, since the
 *       studio can't forward it in). No runtime `.dsa` change — bumped purely so
 *       Refresh assets regenerates existing characters to install the new script.
 *  22 — Removed the `Open_Scene_<Character>.dsa` script again (a plugin-based
 *       solution is coming instead). No runtime `.dsa` change — bumped so Refresh
 *       assets regenerates existing characters and cleans up the leftover script.
 *  23 — Bone-scale reference frames: the PoseAsset CSV's `file` column now carries
 *       a `{{DTH_EXPORT_DIR}}` token for bone-scale frames, and the generated
 *       script resolves it to the real export dir when it copies the CSV (was a
 *       plain file copy). No runtime `.dsa` change — bumped so Refresh assets
 *       regenerates existing scripts with the token-aware copy.
 *  24 — Bone scale restricted to GEN/FBM: a non-empty `file` on a MIS row makes
 *       the HDA's import_from_csv fail (no matching node parameter — measured on
 *       2.4.3), so generation no longer emits reference FBX paths or exporter
 *       reference frames for MISC poses. No runtime `.dsa` change — bumped so
 *       Refresh assets regenerates any CSV that carried a MIS file entry.
 *  25 — Scan_Frames.dsa ships with the studio: the keyframe-scan functions moved
 *       out of DthWorkflow.dsa into the shared .DthScanFrames.dsa runtime
 *       (DthWorkflow includes it; generated-script behaviour unchanged), and a
 *       visible Scan_Frames.dsa wrapper exports the open scene's keyed frames
 *       into the studio's app-data scan-frames folder for "Import from CSV" —
 *       replacing the DazToHue-Scripts DthScanFrames workflow. Bumped so Refresh
 *       assets installs the new scripts.
 *  26 — ROM block tails no longer leak into later blocks: a pose preset can
 *       only key frames inside its own range, so a block's LAST pose had no
 *       ramp-down key and held its value through everything after — the base
 *       ROM's final FAC neck pose showed as neck/throat morph deltas across the
 *       whole GEN range in Houdini. After the base block loads, any keyed morph
 *       on the figure (and the G9 mouth) not back at its frame-0 value gets that
 *       value keyed at the first post-base frame, completing the sawtooth the
 *       preset couldn't. The GP/DK blocks get the same close-out on their own
 *       node at the next block boundary (the FBM-start art-morph reset alone
 *       missed .duf-baked gen morphs, skipped characters without art direction,
 *       and never protected a Physics block between GEN and the customs). The
 *       `resetGenBeforeApplying` character option is gone with it (schema v11):
 *       tails never leaking is behavior now, not a choice — the studio always
 *       emits the FBM meta reset flags; only legacy file-based configs can still
 *       turn them off. Re-run the ROM script in Daz to rebuild existing
 *       timelines.
 *  27 — Inline-config only: the runtime no longer reads file-based configs — the
 *       extraJSONs (*_FBMs.json) list, the GP9/DK9 art-direction JSON path
 *       fallbacks and the readPropsCSV reader of the old wrapper-script era are
 *       gone (the runtime is studio-owned; everything arrives inline via
 *       ApplyDTHCharacter). A config that still passes them aborts LOUD with a
 *       regenerate-in-studio error instead of building a ROM without its custom
 *       frames. The GP/DK block-tail close-outs are unconditional now (the meta
 *       reset flags are gone — with the resetGenBeforeApplying option removed
 *       in schema v11 they no longer had an off position), and the FBM-start
 *       art-morph reset is retired: the boundary close-out covers it.
 *  28 — Auto-select the character's figure: a missing or wrong selection no
 *       longer aborts the ROM — the runtime finds the scene's figure of the
 *       config's generation by its source-ASSET identity (labels/names are
 *       user-renamable; the instantiating .dsf is not) and selects it, first
 *       match winning when a scene holds several. Legacy configs without a
 *       genesis, and Daz builds without a readable asset URI, keep the old
 *       select-it-yourself behavior unchanged.
 *  29 — The auto-select's unreadable-asset tolerance is restricted to actual
 *       FIGURES: a selected non-figure (a prop, Environment Options, …) is
 *       never accepted as the export root anymore — it auto-selects the real
 *       figure or fails loud (found by deliberate wrong-selection testing).
 *  30 — The base-ROM tail close-out (closeDanglingMorphKeys, runtime v26) no
 *       longer double-applies character-owned morphs. It ran a whole-figure
 *       re-key at the FAC→GEN boundary using each morph's post-ROM value; for a
 *       morph the character/GP/character-preset drives (e.g. ProportionHeight),
 *       that stacked the value on top of the ERC-driven contribution, so a -10%
 *       dialed height read as -20% by frame 327. The runtime now snapshots the
 *       morph baseline BEFORE the ROM (memorizeBaseMorphs) and leaves any
 *       character-dialed (non-zero base) morph untouched — only pure ROM poses
 *       (base ~0, e.g. the final FAC neck pose that v26 was added to fix) still
 *       close their dangling tail. The DK/GP geograft and mouth close-outs are
 *       unchanged. Re-run the ROM script in Daz to rebuild affected timelines.
 *  31 — Groom (hair) exclusion is HIDE-only now. The generated export block used
 *       to unfit+unparent the groom items itself (because Daz's FBX exporter
 *       ignores visibility on fitted followers), with an opt-in hide variant.
 *       The DTH Exporter Plugin now unparents any HIDDEN child node before
 *       exporting and reparents it after, so the script only hides the groom
 *       items and lets the plugin exclude them from BOTH the FBX and the alembic.
 *       The detach path and the "Solve hair assets by hiding" setting are gone.
 *       NB: requires the plugin build that does the hidden-node unparent — an
 *       older Exporter would leak hair back into the FBX. Refresh assets to
 *       regenerate existing characters onto the hide-only export block.
 *  32 — Per-scene overrides collapse into the ONE character script. The
 *       generated `ROM_<Name>_<Genesis>.dsa` now embeds a `dthSceneOverrides`
 *       map (normalized open-scene path → the few config fields that scene
 *       changes) and merges the open scene's delta onto dthCharacterConfig
 *       before the build — so one script serves the primary AND every outfit
 *       scene, instead of a separate `ROM_…_<Scene>.dsa` per override. The
 *       export block likewise selects the scene's PoseAsset CSV by open scene.
 *       Refresh assets to regenerate onto the one script (the old per-scene
 *       scripts are swept on the next save/refresh).
 *  33 — The Hair export (`Export_Hair_…`) exports EACH hair item on its own now,
 *       named `<Name>_Hair_<item>`, instead of one combined `<Name>_groom` .abc.
 *       For every item in the open scene's list it hides every OTHER wearable
 *       (including the other hair items) and exports just that one, so Houdini
 *       gets one alembic per hair asset. Refresh assets to regenerate.
 */
export const RUNTIME_VERSION = 33

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
 * The DTH Exporter Plugin version that first unparents hidden child nodes before
 * exporting (and reparents after). Groom (hair) exclusion is HIDE-only from
 * runtime v31 on — the generated script only hides the groom items and relies on
 * the plugin to keep them out of the FBX. An OLDER plugin exports the hidden hair
 * into the FBX, so a character with groom items needs at least this version. The
 * DLL carries its version in its VS_FIXEDFILEINFO, so the studio can read the
 * installed plugin's version and warn precisely (see the editor's groom section).
 */
export const MIN_GROOM_EXPORTER_VERSION = '2.0.1'

/**
 * Whether an installed Exporter Plugin version can do the hidden-node unparent
 * groom exclusion ({@link MIN_GROOM_EXPORTER_VERSION}). Empty (unknown / not
 * installed) returns `true` — we don't warn when we can't read a version, so a
 * missing native read never nags.
 */
export function exporterSupportsGroomHide(installedVersion: string): boolean {
  if (!installedVersion) return true
  return compareDthVersions(installedVersion, MIN_GROOM_EXPORTER_VERSION) >= 0
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
   * Absolute path of the linked Daz scene whose preview (`.tip.png`) the avatar
   * mirrors — '' for a custom upload / external URL (those are never touched).
   * With a source scene set, the editor re-copies the preview whenever it
   * drifts (Daz rewrites it on every scene save): on view load and whenever the
   * app window regains focus. Repointed alongside `scenePath` on folder moves.
   */
  imageScene: z.string().max(MAX_PATH_LENGTH).default(''),
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
   * Per-SCENE ROM overrides for the linked extra scenes (see
   * {@link sceneOverrideSchema}): another outfit of the same character usually
   * keeps most of the base ROM and just replaces a few rows / appends a few
   * frames for that scene's own morphs. Entries whose scene is no longer
   * linked stay stored (re-linking the scene restores the work) but are
   * inactive — only enabled entries for a linked extra scene generate.
   */
  sceneOverrides: z.array(sceneOverrideSchema).max(MAX_PATH_LIST).default([]),
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
  /** G9 only: switch the Genesis 9 Tear figure's shader UV set to "UE5" during the
   *  ROM build, so DTH's Lacrimal Fluid material lines up without the manual
   *  Surfaces-tab step. No-op on non-G9 figures (no UE5 tear UV ships for them). */
  applyUE5TearUV: z.boolean().default(false),
  /** Morph values restored after ROM loading (e.g. breast position). */
  preserveMorphs: z.array(preserveMorphSchema).default([]),
  /** Node transforms memorized before and restored after ROM loading (e.g. eyes). */
  preserveNodeTransforms: z.array(preserveNodeTransformSchema).default([]),
  /**
   * Groom items (hair — usually the fitted cap; its children ride along) kept OUT
   * of the DTH export, so one scene can carry full hair while the ROM export stays
   * clean. The generated script unfits + unparents each item before `doExport` and
   * restores it after — the exporter walks the selected figure's hierarchy and
   * IGNORES visibility (measured July 2026), so exclusion means leaving the
   * hierarchy, not hiding. Labels as shown in Daz's Scene pane.
   */
  /**
   * Per-SCENE groom lists: a character's outfit scenes can carry different hair
   * styles, so the excluded items are tied to the scene they live in. The
   * generated script embeds the whole map and resolves the OPEN scene's list at
   * run time (`Scene.getFilename()`); a scene without an entry excludes nothing
   * (that's its meaning — e.g. a bald outfit scene). Paths repoint alongside
   * `scenePath`/`extraScenes` on folder moves.
   */
  groomScenes: z
    .array(
      z.object({
        scenePath: z.string().max(MAX_PATH_LENGTH),
        nodes: z.array(z.object({ nodeLabel: z.string().max(MAX_NAME_LENGTH) })).default([]),
      }),
    )
    .default([]),
  jcmMorphMods: z.array(jcmMorphModSchema).default([]),
  // Function form: a value default would hand every parsed character THE SAME
  // mutable sections object.
  sections: sectionsSchema.default(() => defaultSections()),
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
 * Filesystem/script-safe base name for generated files, e.g. "ElectraG9":
 * letters, numbers and underscores only, everything else (spaces included)
 * stripped. This strictness is the STUDIO's own guarantee for file and script
 * identifiers — it is NOT what the DTH Exporter requires: the figure name
 * handed to `doExport` may keep spaces and only sheds CSV/filename-breaking
 * characters (see `exporterFigureName` in csv.ts, pinned by test: "A,B"
 * exports as "A B").
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
  if (asset) {
    // Match the FILE name only: a custom base ROM is a full path, and a folder
    // named e.g. "DQS Library" holding "My Linear Base.duf" must not force DQS
    // (wrong skinning = wrong measured frame counts downstream).
    const baseName = asset.replace(/\\/g, '/').split('/').pop() ?? asset
    return /\bDQS\b/i.test(baseName) ? 'dqs' : 'linear'
  }
  return GENERATIONS[character.genesis ?? 'G9'].skinningDefault
}
