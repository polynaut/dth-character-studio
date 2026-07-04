import {
  characterSkinning,
  characterSlug,
  customSections,
  flattenRom,
  genAssetGender,
  genRomIncludes,
  poseAssetCsvEra,
  RUNTIME_VERSION,
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
// DTH-Runtime: v${RUNTIME_VERSION}
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
 * Last preset-block frame on the timeline — the frame custom sections continue
 * after. Mirrors the offset {@link toPoseAssetCsv} applies, so the timeline the
 * runtime builds lines up with the CSV (and with the exporter's frame numbers).
 */
function presetEndFrame(character: Character, frames: PresetFrames): number {
  const { sections } = character
  const jcmRom =
    sections.JCM.enabled &&
    (sections.JCM.mode === 'preset' || sections.JCM.customAssetPath.trim() !== '')
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const roms = genRomIncludes(character.gender, sections.GEN.presetAssets)
  const includePhys = sections.PHY.enabled && sections.PHY.mode === 'preset'
  return (
    (jcmRom ? frames.base - 1 : -1) +
    (genPreset && roms.gp ? frames.gp : 0) +
    (genPreset && roms.dk ? frames.dk : 0) +
    (includePhys ? frames.phys : 0)
  )
}

/**
 * Absolute timeline frames of the poses that carry a reference-skeleton FBX
 * (`referenceFbx` — the bone-scaling poses in GEN/FBM/MISC). These are the DTH
 * Exporter's "reference frames". Frames are assigned in the same canonical order
 * as the PoseAsset CSV, so they match the timeline `ApplyDTHCharacter` builds.
 */
export function referenceFrames(character: Character, frames: PresetFrames): Array<number> {
  let frame = Math.max(presetEndFrame(character, frames), 0)
  const out: Array<number> = []
  for (const { config } of customSections(character.sections)) {
    for (const group of config.groups) {
      for (const pose of group.poses) {
        frame += 1
        if ((pose.referenceFbx ?? '').trim()) out.push(frame)
      }
    }
  }
  return out
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
export function toPoseAssetCsv(
  character: Character,
  frames: PresetFrames,
  /**
   * CSV era from {@link poseAssetCsvEra} — selects the output variant. Today only
   * the baseline era exists, so every recognised era uses the generator below;
   * this parameter is the seam where a future breaking era (e.g. 2.5.x) branches
   * to a different layout, shipped together with adding that release to
   * {@link POSEASSET_CSV_BREAKING_VERSIONS}.
   */
  era: string = '',
): GeneratedFile {
  void era // single CSV variant today; `era` is the seam for future variants
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

/** File name of the ROM run log the generated Daz script writes into the
 *  character folder (fixed name — the studio reads it back to surface errors). */
export const ROM_RUN_LOG_FILE = 'dth_rom_run_log.json'

/** File name for the Houdini PoseAsset CSV: `<Name>_pose_asset.csv` (DTH naming). */
export function poseAssetFileName(character: Character): string {
  return `${characterSlug(character)}_pose_asset.csv`
}

/**
 * The DTH-Exporter run + PoseAsset-CSV delivery, as a Daz Script block. Pure
 * native Daz API (no DTH runtime needed), so it works both appended to the ROM
 * script and as the body of a standalone Export script. Empty when no export dir
 * is set. The CSV copy is included only when the source folder is known
 * (charFolderAbs); the export nests under the open scene's name when
 * `exportSceneSubfolders` is on (resolved at run time).
 */
function buildExportBlock(
  character: Character,
  frames: PresetFrames | undefined,
  charFolderAbs: string | undefined,
): string {
  const exportDir = character.exportPath.trim()
  if (!exportDir) return ''
  const refFrames = frames ? referenceFrames(character, frames).join(' ') : ''
  const sceneSubfolderBlock = character.exportSceneSubfolders
    ? `    var dthSceneFile = Scene.getFilename();
    if (dthSceneFile != "") {
        var dthSceneName = new DzFileInfo(dthSceneFile).completeBaseName();
        if (dthSceneName != "") dthExportDir = dthExportDir + "/" + dthSceneName;
    }
`
    : ''
  const csvCopyBlock = charFolderAbs
    ? `    // Copy the generated PoseAsset CSV next to the exporter output.
    var dthCsvName = ${JSON.stringify(poseAssetFileName(character))};
    var dthCsvSrcDir = new DzDir(${JSON.stringify(charFolderAbs.replace(/\\/g, '/'))});
    if (dthCsvSrcDir.exists(dthCsvName)) {
        var dthCsvDstDir = new DzDir(dthExportDir);
        if (!dthCsvDstDir.exists()) dthCsvDstDir.mkpath(dthExportDir);
        var dthCsvDst = dthCsvDstDir.absoluteFilePath(dthCsvName);
        var dthCsvOld = new DzFile(dthCsvDst);
        if (dthCsvOld.exists()) dthCsvOld.remove();
        var dthCsvSrc = new DzFile(dthCsvSrcDir.absoluteFilePath(dthCsvName));
        if (dthCsvSrc.copy(dthCsvDst)) print("Copied " + dthCsvName + " to " + dthCsvDst);
        else print("Failed to copy " + dthCsvName + " to " + dthCsvDst);
    } else {
        print("PoseAsset CSV not found in the character folder — nothing to copy.");
    }
`
    : ''
  return `var dthExportAction = MainWindow.getActionMgr().findAction("DazToHueExporterAction");
if (dthExportAction) {
    var dthExportDir = ${JSON.stringify(exportDir.replace(/\\/g, '/'))};
${sceneSubfolderBlock}    dthExportAction.doExport(dthExportDir, ${JSON.stringify(character.name)}, ${JSON.stringify(refFrames)}, false);
${csvCopyBlock}} else {
    print("DazToHue Exporter Action not found — install the DTH Exporter Plugin v1.8.1+.");
}
`
}

/**
 * The one self-contained Daz script for a character: `ROM_<Name>_<Genesis>.dsa`.
 * It includes the DTH runtime (DthWorkflow.dsa, installed alongside it) and
 * makes a single `ApplyDTHCharacter(config)` call whose argument carries the
 * FULL character configuration AND all ROM morph definitions inline — replacing
 * the old wrapper + FBMs.json + CSV + art-direction JSON files.
 */
export function toCharacterScriptDsa(
  character: Character,
  romPaths: RomPaths = {},
  frames?: PresetFrames,
  /**
   * Absolute path of the character's folder — where the PoseAsset CSV is written
   * at generation time. When provided (the desktop app), the generated script
   * moves that CSV into the resolved export dir at run time. Omitted in pure/web
   * contexts, where the move block is skipped.
   */
  charFolderAbs?: string,
): GeneratedFile {
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
    // Run-log metadata: the runtime writes dth_rom_run_log.json (character
    // folder) after every run; the studio reads it back to surface problems.
    characterName: character.name,
    runtimeVersion: RUNTIME_VERSION,
    studioVersion: character.studioVersion ?? '',
    bIncludeJCM: includeJCM,
    bIncludeFAC: includeFAC,
    bIncludeDK: includeDK,
    bIncludeGP: includeGP,
    bIncludePhysics: includePhysics,
    bDQS: characterSkinning(character) === 'dqs',
    FACsDetailStrength: character.facsDetailStrength,
    FlexionStrength: character.flexionStrength,
  }
  if (charFolderAbs) {
    config.runLogPath = `${charFolderAbs.replace(/\\/g, '/')}/${ROM_RUN_LOG_FILE}`
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

  // Optional auto-export: when an export directory is set, the ROM build is
  // followed by a DTH Exporter run. With `exportWithRomScript` (the default) that
  // export block is appended here — one combined script. Otherwise it's split off
  // into a standalone Export_ script (see toExportScriptDsa).
  const exportDir = character.exportPath.trim()
  const exportBlock =
    exportDir && character.exportWithRomScript !== false
      ? `
    // Export to the DTH pipeline via the Exporter Plugin (v1.8.1+) after the ROM build.
${buildExportBlock(character, frames, charFolderAbs)
  .split('\n')
  .map((line) => (line ? `    ${line}` : line))
  .join('\n')}`
      : ''

  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH ROM for ${character.name} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${character.studioVersion}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Self-contained: this single ApplyDTHCharacter() call carries the full
// character config AND all ROM morph definitions inline. It needs the DTH
// runtime (the hidden .DthWorkflow.dsa + .DthUtils.dsa + .DthOptions.dsa), which
// the studio installs ONCE in the DTH-Character-Studio root — two levels up from
// this script's <project>/<character>/ subfolder.

var dthCharacterConfig = ${JSON.stringify(config, null, 2)};

// Even a catastrophic failure (runtime files missing, an unexpected exception)
// must reach the studio: write a minimal run log and tell the user here.
try {
    var dir_self = new DzDir(new DzFileInfo(getScriptFileName()).path());
    include(dir_self.filePath("../../.DthWorkflow.dsa"));

    ApplyDTHCharacter(dthCharacterConfig);
${exportBlock}} catch (dthErr) {
    try {
        if (dthCharacterConfig.runLogPath) {
            var dthLogFile = new DzFile(dthCharacterConfig.runLogPath);
            if (dthLogFile.open(dthLogFile.WriteOnly, dthLogFile.Truncate)) {
                dthLogFile.write(JSON.stringify({
                    logVersion: 1,
                    character: dthCharacterConfig.characterName,
                    runtimeVersion: dthCharacterConfig.runtimeVersion,
                    studioVersion: dthCharacterConfig.studioVersion,
                    finishedAt: new Date().toString(),
                    finishedAtMs: new Date().getTime(),
                    ok: false,
                    errors: ["Unexpected script error: " + dthErr],
                    failedMorphs: []
                }, null, 2));
                dthLogFile.close();
            }
        }
    } catch (dthErr2) { /* even the log failed — the dialog below still fires */ }
    MessageBox.critical(
        "The ROM script failed unexpectedly:\\n\\n" + dthErr +
        "\\n\\nSwitch back to DTH Character Studio to see the details.",
        "DTH Character Studio", "&OK");
}
`
  const baseName = characterScriptName(character)
  return { fileName: `ROM_${baseName}.dsa`, content, target: 'daz' }
}

/**
 * The standalone Export script (`Export_<Name>_<Genesis>.dsa`) — runs the DTH
 * Exporter on the ROM already built on the timeline and delivers the PoseAsset
 * CSV, without rebuilding the (slow) ROM. Generated only when an export dir is
 * set and `exportWithRomScript` is false. Native Daz API only — no runtime
 * include — so it must run after the ROM_ script in the same Daz session.
 */
export function toExportScriptDsa(
  character: Character,
  frames?: PresetFrames,
  charFolderAbs?: string,
): GeneratedFile {
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Export for ${character.name} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${character.studioVersion}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Runs the DTH Exporter on the ROM already built on the timeline and delivers
// the PoseAsset CSV — it does NOT rebuild the ROM. Run it after the ROM script
// (ROM_${characterScriptName(character)}.dsa) in the same Daz session.

${buildExportBlock(character, frames, charFolderAbs)}`
  return { fileName: `Export_${characterScriptName(character)}.dsa`, content, target: 'daz' }
}

/** Inputs for the per-character product-scan script — both supplied by the host
 *  (the studio), never by the pure core. Present ⇔ the project opted into the
 *  Daz Products feature. */
export interface ScanProductsOptions {
  /** The DAZ Install Manager `ManifestFiles` folder the scan reads installed
   *  products from (app-global setting). May be '' — the runtime then warns and
   *  reports every asset as unmatched. */
  dimManifestPath: string
  /** Absolute path of the FOLDER the scan writes its per-scene CSVs into (app-derived,
   *  under app-local-data, keyed by project + character). The runtime names each CSV
   *  after the open Daz scene, so scanning different outfit scenes doesn't overwrite. */
  outputDir: string
  /** The DAZ content library root (settings `dazLibraryFolder`). Lets the scan read
   *  each matched product's content-metadata `.dsx` (under `Runtime/Support/`) to
   *  fill in the artist (and version, when present). May be '' — enrichment is then
   *  skipped and artist/version stay "Unknown". */
  dazLibraryFolder: string
}

/**
 * The per-character product-scan script (`Scan_Products_<Name>.dsa`). Run in Daz
 * with the character's scene already OPEN: it includes the DthProducts runtime
 * (installed alongside the other runtime files) and calls `DthScanProducts()`,
 * which analyses the open scene, matches used assets to installed DIM products,
 * and writes the result as a CSV named after the open scene inside `outputDir`. The
 * character's identity is embedded so the studio can locate + attribute the results,
 * and each scene gets its own CSV so outfit variants don't overwrite one another.
 * Emitted only when the project enables the Daz Products feature.
 */
export function toScanProductsScriptDsa(
  character: Character,
  opts: ScanProductsOptions,
): GeneratedFile {
  // Forward-slash both paths (DzFile/DzDir want '/' on Windows; matches the
  // export block) — JSON.stringify still escapes any remaining backslashes.
  const config = {
    characterId: character.id,
    characterName: character.name,
    genesis: character.genesis,
    dimManifestPath: opts.dimManifestPath.replace(/\\/g, '/'),
    outputDir: opts.outputDir.replace(/\\/g, '/'),
    dazLibraryFolder: opts.dazLibraryFolder.replace(/\\/g, '/'),
  }
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Product Scan for ${character.name} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${character.studioVersion}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Analyses the scene CURRENTLY OPEN in Daz — open ${character.name}'s scene first,
// then run this. It needs the DTH runtime (the hidden .DthProducts.dsa +
// .DthUtils.dsa), which the studio installs ONCE in the DTH-Character-Studio root
// — two levels up from this script's <project>/<character>/ subfolder. The found
// products are written as a CSV the studio reads back on the character page.

var dir_self = new DzDir(new DzFileInfo(getScriptFileName()).path());
include(dir_self.filePath("../../.DthProducts.dsa"));

DthScanProducts(${JSON.stringify(config, null, 2)});
`
  return { fileName: `Scan_Products_${characterSlug(character)}.dsa`, content, target: 'daz' }
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
  /** Absolute character-folder path — see {@link toCharacterScriptDsa}. */
  charFolderAbs?: string,
  /** Active DTH release version at generation time (e.g. "2.4.3"). Only the CSV
   *  depends on the release — it selects the CSV era/variant (see
   *  {@link poseAssetCsvEra}); the Daz scripts are release-independent (tied to
   *  RUNTIME_VERSION only), so it isn't threaded into them. */
  dthReleaseVersion?: string,
  /** When set (the project enabled Daz Products), also emit the per-character
   *  `Scan_Products_<Name>.dsa`. The flag reaches the pure core only here — the
   *  core never imports host/app state. */
  scanProducts?: ScanProductsOptions,
): Array<GeneratedFile> {
  // With an export dir and exportWithRomScript off, the export is split into a
  // standalone Export_ script alongside the ROM_ script.
  const split = character.exportPath.trim() !== '' && character.exportWithRomScript === false
  return [
    toCharacterScriptDsa(character, romPaths, frames, charFolderAbs),
    ...(split ? [toExportScriptDsa(character, frames, charFolderAbs)] : []),
    ...(scanProducts ? [toScanProductsScriptDsa(character, scanProducts)] : []),
    toPoseAssetCsv(character, frames, poseAssetCsvEra(dthReleaseVersion ?? '')),
  ]
}
