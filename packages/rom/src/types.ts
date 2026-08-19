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
   *  output: `morphJson` emits node/prop/value only, on every path
   *  (extraFrames, art direction). */
  id: z.string().max(MAX_NAME_LENGTH).default(() => newId()),
  /** Scene node the property lives on, e.g. "Genesis9". */
  node: z.string().max(MAX_NAME_LENGTH),
  /** Internal property name, e.g. "body_bs_BodyTone". */
  prop: z.string().max(MAX_NAME_LENGTH),
  value: z.number(),
  // NOTE (schema v34): the sawtooth FLOOR is always 0 now. The `base` (manual
  // non-zero floor, v?–v33) and `autoBase` (floor = the morph's own frame-0
  // scene value, v31–v33) fields are REMOVED — zod strips them from stored
  // definitions on read. A non-zero floor can never export correctly: the DTH
  // Exporter's FBX pass excludes every morph whose ROM keys VARY from the base
  // mesh (measured 2026-08-17, DS4 exporter 2.0.2 — scripted doExport AND the
  // dialog alike), so a walked morph flooring at its dialed value produces a
  // shaped Alembic base against an unshaped FBX base — the two artifacts
  // drift, silently. The runtime now FAILS the frame instead when a walked
  // morph is dialed non-zero at frame 0 (see DthUtils `checkDialedWalkedMorphs`).
})
export type Morph = z.infer<typeof morphSchema>

/**
 * A freshly added morph row — the ONE place a new morph's defaults live. Used
 * by every add path: the pose grid's Add morph / Add pose / insert-between,
 * the art-direction rows and the DAZ morph-CSV import.
 */
export function newMorph(node: string, patch: Partial<Morph> = {}): Morph {
  return { id: newId(), node, prop: '', value: 1, ...patch }
}

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
   * FBX's path into the PoseAsset CSV automatically (`{{DTH_EXPORT_DIR}}` +
   * `{{DTH_EXPORT_NAME}}` tokens the generated Daz script resolves against the
   * real export dir and scene-suffixed figure name at run time).
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

/**
 * A morph set + keyed at FRAME 0 of the ROM — name + the value to set. With
 * `node` empty the runtime applies it on EVERY node of the figure tree that
 * carries the name (the figure and each fitted item), so one row like a
 * clothing "Expand All" reaches whichever outfit pieces the open scene wears.
 * `node` (schema v32) scopes the row to ONE scene node (matched by internal
 * name or label) — a fit dial that exists on every conformed item under the
 * same name (auto-follow twins) would otherwise hit them all. Deliberately
 * unvalidated either way: a scene without the morph (or the node) just skips
 * it (Daz-log warning only).
 */
export const frameZeroMorphSchema = z.object({
  name: z.string().max(MAX_NAME_LENGTH),
  value: z.number(),
  node: z.string().max(MAX_NAME_LENGTH).default(''),
})
export type FrameZeroMorph = z.infer<typeof frameZeroMorphSchema>

/** A node whose transform is memorized before and restored after the ROM load. */
export const preserveNodeTransformSchema = z.object({ nodeLabel: z.string().max(MAX_NAME_LENGTH) })
export type PreserveNodeTransform = z.infer<typeof preserveNodeTransformSchema>

// The JCM "Modify frames" schemas live here (above sceneOverrideSchema) because a
// per-scene `jcm` override embeds jcmMorphModSchema — it must be defined first.
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
 * One SECTION's per-scene ROM override — all of a scene's divergence for that
 * section lives at this one key (schema v24; the pre-v24 shape spread it over
 * four parallel arrays). Precedence is structural now:
 *
 * - `owned` set → the scene OWNS the section: the config replaces the base
 *   wholesale (mode, preset assets, art direction, groups, custom path) and
 *   `replaced`/`added` are cleared at the same key when the editor escalates —
 *   dead sparse layers can no longer linger under an owned section.
 * - else the SPARSE layer: `replaced` substitutes row content by base pose id
 *   (surviving base reorders), `added` appends rows at group ends. Entries
 *   whose base pose/group no longer exists are ignored.
 * - `enabled` overlays the on/off state LAST, over base or owned config — a
 *   plain toggle never "owns" the section.
 */
export const sceneRomOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  owned: romSectionConfigSchema.optional(),
  replaced: z.array(romPoseSchema).default([]),
  added: z
    .array(
      z.object({
        /** The base group's id, or {@link flatSectionGroupId} for a flat
         *  section with no stored group yet. */
        groupId: z.string().max(MAX_NAME_LENGTH),
        poses: z.array(romPoseSchema).default([]),
      }),
    )
    .default([]),
})
export type SceneRomOverride = z.infer<typeof sceneRomOverrideSchema>

