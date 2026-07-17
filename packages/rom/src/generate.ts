import {
  boneScaleRefPoses,
  flattenRom,
  isBoneScaleRefPose,
  presetEndFrame,
  walkCustomPoses,
} from './frames'
import {
  characterSkinning,
  characterSlug,
  genAssetGender,
  GENERATIONS,
  genRomIncludes,
  poseAssetCsvEra,
  RUNTIME_VERSION,
} from './types'

import type { PresetFrames } from './frames'
import type {
  ArtDirectionFrame,
  CalculateFrom,
  Character,
  DthPoseAsset,
  Gender,
  GenerationMethod,
  GenesisVersion,
  GroupSuffix,
  PoseAssetCsvEra,
  RomSection,
} from './types'

// Ground-truth PoseAsset rows for the G9 / DQS / JCM+FAC / Golden Palace /
// UE5 configuration, exported from a fully set-up DazToHuePoseAsset node.
// The placeholder marks where the character's custom sections go.
import poseAssetTemplateG9DqsFacGp from './templates/poseasset-g9-dqs-jcmfac-gp-ue5.csv?raw'
// Ground-truth PoseAsset rows for the G8.1 / DQS / JCM+FAC / UE5 configuration
// on the PRE-2.0 CSV era (CTL control rows) - exported from a working DTH 1.9.6
// node (old Houdini pipeline). The G8.1 assets are byte-identical across DTH
// releases, so the fixed 188 preset frames hold for any of them.
import poseAssetTemplateG81DqsFac from './templates/poseasset-g8.1-dqs-jcmfac-ue5.csv?raw'
// The fixed PHY preset block (G9 Physics Example ROM) — bones, pose names,
// push-direction XYZ and group offset/radius, ground-truth from a node export.
// Relative frames 0-42; renumbered to absolute on emit.
import poseAssetPhysicsG9 from './templates/poseasset-physics-g9.csv?raw'

const CUSTOM_SECTIONS_PLACEHOLDER = 'CUSTOM_SECTIONS_PLACEHOLDER'

/**
 * The raw ground-truth PoseAsset template per generation — the only per-generation
 * binding that must live here (Vite `?raw` import). The baked block lengths + the
 * CSV era each template targets live in {@link GENERATIONS}[gen].template, so the
 * gate ({@link poseAssetCsvValidated}) and the splice ({@link spliceTemplate}) read
 * the SAME numbers. A generation with no validated template is absent here, so it
 * falls to the experimental custom-only path. Adding a generation = one row here +
 * one row in GENERATIONS.
 */
const GENERATION_TEMPLATE_CSV: Partial<Record<GenesisVersion, string>> = {
  G9: poseAssetTemplateG9DqsFacGp,
  'G8.1': poseAssetTemplateG81DqsFac,
}

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
 * Whether the installed DTH release ships the preset asset(s) `section` needs
 * for this generation — the availability side of {@link resolveRomPaths}'s
 * selection, kept next to it so the two rules can't drift: JCM needs any JCM
 * base for the generation; FAC rides in a FAC-variant JCM base ROM, not a
 * FAC-section asset; GEN needs the gendered ROM(s) {@link genRomIncludes}
 * selects; PHY any physics asset. Sections without preset assets (EXP, FBM,
 * MISC — and RET, which lives inside the JCM base) always report available.
 * An EMPTY catalog reports available too: "unknown" must not lock the editor.
 */
export function sectionPresetAvailable(
  section: RomSection,
  catalog: { assets: Array<DthPoseAsset> },
  genesis: GenesisVersion,
  gender: Gender,
  /** The section's explicit preset picks (GEN: steers GP/DK inclusion). */
  presetAssets: Array<string>,
): boolean {
  if (catalog.assets.length === 0) return true
  const forGen = catalog.assets.filter((a) => a.genesis === null || a.genesis === genesis)
  if (section === 'JCM') return forGen.some((a) => a.section === 'JCM')
  if (section === 'FAC') return forGen.some((a) => a.section === 'JCM' && a.includesFac)
  if (section === 'GEN') {
    const roms = genRomIncludes(gender, presetAssets)
    const has = (g: Gender) =>
      forGen.some((a) => a.section === 'GEN' && genAssetGender(a.name) === g)
    return (!roms.gp || has('female')) && (!roms.dk || has('male'))
  }
  if (section === 'PHY') return forGen.some((a) => a.section === 'PHY')
  return true
}

/**
 * Fingerprint of every Character field that can change which preset ROM blocks
 * get measured or which .duf each block resolves to — the inputs of
 * {@link resolveRomPaths}, {@link genRomIncludes} and {@link jcmIsBaseRom}.
 * The character editor re-measures the preset frame lengths whenever this
 * string changes. A field that affects resolution but is missing here means
 * stale frame numbers in the editor (no error — just wrong numbers), so grow
 * this in lockstep with those resolvers; generate.test.ts couples the two.
 */
