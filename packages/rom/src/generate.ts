import {
  characterSkinning,
  characterSlug,
  customSections,
  flattenRom,
  genAssetGender,
  genRomIncludes,
} from './types'

import type {
  ArtDirectionFrame,
  CalculateFrom,
  Character,
  DthPoseAsset,
  GenerationMethod,
  GroupSuffix,
  PresetFrames,
} from './types'

// Ground-truth PoseAsset rows for the G9 / DQS / JCM+FAC / Golden Palace /
// UE5 configuration, exported from a fully set-up DazToHuePoseAsset node.
// The placeholder marks where the character's custom sections go.
import poseAssetTemplateG9DqsFacGp from './templates/poseasset-g9-dqs-jcmfac-gp-ue5.csv?raw'
// The fixed PHY preset block (G9 Physics Example ROM) — bones, pose names,
// push-direction XYZ and group offset/radius, ground-truth from a node export.
// Relative frames 0-42; renumbered to absolute on emit.
import poseAssetPhysicsG9 from './templates/poseasset-physics-g9.csv?raw'

const CUSTOM_SECTIONS_PLACEHOLDER = 'CUSTOM_SECTIONS_PLACEHOLDER'

/** Exact .duf paths for the wrapper's options — resolved from the catalog. */
export interface RomPaths {
  jcm?: string
  mouth?: string
  gp?: string
  dk?: string
  phys?: string
}

/**
 * Resolves the exact ROM files for the character's preset selections, using
 * the same logic as the UI (explicit pick wins, else the DQS/FAC-matching
 * default). Returns {} when no catalog is available — the wrapper then falls
 * back to the DTH_POSES_PATH resolution in DthOptions.dsa.
 */
export function resolveRomPaths(
  character: Character,
  catalog: { folder: string; assets: Array<DthPoseAsset> },
): RomPaths {
  if (!catalog.folder || catalog.assets.length === 0) return {}
  const { sections, genesis, gender } = character
  const join = (relPath: string) => `${catalog.folder.replaceAll('\\', '/')}/${relPath}`
  const forGenesis = (asset: DthPoseAsset) => asset.genesis === null || asset.genesis === genesis
  const paths: RomPaths = {}

  const jcmPreset = sections.JCM.enabled && sections.JCM.mode === 'preset'
  const facPreset = sections.FAC.enabled && sections.FAC.mode === 'preset'
  if (jcmPreset) {
    const available = catalog.assets.filter((a) => a.section === 'JCM' && forGenesis(a))
    const explicit = available.find((a) => `${a.name}.duf` === sections.JCM.presetAssets[0])
    const effective =
      explicit ??
      available.find((a) => a.skinning === 'dqs' && a.includesFac === facPreset) ??
      available.find((a) => a.skinning === 'dqs') ??
      available[0]
    if (effective) paths.jcm = join(effective.relPath)
    if (facPreset) {
      const skinning = effective?.skinning ?? characterSkinning(character)
      const mouths = catalog.assets.filter((a) => a.section === 'FAC' && forGenesis(a))
      const mouth = mouths.find((a) => a.skinning === skinning) ?? mouths[0]
      if (mouth) paths.mouth = join(mouth.relPath)
    }
  }

  // Custom JCM: the base ROM path comes from the user (set in the generator,
  // not the catalog); still resolve the FAC mouth from the catalog when enabled.
  if (sections.JCM.enabled && sections.JCM.mode === 'custom' && facPreset && !paths.mouth) {
    const skinning = characterSkinning(character)
    const mouths = catalog.assets.filter((a) => a.section === 'FAC' && forGenesis(a))
    const mouth = mouths.find((a) => a.skinning === skinning) ?? mouths[0]
    if (mouth) paths.mouth = join(mouth.relPath)
  }

  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  if (genPreset) {
    const roms = genRomIncludes(gender, sections.GEN.presetAssets)
    const genAssets = catalog.assets.filter((a) => a.section === 'GEN' && forGenesis(a))
    if (roms.gp) {
      const gp = genAssets.find((a) => genAssetGender(a.name) === 'female')
      if (gp) paths.gp = join(gp.relPath)
    }
    if (roms.dk) {
      const dk = genAssets.find((a) => genAssetGender(a.name) === 'male')
      if (dk) paths.dk = join(dk.relPath)
    }
  }

  if (sections.PHY.enabled && sections.PHY.mode === 'preset') {
    const phys = catalog.assets.find((a) => a.section === 'PHY' && forGenesis(a))
    if (phys) paths.phys = join(phys.relPath)
  }
  return paths
}

