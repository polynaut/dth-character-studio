import {
  characterSkinning,
  characterSlug,
  flattenRom,
  genAssetGender,
  GENERATIONS,
  genRomIncludes,
  poseAssetCsvEra,
  presetEndFrame,
  RUNTIME_VERSION,
  walkCustomPoses,
} from './types'

import type {
  ArtDirectionFrame,
  CalculateFrom,
  Character,
  DthPoseAsset,
  GenerationMethod,
  GenesisVersion,
  GroupSuffix,
  PoseAssetCsvEra,
  PresetFrames,
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
    const refFbx = csvSafe(pose.referenceFbx ?? '')
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
 * Absolute timeline frames of the poses that carry a reference-skeleton FBX
 * (`referenceFbx` — the bone-scaling poses in GEN/FBM/MISC). These are the DTH
 * Exporter's "reference frames". Frames are assigned in the same canonical order
 * as the PoseAsset CSV (both walk {@link walkCustomPoses} from the same
 * {@link presetEndFrame} offset), so they match the timeline `ApplyDTHCharacter`
 * builds.
 */
export function referenceFrames(character: Character, frames: PresetFrames): Array<number> {
  // presetEndFrame is -1 when there is NO preset block, so the first custom pose
  // lands at frame 0 (matching the Daz runtime's `startFrame = 0` for a base-less
  // ROM). NEVER clamp the -1 to 0 — that shifts every custom frame and desyncs the
  // CSV from Daz.
  const lastPresetFrame = presetEndFrame(character.sections, character.gender, frames)
  const out: Array<number> = []
  for (const { pose, relativeFrame } of walkCustomPoses(character.sections)) {
    if ((pose.referenceFbx ?? '').trim()) out.push(lastPresetFrame + 1 + relativeFrame)
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
        var dthRomOk = ApplyDTHCharacter(dthCharacterConfig);${exportBlock ? `
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
  return [
    toCharacterScriptDsa(character, romPaths, frames, charFolderAbs),
    ...(split ? [toExportScriptDsa(character, frames, charFolderAbs)] : []),
    ...(scanProducts ? [toScanProductsScriptDsa(character, scanProducts)] : []),
    toPoseAssetCsv(character, frames, poseAssetCsvEra(dthReleaseVersion ?? '')),
  ]
}