export function presetFramesSignature(character: Character): string {
  const { sections } = character
  return JSON.stringify({
    genesis: character.genesis,
    gender: character.gender,
    jcm: [
      sections.JCM.enabled,
      sections.JCM.mode,
      sections.JCM.presetAssets,
      sections.JCM.customAssetPath,
    ],
    // FAC steers which JCM base .duf resolveRomPaths picks (includesFac match).
    fac: [sections.FAC.enabled, sections.FAC.mode],
    gen: [sections.GEN.enabled, sections.GEN.mode, sections.GEN.presetAssets],
    phy: [sections.PHY.enabled, sections.PHY.mode],
  })
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

/**
 * Strip the characters that could break OUT of a `//` comment line in a generated
 * Daz script — CR/LF and the Unicode line separators U+2028/U+2029 that Daz's
 * ECMAScript engine also treats as line terminators. Without this, a crafted
 * `character.name` (a shared malicious definition — the product's whole premise is
 * sharing definitions) could end the comment and inject executable DzScript.
 */
// U+2028/U+2029 are JS/Daz line terminators, so they can't appear literally in
// this source (they'd break the line) — build the class with fromCharCode.
const COMMENT_LINE_TERMINATORS = new RegExp(
  '[\r\n' + String.fromCharCode(0x2028, 0x2029) + ']+',
  'g',
)
function commentSafe(value: string): string {
  return value.replace(COMMENT_LINE_TERMINATORS, ' ')
}

/**
 * Strip commas + newlines so a raw value (a group label, a reference-FBX path)
 * can't inject extra columns or rows into the PoseAsset CSV the Houdini HDA
 * parses. Pose names are already reduced to `[A-Za-z0-9_]` by sanitizePoseName;
 * this guards the fields that pass through raw.
 */
function csvSafe(value: string): string {
  return value.replace(/[\r\n,]+/g, ' ')
}

/**
 * CSV rows for the enabled custom sections, with absolute timeline frames
 * continuing after the preset blocks. FBM/MISC are flat lists in the node;
 * the grouped sections emit their GROUP header rows with menu indices.
 */
function customPoseAssetRows(character: Character, lastPresetFrame: number): Array<string> {
  const rows: Array<string> = []
  for (const { section, group, pose, relativeFrame, firstInGroup } of walkCustomPoses(
    character.sections,
  )) {
    // Absolute frame = one past the last preset frame, then the 0-based position
    // in the custom sequence (both artifacts derive from THIS shared offset).
    const frame = lastPresetFrame + 1 + relativeFrame
    const name = sanitizePoseName(pose.name)
    // A bone-scale frame's reference FBX: the studio can't know the absolute path
    // at generation time (the export dir — scene subfolder included — is resolved
    // in Daz at run time), so it writes a {{DTH_EXPORT_DIR}} token that the
    // generated script substitutes when it copies the CSV. The filename matches
    // what the DTH Exporter writes: <ExportDir>/Reference Skeletons/<Name>_frame_<N>.fbx.
    const refFbx = isBoneScaleRefPose(section, pose)
      ? csvSafe(`{{DTH_EXPORT_DIR}}/Reference Skeletons/${character.name}_frame_${frame}.fbx`)
      : ''
    if (section === 'FBM' || section === 'MISC') {
      rows.push(`${section === 'MISC' ? 'MIS' : 'FBM'},${frame},${name},${refFbx}`)
      continue
    }
    if (firstInGroup) {
      const method = METHOD_INDEX[group.method]
      const suffix = SUFFIX_INDEX[group.suffix]
      const calc = CALC_INDEX[group.calculateFrom]
      const label = csvSafe(group.label)
      if (section === 'JCM') rows.push(`JCMGROUP,${method},${suffix},${label}`)
      else if (section === 'FAC') rows.push(`FACGROUP,${calc},${method},${suffix}`)
      else if (section === 'EXP') rows.push(`EXPGROUP,${calc},${method},${suffix}`)
      else if (section === 'GEN') rows.push(`GENGROUP,${calc},${method},${suffix},${label}`)
      else if (section === 'PHY') rows.push(`PHYGROUP,${calc},${suffix},${label},,`)
    }
    if (section === 'GEN') rows.push(`GEN,${frame},${name},${refFbx}`)
    else rows.push(`${section},${frame},${name}`)
  }
  return rows
}

/**
 * Absolute timeline frames of the bone-scale poses (`boneScaleRef` in
 * GEN/FBM — {@link REFERENCE_FBX_SECTIONS}). These are the DTH Exporter's
 * "reference frames" — the ones it
 * writes a reference-skeleton FBX for. Frames are assigned in the same canonical
 * order as the PoseAsset CSV (both walk {@link walkCustomPoses} from the same
 * {@link presetEndFrame} offset), so they match the timeline `ApplyDTHCharacter`
 * builds.
 */
export function referenceFrames(character: Character, frames: PresetFrames): Array<number> {
  // presetEndFrame is -1 when there is NO preset block, so the first custom pose
  // lands at frame 0 (matching the Daz runtime's `startFrame = 0` for a base-less
  // ROM). NEVER clamp the -1 to 0 — that shifts every custom frame and desyncs the
  // CSV from Daz.
  const lastPresetFrame = presetEndFrame(character.sections, character.gender, frames)
  return boneScaleRefPoses(character.sections).map(
    (walk) => lastPresetFrame + 1 + walk.relativeFrame,
  )
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
 * Whether this character + CSV era combination hits a VALIDATED PoseAsset
 * template (false → the custom-only experimental layout). The single source
 * for {@link toPoseAssetCsv}'s template gate and the editor's "experimental" tag,
 * driven off {@link GENERATIONS}[gen].template.
 *
 * `baseFrames` is the measured base-ROM length; a validated template pins it (G9
 * 328, G8.1 188), so a base that measures differently is a future/custom asset —
 * pass `undefined` while unmeasured (counts as not validated, symmetric across
 * generations). `gpFrames` is the measured Golden Palace block length: the
 * generation path passes it so a non-standard GP (≠ the baked 104) can't silently
 * desync; the editor omits it (GP length only matters once GP is included, and its
 * rows are stripped otherwise).
 */
export function poseAssetCsvValidated(
  character: Character,
  era: PoseAssetCsvEra,
  baseFrames?: number,
  gpFrames?: number,
): boolean {
  const { sections } = character
  const jcmPreset = sections.JCM.enabled && sections.JCM.mode === 'preset'
  const facPreset = sections.FAC.enabled && sections.FAC.mode === 'preset'
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const roms = genRomIncludes(character.gender, sections.GEN.presetAssets)
  const includeGp = genPreset && roms.gp
  const includeDk = genPreset && roms.dk
  const physPreset = sections.PHY.enabled && sections.PHY.mode === 'preset'
  if (characterSkinning(character) !== 'dqs' || !jcmPreset || !facPreset) return false

  const tpl = GENERATIONS[character.genesis].template
  if (!tpl) return false
  // Era: an era-locked template (G9 → 2.0, the CURVE rows) only validates under
  // its era; an era-independent one (G8.1 → the pre-2.0 CTL-tail HDA, byte-identical
  // across releases) validates whatever release is active.
  if (tpl.era !== null && era !== tpl.era) return false
  // Baked-length guard (symmetric across generations): the splice places PHY/custom
  // rows at offsets measured against fixed baked rows, so a base/GP that measures
  // differently must fall to the experimental path rather than silently desync.
  if (baseFrames !== tpl.baseFrames) return false
  if (includeGp && gpFrames !== undefined && gpFrames !== tpl.gpFrames) return false
  // GEN / PHY only where the template ships them (G8.1 ships neither; the G9
  // template bakes no Dicktator ROM, so a DK selection never fits either).
  if (genPreset && !tpl.allowGen) return false
  if (physPreset && !tpl.allowPhys) return false
  if (includeDk) return false
  return true
}

/**
 * Splices the character's custom sections (and the fixed PHY preset block, when
 * enabled) into a ground-truth PoseAsset template at its CUSTOM_SECTIONS sentinel.
 * The ONE splice both validated templates (G9 CURVE-tail, G8.1 CTL-tail) collapse
 * into: the baked base-ROM / GP rows pass through verbatim (GP stripped when the
 * character has no Golden Palace, a no-op for a template that bakes none), and the
 * custom rows continue from the SAME {@link presetEndFrame} offset every other
 * artifact uses. Throws if the template lost its sentinel — a corrupt CSV must fail
 * loud, never ship.
 */
function spliceTemplate(
  templateCsv: string,
  templateName: string,
  character: Character,
  frames: PresetFrames,
): string {
  const { sections } = character
  const genPreset = sections.GEN.enabled && sections.GEN.mode === 'preset'
  const includeGp = genPreset && genRomIncludes(character.gender, sections.GEN.presetAssets).gp
  const includePhys = sections.PHY.enabled && sections.PHY.mode === 'preset'

  const lines = templateCsv.replace(/\r\n/g, '\n').trimEnd().split('\n')
  const placeholder = lines.indexOf(CUSTOM_SECTIONS_PLACEHOLDER)
  if (placeholder === -1) {
    throw new Error(
      `PoseAsset template "${templateName}" is missing its ${CUSTOM_SECTIONS_PLACEHOLDER} sentinel — refusing to emit a corrupt CSV.`,
    )
  }
  let head = lines.slice(0, placeholder)
  const tail = lines.slice(placeholder + 1)
  // No Golden Palace → drop the baked GP (GEN) rows. A template with no GP block
  // (G8.1) has none to drop, so the filter is a harmless no-op there.
  if (!includeGp) head = head.filter((line) => !line.startsWith('GEN'))
  // The fixed PHY preset block (G9 Physics Example ROM) sits after the kept GP
  // block and before the custom sections; its rows are renumbered from physStart.
  const physStart = frames.base + (includeGp ? frames.gp : 0)
  const physRows = includePhys ? physicsPoseAssetRows(physStart) : []
  const customRows = customPoseAssetRows(character, presetEndFrame(sections, character.gender, frames))
  return [...head, ...physRows, ...customRows, ...tail].join('\n') + '\n'
}

/**
 * PoseAsset node CSV for Houdini/DTH (import format reverse-engineered from
 * the node's parser, see docs/poseasset-csv-spec.md).
 *
 * A generation with a VALIDATED template (see {@link GENERATIONS}) has its custom
 * sections spliced into the ground-truth rows with continuing frame numbers:
 *  - G9 / DQS / JCM+FAC(+GP)(+PHY) / UE5 on the 2.0+ era (CURVE rows), and
 *  - G8.1 / DQS / JCM+FAC / UE5, era-independent (CTL rows) — the old Houdini +
 *    old DTH pipeline; assets are byte-identical across releases.
 * Every other configuration falls back to generating only the custom sections and
 * stays flagged experimental.
 */
export function toPoseAssetCsv(
  character: Character,
  frames: PresetFrames,
  /**
   * CSV era from {@link poseAssetCsvEra} — selects which template's control-row
   * format is valid. A future breaking era branches through a new
   * {@link GENERATIONS} template row, shipped together with adding that release to
   * {@link POSEASSET_CSV_BREAKING_VERSIONS}.
   */
  era: PoseAssetCsvEra = '',
): GeneratedFile {
  const templateCsv = GENERATION_TEMPLATE_CSV[character.genesis]
  if (templateCsv && poseAssetCsvValidated(character, era, frames.base, frames.gp)) {
    return {
      fileName: poseAssetFileName(character),
      content: spliceTemplate(templateCsv, character.genesis, character, frames),
      target: 'houdini',
    }
  }

  // Unvalidated configuration (linear, no FAC, Dicktator, custom base, wrong era,
  // non-standard baked length, …): only the custom sections, frames continuing
  // after the measured preset length. presetEndFrame is -1 with no base ROM → the
  // first custom pose lands at frame 0 (see referenceFrames). NEVER clamp to 0 —
  // that desyncs the CSV from Daz.
  const lastPresetFrame = presetEndFrame(character.sections, character.gender, frames)
  return {
    fileName: poseAssetFileName(character),
    content: customPoseAssetRows(character, lastPresetFrame).join('\n') + '\n',
    target: 'houdini',
    experimental: true,
  }
}

/**
 * Per-character art-direction payload for a pre-made ROM block — the pre-made
 * GP/DK ROM frames (same shape as DazToHue-Scripts' GP9_ArtDirection.json /
 * DK9_ArtDirection.json), emitted inline as `config.gpArtDirection` /
 * `config.dkArtDirection` of the character script. Returns null when the
 * character has no art-direction morphs for that ROM.
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
    ? `    // Copy the generated PoseAsset CSV next to the exporter output, resolving
    // the {{DTH_EXPORT_DIR}} token in any bone-scale reference-FBX path to the
    // real (run-time) export dir — Houdini's PoseAsset wants absolute paths, and
    // the dir (scene subfolder included) is only known now. Source is left intact
    // so the next scene's export can reuse it.
    var dthCsvName = ${JSON.stringify(poseAssetFileName(character))};
    var dthCsvSrcDir = new DzDir(${JSON.stringify(charFolderAbs.replace(/\\/g, '/'))});
    if (dthCsvSrcDir.exists(dthCsvName)) {
        var dthCsvDstDir = new DzDir(dthExportDir);
        if (!dthCsvDstDir.exists()) dthCsvDstDir.mkpath(dthExportDir);
        var dthCsvDst = dthCsvDstDir.absoluteFilePath(dthCsvName);
        var dthCsvSrc = new DzFile(dthCsvSrcDir.absoluteFilePath(dthCsvName));
        if (dthCsvSrc.open(dthCsvSrc.ReadOnly)) {
            var dthCsvText = String(dthCsvSrc.read());
            dthCsvSrc.close();
            dthCsvText = dthCsvText.split("{{DTH_EXPORT_DIR}}").join(dthExportDir);
            var dthCsvOut = new DzFile(dthCsvDst);
            if (dthCsvOut.open(dthCsvOut.WriteOnly | dthCsvOut.Truncate)) {
                dthCsvOut.write(dthCsvText);
                dthCsvOut.close();
                print("Copied " + dthCsvName + " to " + dthCsvDst);
            } else print("Failed to write " + dthCsvName + " to " + dthCsvDst);
        } else print("Failed to read " + dthCsvName + " for copy.");
    } else {
        print("PoseAsset CSV not found in the character folder — nothing to copy.");
    }
`
    : ''
  // The export call + CSV delivery. With groom items listed, it is wrapped in the
  // unfit/unparent bracket below; without any, the emitted script is unchanged.
  const exportCore = `    dthExportAction.doExport(dthExportDir, ${JSON.stringify(character.name)}, ${JSON.stringify(refFrames)}, false);
${csvCopyBlock}`
  const groomMap = groomSceneMap(character)
  const indentBlock = (block: string) =>
    block
      .split('\n')
      .map((line) => (line ? `    ${line}` : line))
      .join('\n')
  const exportBody =
    Object.keys(groomMap).length === 0
      ? exportCore
      : `    // Groom items (hair) must stay OUT of the export. DETACH, not hide:
    // measured July 17 on plugin 2.0 — hidden nodes are excluded from the
    // alembic but STILL exported into the FBX (Daz's own FBX exporter ignores
    // visibility), so the OPEN scene's listed items are unfitted + unparented
    // and restored right after — the same unfit/refit Daz's "Fit To" performs.
    // Flip to hide-based only when the plugin's FBX path honors hiding too. The lists are per scene (outfit scenes carry different hair);
    // a scene without an entry has no groom to exclude and exports as-is.
    var dthRunExport = function () {
${indentBlock(indentBlock(exportCore))}    };
    var dthGroomByScene = ${JSON.stringify(groomMap)};
    var dthGroomScene = String(Scene.getFilename()).split("\\\\").join("/").toLowerCase();
    var dthGroomLabels = dthGroomByScene[dthGroomScene] || [];
    if (dthGroomLabels.length == 0) {
        print("No groom list for the open scene - exporting as-is.");
        dthRunExport();
    } else {
    var dthGroomRestore = [];
    var dthGroomMissing = "";
    for (var dthGi = 0; dthGi < dthGroomLabels.length; dthGi++) {
        var dthGroomNode = Scene.findNodeByLabel(dthGroomLabels[dthGi]);
        if (!dthGroomNode) { dthGroomMissing = dthGroomLabels[dthGi]; break; }
        dthGroomRestore.push({
            node: dthGroomNode,
            follow: (typeof dthGroomNode.getFollowTarget == "function") ? dthGroomNode.getFollowTarget() : null,
            parent: dthGroomNode.getNodeParent()
        });
    }
    if (dthGroomMissing != "") {
        // A typo must not silently ship a hair-polluted export - fail loud, fix, re-run.
        print("Groom item not found: " + dthGroomMissing + " - export skipped.");
        MessageBox.critical("The groom item \\"" + dthGroomMissing + "\\" was not found in the scene.\\n\\nCheck the Groom list in DTH Character Studio - the label must match Daz's Scene pane exactly - then run the export again.", "DTH Character Studio", "&OK");
    } else {
        for (var dthGd = 0; dthGd < dthGroomRestore.length; dthGd++) {
            if (dthGroomRestore[dthGd].follow) dthGroomRestore[dthGd].node.setFollowTarget(null);
            if (dthGroomRestore[dthGd].parent) dthGroomRestore[dthGd].parent.removeNodeChild(dthGroomRestore[dthGd].node, true);
        }
        print("Groom items detached for the export: " + dthGroomRestore.length);
        try {
            dthRunExport();
        } finally {
            // Reparent first, then refit - restoring the exact pre-export state
            // even when the export itself throws.
            for (var dthGr = dthGroomRestore.length - 1; dthGr >= 0; dthGr--) {
                if (dthGroomRestore[dthGr].parent) dthGroomRestore[dthGr].parent.addNodeChild(dthGroomRestore[dthGr].node, true);
                if (dthGroomRestore[dthGr].follow) dthGroomRestore[dthGr].node.setFollowTarget(dthGroomRestore[dthGr].follow);
            }
            print("Groom items restored: " + dthGroomRestore.length);
        }
    }
    }
`
  return `var dthExportAction = MainWindow.getActionMgr().findAction("DazToHueExporterAction");
if (dthExportAction) {
    var dthExportDir = ${JSON.stringify(exportDir.replace(/\\/g, '/'))};
${sceneSubfolderBlock}${exportBody}} else {
    print("DazToHue Exporter Action not found — install the DTH Exporter Plugin v1.8.1+.");
}
`
}

/**
 * The character's per-SCENE groom lists as a lookup the generated script embeds:
 * normalized scene path (forward slashes, lowercased) → trimmed non-empty item
 * labels. Scenes without items are dropped — absence MEANS "this scene has no
 * groom to exclude". Empty in 'separate' groom mode (the classic separate-scene
 * workflow: the lists are inert). THE single gate for the export bracket.
 */
function groomSceneMap(character: Character): Record<string, Array<string>> {
  if (character.groomMode !== 'scene') return {}
  const map: Record<string, Array<string>> = {}
  for (const entry of character.groomScenes) {
    const key = entry.scenePath.trim().replace(/\\/g, '/').toLowerCase()
    const labels = entry.nodes.map((n) => n.nodeLabel.trim()).filter((label) => label !== '')
    if (key !== '' && labels.length > 0) map[key] = labels
  }
  return map
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
  // Forward-slashed like the catalog paths — DzFile/DzDir want '/', and the picker
  // hands us a raw Windows path.
  const jcmCustomPath =
    sections.JCM.mode === 'custom'
      ? sections.JCM.customAssetPath.trim().replace(/\\/g, '/')
      : ''
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
    // The FACS-detail/flexion strength dials only exist on Genesis 9 figures
    // (GENERATIONS[gen].hasStrengthDials) — 0 makes the runtime skip them (setting
    // them on a non-G9 figure would log a spurious "property not found" failure).
    FACsDetailStrength: GENERATIONS[character.genesis].hasStrengthDials
      ? character.facsDetailStrength
      : 0,
    FlexionStrength: GENERATIONS[character.genesis].hasStrengthDials ? character.flexionStrength : 0,
    // G9 only: switch the Genesis 9 Tear shader's UV set to "UE5" during the build
    // (an example UE5 tear UV only ships for Genesis 9).
    bApplyUE5TearUV: character.genesis === 'G9' && character.applyUE5TearUV,
  }
  // Measured preset-block lengths (base/gp/dk/phys), so the Daz runtime sizes
  // each block from the real .duf frame counts instead of hard-coded literals —
  // the two artifacts can't drift. Omitted only in pure/web contexts (no native
  // measurement); the runtime then fails loud rather than guessing.
  if (frames) config.presetFrames = frames
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
      ? `            // Export to the DTH pipeline via the Exporter Plugin (v1.8.1+).
${buildExportBlock(character, frames, charFolderAbs)
  .split('\n')
  .map((line) => (line ? `            ${line}` : line))
  .join('\n')}`
      : ''

  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH ROM for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Self-contained: this single ApplyDTHCharacter() call carries the full
// character config AND all ROM morph definitions inline. It needs the DTH
// runtime (the hidden .DthWorkflow.dsa + .DthUtils.dsa + .DthOptions.dsa), which
// the studio installs ONCE in the DTH-Character-Studio root — two levels up from
// this script's <project>/<character>/ subfolder.

var dthCharacterConfig = ${JSON.stringify(config, null, 2)};

// Write a minimal run log so even a catastrophic failure reaches the studio.
function dthWriteFailureLog(sError) {
    try {
        if (!dthCharacterConfig.runLogPath) return;
        var dthLogFile = new DzFile(dthCharacterConfig.runLogPath);
        // One ORed mode arg — a second open() argument warns on DS6.
        if (dthLogFile.open(dthLogFile.WriteOnly | dthLogFile.Truncate)) {
            dthLogFile.write(JSON.stringify({
                logVersion: 1,
                character: dthCharacterConfig.characterName,
                runtimeVersion: dthCharacterConfig.runtimeVersion,
                studioVersion: dthCharacterConfig.studioVersion,
                finishedAt: new Date().toString(),
                finishedAtMs: new Date().getTime(),
                ok: false,
                errors: [String(sError)],
                failedMorphs: []
            }, null, 2));
            dthLogFile.close();
        }
    } catch (dthLogErr) { /* even the log failed — the dialog still fires */ }
}

// Short + generic on purpose: the details (which morph, which frame, why)
// belong in DTH Character Studio, which reads the run log back.
function dthFailureDialog() {
    MessageBox.critical(
        "Something went wrong while building the ROM.\\n\\nSwitch back to DTH Character Studio to see what failed.",
        "DTH Character Studio", "&OK");
}

// G9 only: switch the Genesis 9 Tear shader's UV set to "UE5" so DTH's Lacrimal
// Fluid material lines up (the UV set is a DzEnumProperty — set it by name through
// the material's UV-set control). Non-fatal: the ROM build proceeds regardless.
function dthApplyUE5TearUV() {
    try {
        var oTear = Scene.findNodeByLabel("Genesis 9 Tear");
        if (!oTear) {
            for (var i = 0; i < Scene.getNumNodes(); i++) {
                var oNode = Scene.getNode(i);
                if (String(oNode.getLabel()).toLowerCase().indexOf("tear") >= 0) { oTear = oNode; break; }
            }
        }
        if (!oTear || !oTear.getObject()) return;
        var oShape = oTear.getObject().getCurrentShape();
        if (!oShape) return;
        for (var m = 0; m < oShape.getNumMaterials(); m++) {
            var oCtrl = oShape.getMaterial(m).getUVSetControl();
            if (oCtrl) oCtrl.setValueFromString("UE5");
        }
    } catch (dthUvErr) { /* leave the tear UV as-is; the ROM build continues */ }
}

// The include MUST stay at the top level: Daz resolves include() through its
// legacy-include mechanism, which fails inside try/catch ("URIError: Legacy Include").
var dir_self = new DzDir(new DzFileInfo(getScriptFileName()).path());
include(dir_self.filePath("../../.DthWorkflow.dsa"));

if (typeof ApplyDTHCharacter != "function") {
    // Runtime not loaded (moved/deleted library?) — report instead of crashing.
    dthWriteFailureLog("The DTH runtime (.DthWorkflow.dsa) could not be loaded. Reinstall it from DTH Character Studio: save the character, or Tools \\u2192 Refresh assets.");
    dthFailureDialog();
} else {
    try {
        var dthRomOk = ApplyDTHCharacter(dthCharacterConfig);
        // G9: retarget the tear shader's UV set to UE5 after the ROM (before any
        // export). No-op unless the character opted in.
        if (dthCharacterConfig.bApplyUE5TearUV) { dthApplyUE5TearUV(); }${exportBlock ? `
        // Export only when the ROM built CLEAN (runtime v20: failed morphs count
        // as failure too, not just hard aborts) — a broken ROM must never ship
        // a PoseAsset CSV/FBX as if it were good. Fix the problem and re-run.
        if (dthRomOk === true) {
${exportBlock}        }` : ''}
    } catch (dthErr) {
        // Unexpected exception — ApplyDTHCharacter couldn't log/report it itself.
        dthWriteFailureLog("Unexpected script error: " + dthErr);
        dthFailureDialog();
    }
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
/** The stock figure asset file names per generation — the rename-proof identity
 *  the standalone scripts use to auto-select the figure (mirrors the runtime's
 *  v28 auto-select, which only the ROM script gets via the include). */
const GENERATION_ASSET_FILES: Record<GenesisVersion, Array<string>> = {
  G9: ['genesis9.dsf'],
  'G8.1': ['genesis8_1female.dsf', 'genesis8_1male.dsf'],
  G8: ['genesis8female.dsf', 'genesis8male.dsf'],
  G3: ['genesis3female.dsf', 'genesis3male.dsf'],
}

/**
 * Standalone-script snippet: resolve `dthFig` to the character's figure — the
 * selection's root when it matches the generation's source ASSET (rename-proof;
 * an unreadable asset URI keeps the tolerant old behavior), else the scene's
 * first matching root figure, auto-selected. `dthFig` is null only when the
 * scene has no such figure; the caller emits its own error UI for that.
 */
function figureAutoSelectSnippet(genesis: GenesisVersion): string {
  const files = JSON.stringify(GENERATION_ASSET_FILES[genesis])
  return `var dthFig = Scene.getPrimarySelection();
while (dthFig && dthFig.getNodeParent()) dthFig = dthFig.getNodeParent();
var dthAssetFiles = ${files};
var dthAssetPath = function (oNode) {
    try {
        if (oNode && typeof oNode.getAssetUri == "function") {
            var dthUri = oNode.getAssetUri();
            return String(dthUri && typeof dthUri.getFilePath == "function" ? dthUri.getFilePath() : dthUri).toLowerCase();
        }
        // DS6 has no getAssetUri() method - the assetUri PROPERTY is how the
        // runtime's auto-select succeeds there (measured; do not drop this).
        if (oNode && oNode.assetUri != undefined) return String(oNode.assetUri).toLowerCase();
    } catch (eA) {}
    return "";
};
var dthMatchesAsset = function (sPath) {
    for (var dthAi = 0; dthAi < dthAssetFiles.length; dthAi++) {
        if (sPath.indexOf("/" + dthAssetFiles[dthAi]) >= 0 || sPath == dthAssetFiles[dthAi]) return true;
    }
    return false;
};
// The unreadable-asset tolerance applies ONLY to actual figures - a selected
// non-figure (a prop, Environment Options, ...) must never be accepted.
var dthFigIsFigure = dthFig && (dthFig.inherits("DzFigure") || dthFig.inherits("DzSkeleton"));
var dthSelPath = dthFigIsFigure ? dthAssetPath(dthFig) : null;
if (dthSelPath == null || (dthSelPath != "" && !dthMatchesAsset(dthSelPath))) {
    // No/non-figure/wrong-asset selection - find the scene's ${genesis} figure
    // by ASSET identity (labels are user-renamable; the source .dsf is not).
    var dthFound = null;
    for (var dthFi = 0; dthFi < Scene.getNumNodes(); dthFi++) {
        var dthCand = Scene.getNode(dthFi);
        if (!dthCand || dthCand.getNodeParent()) continue;
        if (!dthCand.inherits("DzFigure") && !dthCand.inherits("DzSkeleton")) continue;
        if (dthMatchesAsset(dthAssetPath(dthCand))) { dthFound = dthCand; break; }
    }
    if (dthFound) {
        print("Auto-selected the ${genesis} figure: " + dthFound.getLabel());
        Scene.selectAllNodes(false);
        dthFound.select(true);
        Scene.setPrimarySelection(dthFound);
    }
    // A wrong selection never survives - no match means fail loud downstream.
    dthFig = dthFound;
}
`
}

export function toExportScriptDsa(
  character: Character,
  frames?: PresetFrames,
  charFolderAbs?: string,
): GeneratedFile {
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Export for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Runs the DTH Exporter on the ROM already built on the timeline and delivers
// the PoseAsset CSV — it does NOT rebuild the ROM. Run it after the ROM script
// (ROM_${characterScriptName(character)}.dsa) in the same Daz session.

${figureAutoSelectSnippet(character.genesis)}if (!dthFig) {
    MessageBox.critical("No ${character.genesis} figure found in the scene - load the character's scene and re-run.", "DTH Character Studio", "&OK");
} else {
${buildExportBlock(character, frames, charFolderAbs)
  .split('\n')
  .map((line) => (line ? `    ${line}` : line))
  .join('\n')}}
`
  return { fileName: `Export_${characterScriptName(character)}.dsa`, content, target: 'daz' }
}

/**
 * The standalone Groom export script (`Export_Groom_<Name>_<Genesis>.dsa`) —
 * the DTH Groom Guide's "Export Alembic Groom Poses" step as one generated,
 * non-destructive script. Where the guide says "delete everything except the
 * body, add the hair", this script instead detaches every conformed follower
 * of the figure EXCEPT the OPEN scene's groom items (per-scene map, resolved
 * at run time like the export bracket) and the Genesis body-part figures,
 * calls the exporter's documented
 * `doExportAlembicGroomPoses(path, name, saveSettings=false)` (probed July 17:
 * a 2-arg call crashes Daz in the settings-save path — ALWAYS pass false, same
 * as the ROM doExport calls), and restores everything in a finally. Output:
 * `<Name>_groom_grooms.abc` next to the ROM artifacts (2 frames: rest + UE5
 * pose — Houdini's DazToHueGroom Import reads its hair groups from it).
 */
export function toGroomExportScriptDsa(character: Character): GeneratedFile {
  const exportDir = character.exportPath.trim().replace(/\\/g, '/')
  const groomMap = groomSceneMap(character)
  const sceneSubfolderBlock = character.exportSceneSubfolders
    ? `var dthSceneFile = Scene.getFilename();
if (dthSceneFile != "") {
    var dthSceneName = new DzFileInfo(dthSceneFile).completeBaseName();
    if (dthSceneName != "") dthExportDir = dthExportDir + "/" + dthSceneName;
}
`
    : ''
  const content = `// DAZ Studio version 4.22.0.16 filetype DAZ Script

// DTH Groom Export for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// The Groom Guide's "Export Alembic Groom Poses" step, automated: detaches the
// non-groom wearables (the open scene's groom stays FITTED, as worn), exports
// the 2-frame groom Alembic via the DTH Exporter, restores the scene. Run it
// on the character's scene with the figure selected; the ROM is NOT needed.

var dthAction = MainWindow.getActionMgr().findAction("DazToHueExporterAction");
${figureAutoSelectSnippet(character.genesis)}if (!dthAction) {
    MessageBox.critical("DazToHue Exporter Action not found - install the DTH Exporter Plugin v2.0+.", "DTH Character Studio", "&OK");
} else if (!dthFig || !dthFig.inherits("DzNode")) {
    MessageBox.critical("No ${character.genesis} figure found in the scene - load the character's scene and re-run.", "DTH Character Studio", "&OK");
} else {
    var dthGroomByScene = ${JSON.stringify(groomMap)};
    var dthGroomScene = String(Scene.getFilename()).split("\\\\").join("/").toLowerCase();
    var dthGroomLabels = dthGroomByScene[dthGroomScene] || [];
    if (dthGroomLabels.length == 0) {
        MessageBox.information("The open scene has no groom list in DTH Character Studio - nothing to export. Open one of the character's scenes with groom items defined.", "DTH Character Studio", "&OK");
    } else {
        var dthExportDir = ${JSON.stringify(exportDir)};
${sceneSubfolderBlock}        // HIDE the non-groom wearables (script Ctrl+click: node + children,
        // exact flags restored) — plugin 2.0+ skips hidden nodes. The groom
        // stays fitted AND visible, exported as worn.
        var dthHidden = [];
        var dthHideTree = function (oNode) {
            if (!oNode) return;
            var dthVisible = true;
            try { if (typeof oNode.isVisible == "function") dthVisible = oNode.isVisible(); } catch (eV) {}
            if (dthVisible) {
                try { oNode.setVisible(false); dthHidden.push(oNode); } catch (eH) {}
            }
            var dthKids = oNode.getNodeChildren(false);
            for (var dthC = 0; dthC < dthKids.length; dthC++) dthHideTree(dthKids[dthC]);
        };
        for (var dthI = 0; dthI < Scene.getNumNodes(); dthI++) {
            var dthN = Scene.getNode(dthI);
            if (!dthN || typeof dthN.getFollowTarget != "function") continue;
            var dthT = dthN.getFollowTarget();
            if (!dthT || String(dthT.getLabel()) != String(dthFig.getLabel())) continue;
            var dthLabel = String(dthN.getLabel());
            // Keep the groom (fitted AND visible, as worn) and the Genesis
            // body-part figures (eyes/mouth/tear ride with the body).
            var dthKeep = dthLabel.indexOf("Genesis") == 0;
            for (var dthK = 0; dthK < dthGroomLabels.length; dthK++) if (dthLabel == dthGroomLabels[dthK]) dthKeep = true;
            if (dthKeep) continue;
            print("Groom export - hiding: " + dthLabel);
            dthHideTree(dthN);
        }
        Scene.selectAllNodes(false);
        dthFig.select(true);
        Scene.setPrimarySelection(dthFig);
        try {
            dthAction.doExportAlembicGroomPoses(dthExportDir, ${JSON.stringify(`${characterSlug(character)}_groom`)}, false);
            print("Groom exported to " + dthExportDir);
        } finally {
            // Restore the exact per-node visibility flags, even on a throw.
            for (var dthR = 0; dthR < dthHidden.length; dthR++) {
                try { dthHidden[dthR].setVisible(true); } catch (eR) {}
            }
            print("Groom export - shown again: " + dthHidden.length);
        }
    }
}
`
  return {
    fileName: `Export_Groom_${characterScriptName(character)}.dsa`,
    content,
    target: 'daz',
  }
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

// DTH Product Scan for ${commentSafe(character.name)} (${character.genesis}) — generated by DTH Character Studio${character.studioVersion ? ` v${commentSafe(character.studioVersion)}` : ''}.
// DTH-Runtime: v${RUNTIME_VERSION}
// Analyses the scene CURRENTLY OPEN in Daz — open ${commentSafe(character.name)}'s scene first,
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
 * the PoseAsset CSV (Houdini), plus the optional split Export_ script and the
 * per-character product-scan script. Everything the character script needs (FBM
 * frames, art direction) is inlined via {@link buildFbmData} /
 * {@link buildArtDirectionData}.
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
  // Groom lists + an export dir -> also the standalone groom (.abc) script.
  const groom =
    character.exportPath.trim() !== '' && Object.keys(groomSceneMap(character)).length > 0
  return [
    toCharacterScriptDsa(character, romPaths, frames, charFolderAbs),
    ...(split ? [toExportScriptDsa(character, frames, charFolderAbs)] : []),
    ...(groom ? [toGroomExportScriptDsa(character)] : []),
    ...(scanProducts ? [toScanProductsScriptDsa(character, scanProducts)] : []),
    toPoseAssetCsv(character, frames, poseAssetCsvEra(dthReleaseVersion ?? '')),
  ]
}