/**
 * Generators that compile a Character into the DTH workflow artifacts.
 * Formats are taken from real files in soltude/DazToHue-Scripts
 * (ElectraG9_FBMs.json / .csv, DthWorkflowElectraG9.dsa) and from the
 * PoseAsset node CSV sample provided by mrpdean.
 */

export interface GeneratedFile {
  fileName: string
  content: string
  /** Where the file is consumed — Daz files can be written straight into DazToHue-Scripts. */
  target: 'daz' | 'houdini'
  /** Marks outputs whose format is not yet confirmed with the DTH creator. */
  experimental?: boolean
}

function morphJson(morph: { node: string; prop: string; value: number; base?: number; autoBase?: boolean }) {
  return {
    node: morph.node,
    prop: morph.prop,
    value: morph.value,
    ...(morph.base !== undefined ? { base: morph.base } : {}),
    ...(morph.autoBase ? { autoBase: true } : {}),
  }
}

/**
 * <Name>_FBMs.json — extra ROM frames consumed by DthWorkflow.dsa via
 * `options.extraJSONs`. Frames are 0-based relative offsets from ROM start
 * (first custom frame = 0), matching the 0-based DazToHue-Scripts handoff
 * (a ROM block reserves its full frame count; the next section starts after it).
 */
/**
 * The extra-ROM-frame payload (meta + frames + optional groups) shared by the
 * legacy `<Name>_FBMs.json` file and the inline `config.extraFrames` of the
 * single-file character script. Frames are 0-based offsets from ROM start.
 */
export function buildFbmData(character: Character) {
  const flat = flattenRom(character.sections)

  // Groups with a non-individual generation method need a differently shaped
  // timeline (sustained keys instead of sawtooth) — emitted as an optional
  // `groups` array that DthUtils honors. Individual/default groups are
  // omitted entirely, keeping the format backward compatible.
  const groupRanges = new Map<string, { start: number; end: number; frame: (typeof flat)[0] }>()
  for (const frame of flat) {
    const range = groupRanges.get(frame.group.id)
    if (range) range.end = frame.frame
    else groupRanges.set(frame.group.id, { start: frame.frame, end: frame.frame, frame })
  }
  const groups = [...groupRanges.values()]
    .filter(({ frame }) => !['default', 'individual'].includes(frame.group.method))
    .map(({ start, end, frame }) => ({
      section: frame.section,
      name: frame.group.label || frame.name,
      method: frame.group.method,
      startFrame: start,
      endFrame: end,
    }))

  return {
    meta: {
      version: '1.0',
      // The single generic flag drives both per-block reset flags the DTH
      // runtime understands; the runtime only acts on whichever genital ROM's
      // art-direction data is actually present (GP for female, DK for male).
      resetGPBeforeApplying: character.resetGenBeforeApplying,
      resetDKBeforeApplying: character.resetGenBeforeApplying,
      description: `${character.name} Full Body Morphs - relative frame offsets from ROM start`,
    },
    frames: flat.map((frame) => ({
      frame: frame.frame,
      section: frame.section,
      name: frame.name,
      morphs: frame.morphs.map(morphJson),
    })),
    ...(groups.length > 0 ? { groups } : {}),
  }
}

