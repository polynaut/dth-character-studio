import { defaultSections, genRomIncludes, newId, ROM_SECTIONS } from './types.ts'

import type {
  Gender,
  Morph,
  RomGroup,
  RomPose,
  RomSection,
  RomSectionConfig,
  RomSections,
} from './types.ts'

/**
 * Frame layout + ROM walking: every computation that turns the section/group/
 * pose STRUCTURE into frame numbers, and the group transforms built on top of
 * the same walks. Frame numbers are never stored (the core invariant) — the
 * Daz script and the PoseAsset CSV both derive them from here, so the two
 * artifacts stay aligned by construction. The persisted shape itself (zod
 * schemas, `Character`) lives in types.ts.
 */

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
      boneScaleRef: false,
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
      boneScaleRef: pose.boneScaleRef,
      morphs: pose.morphs.map((morph) => ({ ...morph, prop: swap(morph.prop) })),
    })),
  }
}