/**
 * A character's per-Daz-scene record — "the same character in another
 * scene/outfit". ONE record holds everything scene-scoped: the ROM overrides
 * (section-keyed), the scene's hair list, and the per-scene panels. Panels are
 * PRESENCE-armed (schema v24): a block being present IS the override — there
 * are no stored `enabled` booleans, and disarming a panel deletes its block.
 * An empty-but-present `preserve`/`jcm` block still overrides (it means
 * "hold nothing" / "no JCM mods for this scene").
 *
 * The PRIMARY scene may carry a record too — hair only (its ROM/panels are by
 * definition the base). Records whose scene is no longer linked stay stored
 * (re-linking the scene restores the work) but are inactive. Generation
 * compiles the merged result (see `applySceneOverride`) into the one script's
 * per-scene config delta + a scene-suffixed CSV when the frame layout differs.
 */
export const sceneOverrideSchema = z.object({
  /** Absolute path of the linked Daz scene (`.duf`) this record is for.
   *  Repointed alongside `scenePath`/`extraScenes` on folder moves. */
  scenePath: z.string().max(MAX_PATH_LENGTH),
  /** Section-keyed ROM overrides — {@link sceneRomOverrideSchema}. Any entry
   *  present = the ROM panel is armed for this scene. */
  rom: z
    .partialRecord(romSectionSchema, sceneRomOverrideSchema)
    .default({})
    // An owned config can't put a section into a mode it doesn't support — the
    // same rule the base sectionsSchema enforces, so it can't desync generation.
    .superRefine((rom, ctx) => {
      for (const section of ROM_SECTIONS) {
        const owned = rom[section]?.owned
        if (owned && !SECTION_MODES[section].includes(owned.mode)) {
          ctx.addIssue({
            code: 'custom',
            path: [section, 'owned', 'mode'],
            message: `${section} does not support '${owned.mode}' mode`,
          })
        }
      }
    }),
  /**
   * The scene's hair items (labels as shown in Daz's Scene pane), excluded from
   * the DTH export via the hide-only groom bracket. Hair is per scene BY
   * PRESENCE — no entries means "this scene excludes nothing" (e.g. a bald
   * outfit scene) — and never arms the override on its own. Replaces the
   * pre-v24 character-level `groomScenes` map.
   */
  hair: z.array(z.object({ nodeLabel: z.string().max(MAX_NAME_LENGTH) })).default([]),
  /** Per-scene GENESIS-9 identity dials (FACS detail / flexion / UE5 tear UV) —
   *  present = armed, replacing the base character's three fields. */
  identity: z
    .object({
      facsDetailStrength: z.number().default(1),
      flexionStrength: z.number().default(1),
      applyUE5TearUV: z.boolean().default(false),
    })
    .optional(),
  /** Per-scene "preserve node transforms after ROM loading" list — present =
   *  armed, a full replacement of the base list (empty = "preserve nothing"). */
  preserve: z
    .object({
      nodeTransforms: z.array(preserveNodeTransformSchema).default([]),
    })
    .optional(),
  /** Per-scene "Modify JCM frames" rules — present = armed, a full replacement
   *  of the base `jcmMorphMods` (empty = "no JCM mods for this scene"). */
  jcm: z.array(jcmMorphModSchema).optional(),
  /** Per-scene "Morphs set at frame 0" list — present = armed, a full
   *  replacement of the base `frameZeroMorphs` (empty = "add nothing here"). */
  frameZero: z.array(frameZeroMorphSchema).optional(),
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
 * History: what every version number means — and whether it needed a migration
 * step — is `.ai/schema-history.md`. Bumping this means adding the entry there,
 * in the same commit.
 */
export const CHARACTER_SCHEMA_VERSION = 36

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
 * History: what every version number means — and whether it needed a migration
 * step — is `.ai/schema-history.md`. Bumping this means adding the entry there,
 * in the same commit.
 */
export const RUNTIME_VERSION = 92

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
  /** For a folder-derived product (a "Content Folder Match"): the content-library
   *  folder it was identified from, so the user can see where it lives. '' for
   *  products backed by real metadata (DIM manifest / LOCAL_USER). */
  contentFolder: z.string().max(MAX_PATH_LENGTH).default(''),
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
   * Vertical framing nudge for every picture of this character, as a signed
   * PERCENTAGE OF THE PICTURE ITSELF (positive moves it down). 0 = the default
   * crop, which is what every character got before this existed.
   *
   * Why it is per character and not per generation: Daz frames a figure in the
   * `.tip.png` it renders according to how TALL that figure is, not which
   * Genesis it is — a short character sits high in the square and the default
   * crop takes the top off its head, whatever generation it is. There is no
   * table that can predict it, so it is a knob the user tunes by eye (the avatar
   * dialog, character detail).
   *
   * The unit is what makes ONE value work for every avatar variant in the app,
   * from the 224px header portrait down to a 32px scene chip: each variant
   * over-scans the same square picture by its own zoom, so a percentage of the
   * PICTURE lands the same crop everywhere, where a pixel nudge would not.
   */
  imageOffsetY: z.number().min(-50).max(50).default(0),
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
   * Per-SCENE records (see {@link sceneOverrideSchema}): the ROM overrides,
   * hair list and per-scene panels of every linked scene — the primary's
   * record carries hair only. Records whose scene is no longer linked stay
   * stored (re-linking restores the work) but are inactive — only armed
   * records for a linked extra scene generate.
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
  /** Node transforms memorized before and restored after ROM loading (e.g. eyes). */
  preserveNodeTransforms: z.array(preserveNodeTransformSchema).default([]),
  /** Morphs set + keyed at frame 0 of the ROM (schema v28) — applied on every
   *  node of the figure tree that carries the name, so clothing fit morphs
   *  (e.g. "Expand All") reach whatever the open scene wears; a row's `node`
   *  (v32) narrows it to one item instead. A scene override record can replace
   *  the list per scene ({@link sceneOverrideSchema}). */
  frameZeroMorphs: z.array(frameZeroMorphSchema).default([]),
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
   * Export directory for the DTH Exporter plugin (v1.8.1+): the generated Daz
   * script runs the exporter (`doExport`) into this folder after building the
   * ROM. Every scene exports into its OWN subfolder of this dir, named after
   * the subfolder the scene lives in inside the character folder
   * (`sceneExportSubfolders`), and the PoseAsset CSV is copied in beside the
   * exporter output.
   *
   * DERIVED, not user data (schema v29): always
   * `<character folder>/<project houdiniSubdir>/daz-export` (runtime v64; it was
   * `<dazSubdir>/dth-exports` before) — these files exist only to be imported by
   * Houdini, so they sit beside the `.hip` that reads them (`EXPORTS_FOLDER` in
   * the web layer's `lib/scene-subfolder.ts` is the one spelling of that name).
   * The value needs host context (the project manifest + the character's folder on
   * disk), so like `canonicalImage` it resolves in the web layer's
   * `parseCharacter` — never in this pure core. '' therefore stays a valid
   * TRANSIENT state meaning "not resolved yet" (a definition read outside the
   * desktop app, or before the host has seen it); every consumer keeps
   * treating '' as "no export".
   */
  exportPath: z.string().max(MAX_PATH_LENGTH).default(''),
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
   * When `exportPath` is set, also run the hair (groom) export right after the
   * main DTH export — the Export_Hair per-item alembic pass, inlined into
   * whichever script carries the export (the combined ROM script, or the split
   * `Export_…` script). Only scenes with a hair list export grooms; the
   * standalone `Export_Hair_…` script keeps being generated regardless. No
   * effect without an export path.
   */
  exportHairAssets: z.boolean().default(false),
  /**
   * The DTH release the PoseAsset CSV was last generated for (e.g. "2.4.3"); ''
   * when never generated, or generated with no DTH release configured. The CSV is
   * the only artifact tied to the DTH release, so its provenance lives here in the
   * app-owned JSON (the CSV itself can't carry a version — the Houdini HDA parser
   * reads every row's first column as a type). Detection compares its
   * {@link poseAssetCsvEra} to the active release's; Refresh re-stamps it.
   */
  generatedDthVersion: z.string().max(MAX_NAME_LENGTH).default(''),
  // NOTE: the Daz-product scan results used to live here (`products` /
  // `productsUnmatched` / `productsScannedAt`, v8–v29). They were machine-derived
  // provenance that never affected generation, and a few hundred rows of it in a
  // definition meant to be readable and shared. As of v30 they live in the
  // character's own meta folder (`.dcsmeta/characters/<folder>/products.json` —
  // apps/web `lib/rom/character-products.ts`), written unattended by the pickup.
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