export function toDazFbmJson(character: Character): GeneratedFile {
  return {
    fileName: `${characterSlug(character)}_FBMs.json`,
    content: JSON.stringify(buildFbmData(character), null, 2) + '\n',
    target: 'daz',
  }
}

/**
 * <Name>_FBMs.csv — same data as the JSON in the flat CSV form used by
 * DthWorkflowFromCSV.dsa: `frame,section,name,node,prop,value`, one line per
 * morph, 0-based (the first morph is at frame 0).
 */
export function toDazFbmCsv(character: Character): GeneratedFile {
  const slug = characterSlug(character)
  const lines: Array<string> = []
  for (const frame of flattenRom(character.sections)) {
    for (const morph of frame.morphs) {
      lines.push(
        `${frame.frame},${frame.section},${frame.name},${morph.node},${morph.prop},${morph.value}`,
      )
    }
  }
  return {
    fileName: `${slug}_FBMs.csv`,
    content: lines.join('\n') + '\n',
    target: 'daz',
  }
}

/**
 * DthWorkflow<Name>.dsa — thin wrapper that configures and runs the
 * DazToHue-Scripts workflow (one-click full ROM apply in Daz Studio).
 */
export function toWorkflowDsa(character: Character, romPaths: RomPaths = {}): GeneratedFile {
  const slug = characterSlug(character)
  const { sections } = character
  // Preset sections compile into the DthWorkflow include flags; custom
  // sections travel as extra-JSON frames instead.
  const includeJCM = sections.JCM.enabled && sections.JCM.mode === 'preset'
  const includeFAC = sections.FAC.enabled && sections.FAC.mode === 'preset'
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  // No explicit selection: the character's gender decides (female → GP, male → DK).
  const genRoms = genRomIncludes(character.gender, sections.GEN.presetAssets)
  const includeGP = genPreset && genRoms.gp
  const includeDK = genPreset && genRoms.dk
  const gpArt = genPreset && includeGP && hasArtDirection(character, 'gp')
  const dkArt = genPreset && includeDK && hasArtDirection(character, 'dk')
  const includePhysics = sections.PHY.enabled && sections.PHY.mode === 'preset'
  const preserve = character.preserveMorphs
    .map((m) => `    { name: ${JSON.stringify(m.name)}, keepValue: ${m.keepValue} }`)
    .join(',\n')
  const preserveTransforms = character.preserveNodeTransforms
    .map((t) => `    { nodeLabel: ${JSON.stringify(t.nodeLabel)} }`)
    .join(',\n')
  const jcmMods = character.jcmMorphMods.length
    ? JSON.stringify(character.jcmMorphMods, null, 4)
    : ''

  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Workflow for ${character.name} — generated by DTH Character Studio${character.studioVersion ? ` v${character.studioVersion}` : ''}
// Uses soltude/DazToHue-Scripts framework

var dir_self = new DzDir(new DzFileInfo(getScriptFileName()).path());
include(dir_self.filePath("DthWorkflow.dsa"));

options.bIncludeJCM = ${includeJCM};
options.bIncludeFAC = ${includeFAC};
options.bIncludeDK = ${includeDK};
options.bIncludeGP = ${includeGP};
options.bIncludePhysics = ${includePhysics};
options.bDQS = ${characterSkinning(character) === 'dqs'};
options.FACsDetailStrength = ${character.facsDetailStrength};
options.FlexionStrength = ${character.flexionStrength};
${
  romPaths.jcm || romPaths.mouth || romPaths.gp || romPaths.dk || romPaths.phys
    ? `
// Exact ROM files resolved from the studio's preset selection
${romPaths.jcm ? `options.jcmRomPath = ${JSON.stringify(romPaths.jcm)};\n` : ''}${
        romPaths.mouth ? `options.mouthRomPath = ${JSON.stringify(romPaths.mouth)};\n` : ''
      }${romPaths.gp ? `options.gpRomPath = ${JSON.stringify(romPaths.gp)};\n` : ''}${
        romPaths.dk ? `options.dkRomPath = ${JSON.stringify(romPaths.dk)};\n` : ''
      }${romPaths.phys ? `options.physRomPath = ${JSON.stringify(romPaths.phys)};\n` : ''}`
    : ''
}

// Extra ROM frames (FBMs etc.) generated from the same character definition
options.extraJSONs = [
    dir_self.filePath("${slug}_FBMs.json")
];
${
  preserve
    ? `
// Morph values restored after ROM loading
options.preserveMorphs = [
${preserve}
];
`
    : ''
}${
    preserveTransforms
      ? `
// Node transforms memorized before and restored after ROM loading
options.preserveNodeTransforms = [
${preserveTransforms}
];
`
      : ''
  }${
    jcmMods
      ? `
// JCM morph modifications - drive morphs proportionally to bone rotation
options.jcmMorphMods = ${jcmMods};
`
      : ''
  }${
    gpArt
      ? `
// Per-character Golden Palace art direction (generated alongside this script)
options.gpArtDirectionPath = dir_self.filePath("${slug}_GP9ArtDirection.json");
`
      : ''
  }${
    dkArt
      ? `
// Per-character Dicktator art direction (generated alongside this script)
options.dkArtDirectionPath = dir_self.filePath("${slug}_DK9ArtDirection.json");
`
      : ''
  }
// Run the workflow
ApplyDTHWorkflow(options);
`
  return { fileName: `DthWorkflow${slug}.dsa`, content, target: 'daz' }
}

// Menu indices of the PoseAsset node parameters (docs/poseasset-csv-spec.md).
const SUFFIX_INDEX: Record<GroupSuffix, number> = { left: 0, centre: 1, right: 2 }
const METHOD_INDEX: Record<GenerationMethod, number> = {
  default: 0,
  individual: 1,
  additive: 2,
  cumulative: 3,
  advancedAdditive: 4,
}
const CALC_INDEX: Record<CalculateFrom, number> = {
  default: 0,
  restPose: 1,
  animationFrame: 2,
}

/** Pose names become UE morph names: letters/numbers/underscores only. */
export function sanitizePoseName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]+/g, '')
}

/** Frame counts of the pre-made ROM blocks on the timeline. */

/**
 * CSV rows for the enabled custom sections, with absolute timeline frames
 * continuing after the preset blocks. FBM/MISC are flat lists in the node;
 * the grouped sections emit their GROUP header rows with menu indices.
 */
function customPoseAssetRows(character: Character, lastPresetFrame: number): Array<string> {
  const rows: Array<string> = []
  let frame = lastPresetFrame
  for (const { section, config } of customSections(character.sections)) {
    if (section === 'FBM' || section === 'MISC') {
      const keyword = section === 'MISC' ? 'MIS' : 'FBM'
      for (const group of config.groups) {
        for (const pose of group.poses) {
          frame += 1
          rows.push(`${keyword},${frame},${sanitizePoseName(pose.name)},${pose.referenceFbx ?? ''}`)
        }
      }
      continue
    }
    for (const group of config.groups) {
      if (group.poses.length === 0) continue
      const method = METHOD_INDEX[group.method]
      const suffix = SUFFIX_INDEX[group.suffix]
      const calc = CALC_INDEX[group.calculateFrom]
      if (section === 'JCM') rows.push(`JCMGROUP,${method},${suffix},${group.label}`)
      else if (section === 'FAC') rows.push(`FACGROUP,${calc},${method},${suffix}`)
      else if (section === 'EXP') rows.push(`EXPGROUP,${calc},${method},${suffix}`)
      else if (section === 'GEN') rows.push(`GENGROUP,${calc},${method},${suffix},${group.label}`)
      else if (section === 'PHY') rows.push(`PHYGROUP,${calc},${suffix},${group.label},,`)
      for (const pose of group.poses) {
        frame += 1
        const name = sanitizePoseName(pose.name)
        if (section === 'GEN') rows.push(`GEN,${frame},${name},${pose.referenceFbx ?? ''}`)
        else rows.push(`${section},${frame},${name}`)
      }
    }
  }
  return rows
}

/**
 * The fixed PHY preset block (G9 Physics Example ROM) as PoseAsset rows, with
 * frames offset to `startFrame`. The mapping — bones, pose names, push-direction
 * XYZ, group offset/radius — is ground-truth from a node export; only the PHY
 * row frames are renumbered. PHYGROUP rows carry no frame and pass through.
 */
function physicsPoseAssetRows(startFrame: number): Array<string> {
  return poseAssetPhysicsG9
    .replace(/\r\n/g, '\n')
    .trimEnd()
    .split('\n')
    .map((line) => {
      if (!line.startsWith('PHY,')) return line
      const cols = line.split(',')
      cols[1] = String(startFrame + Number(cols[1]))
      return cols.join(',')
    })
}

/**
 * PoseAsset node CSV for Houdini/DTH (import format reverse-engineered from
 * the node's parser, see docs/poseasset-csv-spec.md).
 *
 * For the validated G9/DQS/JCM+FAC(+GP)/UE5 configuration the preset
 * sections come verbatim from a ground-truth export of a working node; the
 * character's custom sections are spliced in with continuing frame numbers.
 * Other configurations fall back to generating only the custom sections and
 * stay flagged experimental.
 */
export function toPoseAssetCsv(character: Character, frames: PresetFrames): GeneratedFile {
  const { sections } = character
  const jcmPreset = sections.JCM.enabled && sections.JCM.mode === 'preset'
  // A custom JCM asset (user .duf path) occupies the same base-ROM block as a
  // pre-defined one, so it counts toward the preset frame length.
  const jcmRom =
    jcmPreset ||
    (sections.JCM.enabled &&
      sections.JCM.mode === 'custom' &&
      sections.JCM.customAssetPath.trim() !== '')
  const facPreset = sections.FAC.enabled && sections.FAC.mode === 'preset'
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const roms = genRomIncludes(character.gender, sections.GEN.presetAssets)
  const includeGp = genPreset && roms.gp
  const includeDk = genPreset && roms.dk
  const includePhys = sections.PHY.enabled && sections.PHY.mode === 'preset'

  // The ground-truth template bakes the *preset* base ROM rows at fixed frames,
  // so it only fits the all-preset validated config — a custom JCM base goes
  // through the fully-measured path below instead.
  const matchesTemplate =
    character.genesis === 'G9' &&
    characterSkinning(character) === 'dqs' &&
    jcmPreset &&
    facPreset &&
    !includeDk

  if (matchesTemplate) {
    const lines = poseAssetTemplateG9DqsFacGp.replace(/\r\n/g, '\n').trimEnd().split('\n')
    const placeholder = lines.indexOf(CUSTOM_SECTIONS_PLACEHOLDER)
    let head = lines.slice(0, placeholder)
    const tail = lines.slice(placeholder + 1)
    if (!includeGp) {
      head = head.filter((line) => !line.startsWith('GEN'))
    }
    // Physics is a fixed preset block (the G9 Physics Example ROM) inserted after
    // the GEN/GP block and before the custom sections.
    const physStart = frames.base + (includeGp ? frames.gp : 0)
    const physRows = includePhys ? physicsPoseAssetRows(physStart) : []
    const lastPresetFrame =
      frames.base - 1 + (includeGp ? frames.gp : 0) + (includePhys ? frames.phys : 0)
    const customRows = customPoseAssetRows(character, lastPresetFrame)
    return {
      fileName: poseAssetFileName(character),
      content: [...head, ...physRows, ...customRows, ...tail].join('\n') + '\n',
      target: 'houdini',
    }
  }

  // Unvalidated configuration (linear, no FAC, Dicktator, custom base, …): only
  // the custom sections, frames continuing after the measured preset length.
  const lastPresetFrame =
    (jcmRom ? frames.base - 1 : -1) +
    (includeGp ? frames.gp : 0) +
    (includeDk ? frames.dk : 0) +
    (includePhys ? frames.phys : 0)
  return {
    fileName: poseAssetFileName(character),
    content: customPoseAssetRows(character, Math.max(lastPresetFrame, 0)).join('\n') + '\n',
    target: 'houdini',
    experimental: true,
  }
}

function hasArtDirection(character: Character, rom: 'gp' | 'dk'): boolean {
  return character.sections.GEN.artDirection.some(
    (frame) => frame.rom === rom && frame.morphs.length > 0,
  )
}

/**
 * Per-character art direction for the pre-made GP/DK ROM blocks — same
 * format as GP9_ArtDirection.json / DK9_ArtDirection.json in
 * DazToHue-Scripts; consumed via options.gpArtDirectionPath /
 * options.dkArtDirectionPath in the generated wrapper.
 */
/**
 * Per-character art-direction payload for a pre-made ROM block — the data shared
 * by the legacy `<Name>_<GP9|DK9>ArtDirection.json` file and the inline
 * `config.gpArtDirection` / `config.dkArtDirection` of the character script.
 * Returns null when the character has no art-direction morphs for that ROM.
 */
export function buildArtDirectionData(
  character: Character,
  rom: 'gp' | 'dk',
  section: 'GP9' | 'DK9',
  label: string,
) {
  const frames = character.sections.GEN.artDirection
    .filter((frame): frame is ArtDirectionFrame => frame.rom === rom && frame.morphs.length > 0)
    .sort((a, b) => a.frame - b.frame)
  if (frames.length === 0) return null
  return {
    meta: {
      version: '1.0',
      description: `${character.name} ${label} art direction - relative offsets from the ${section} ROM start`,
    },
    frames: frames.map((frame) => ({
      frame: frame.frame,
      section,
      name: frame.name,
      morphs: frame.morphs.map(morphJson),
    })),
  }
}

export function toArtDirectionJsons(character: Character): Array<GeneratedFile> {
  const slug = characterSlug(character)
  const files: Array<GeneratedFile> = []
  const variants = [
    { rom: 'gp' as const, section: 'GP9' as const, label: 'Golden Palace' },
    { rom: 'dk' as const, section: 'DK9' as const, label: 'Dicktator' },
  ]
  for (const { rom, section, label } of variants) {
    const json = buildArtDirectionData(character, rom, section, label)
    if (!json) continue
    files.push({
      fileName: `${slug}_${section}ArtDirection.json`,
      content: JSON.stringify(json, null, 2) + '\n',
      target: 'daz',
    })
  }
  return files
}

/** File base name for the self-contained character script: `<Name>_<Genesis>`. */
export function characterScriptName(character: Character): string {
  return `${characterSlug(character)}_${character.genesis}`
}

/** File name for the Houdini PoseAsset CSV: `<Name>_PoseAsset.csv`. */
export function poseAssetFileName(character: Character): string {
  return `${characterSlug(character)}_PoseAsset.csv`
}

/**
 * The one self-contained Daz script for a character: `<Name>_<Genesis>.dsa`.
 * It includes the DTH runtime (DthWorkflow.dsa, installed alongside it) and
 * makes a single `ApplyDTHCharacter(config)` call whose argument carries the
 * FULL character configuration AND all ROM morph definitions inline — replacing
 * the old wrapper + FBMs.json + CSV + art-direction JSON files.
 */
export function toCharacterScriptDsa(character: Character, romPaths: RomPaths = {}): GeneratedFile {
  const { sections } = character
  // JCM custom mode: a user-supplied .duf path used as the base ROM, just like
  // a pre-defined asset (so it still drives bIncludeJCM + jcmRomPath).
  const jcmCustomPath = sections.JCM.mode === 'custom' ? sections.JCM.customAssetPath.trim() : ''
  const includeJCM =
    sections.JCM.enabled && (sections.JCM.mode === 'preset' || jcmCustomPath !== '')
  const includeFAC = sections.FAC.enabled && sections.FAC.mode === 'preset'
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  // No explicit selection: the character's gender decides (female → GP, male → DK).
  const genRoms = genRomIncludes(character.gender, sections.GEN.presetAssets)
  const includeGP = genPreset && genRoms.gp
  const includeDK = genPreset && genRoms.dk
  const includePhysics = sections.PHY.enabled && sections.PHY.mode === 'preset'

  const config: Record<string, unknown> = {
    genesis: character.genesis,
    gender: character.gender,
    bIncludeJCM: includeJCM,
    bIncludeFAC: includeFAC,
    bIncludeDK: includeDK,
    bIncludeGP: includeGP,
    bIncludePhysics: includePhysics,
    bDQS: characterSkinning(character) === 'dqs',
    FACsDetailStrength: character.facsDetailStrength,
    FlexionStrength: character.flexionStrength,
  }
  // Custom JCM path wins over the catalog-resolved one.
  const jcmRomPath = jcmCustomPath || romPaths.jcm
  if (jcmRomPath) config.jcmRomPath = jcmRomPath
  if (romPaths.mouth) config.mouthRomPath = romPaths.mouth
  if (romPaths.gp) config.gpRomPath = romPaths.gp
  if (romPaths.dk) config.dkRomPath = romPaths.dk
  if (romPaths.phys) config.physRomPath = romPaths.phys
  if (character.preserveMorphs.length) config.preserveMorphs = character.preserveMorphs
  if (character.preserveNodeTransforms.length)
    config.preserveNodeTransforms = character.preserveNodeTransforms
  if (character.jcmMorphMods.length) config.jcmMorphMods = character.jcmMorphMods
  // All extra ROM frames inline (was <Name>_FBMs.json).
  config.extraFrames = buildFbmData(character)
  // Per-character art direction inline (was <Name>_<GP9|DK9>ArtDirection.json).
  const gpArt = includeGP ? buildArtDirectionData(character, 'gp', 'GP9', 'Golden Palace') : null
  const dkArt = includeDK ? buildArtDirectionData(character, 'dk', 'DK9', 'Dicktator') : null
  if (gpArt) config.gpArtDirection = gpArt
  if (dkArt) config.dkArtDirection = dkArt

  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH ROM for ${character.name} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${character.studioVersion}` : ''}.
// Self-contained: this single ApplyDTHCharacter() call carries the full
// character config AND all ROM morph definitions inline. It needs the DTH
// runtime (the hidden .DthWorkflow.dsa + .DthUtils.dsa + .DthOptions.dsa), which
// the studio installs ONCE in the DTH-Character-Studio root — two levels up from
// this script's <project>/<character>/ subfolder.

var dir_self = new DzDir(new DzFileInfo(getScriptFileName()).path());
include(dir_self.filePath("../../.DthWorkflow.dsa"));

ApplyDTHCharacter(${JSON.stringify(config, null, 2)});
`
  return { fileName: `${characterScriptName(character)}.dsa`, content, target: 'daz' }
}

/**
 * The files written on save: the one self-contained character script (Daz) and
 * the PoseAsset CSV (Houdini). The legacy split generators (toDazFbmJson /
 * toWorkflowDsa / toArtDirectionJsons …) remain exported for tests and reuse.
 */
export function generateAll(
  character: Character,
  romPaths: RomPaths,
  frames: PresetFrames,
): Array<GeneratedFile> {
  return [toCharacterScriptDsa(character, romPaths), toPoseAssetCsv(character, frames)]
}
