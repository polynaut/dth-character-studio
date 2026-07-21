import {
  boneScaleRefPoses,
  isBoneScaleRefPose,
  presetEndFrame,
  presetSelections,
  walkCustomPoses,
} from './frames'
import { characterSkinning, characterSlug, GENERATIONS, GROUP_SUFFIX_TOKENS } from './types'

import type { PresetFrames } from './frames'
import type {
  CalculateFrom,
  Character,
  GenerationMethod,
  GenesisVersion,
  GroupSuffix,
  PoseAssetCsvEra,
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

/**
 * The PoseAsset-CSV pipeline: the validated-template gate, the template splice,
 * the custom-section row emitters and the exporter reference frames — the
 * Houdini side of the two frame-aligned artifacts. The `.dsa` side lives in
 * dsa.ts; both derive every frame from the SAME frames.ts walk/offsets.
 */

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
export const GENERATION_TEMPLATE_CSV: Partial<Record<GenesisVersion, string>> = {
  G9: poseAssetTemplateG9DqsFacGp,
  'G8.1': poseAssetTemplateG81DqsFac,
}

export interface GeneratedFile {
  fileName: string
  content: string
  /** Where the file is consumed — Daz files can be written straight into DazToHue-Scripts. */
  target: 'daz' | 'houdini'
  /** Marks outputs whose format is not yet confirmed with the DTH creator. */
  experimental?: boolean
}

// Menu indices of the PoseAsset node parameters (docs/poseasset-csv-spec.md).
const SUFFIX_INDEX: Record<GroupSuffix, number> = { left: 0, centre: 1, right: 2 }
// Menu index → the Unreal suffix token that menu entry appends, DERIVED from
// the one token map (GROUP_SUFFIX_TOKENS, types.ts) through the index table
// above — so the positional encoding can't drift from either source.
const SUFFIX_TOKEN_BY_INDEX: ReadonlyArray<string> = (
  Object.keys(SUFFIX_INDEX) as Array<GroupSuffix>
).reduce<Array<string>>((tokens, suffix) => {
  tokens[SUFFIX_INDEX[suffix]] = GROUP_SUFFIX_TOKENS[suffix]
  return tokens
}, [])
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
 * The figure name handed to the DTH Exporter's `doExport` — and baked into the
 * CSV's reference-FBX paths — as ONE value, so the exporter's output file names
 * and the CSV's pointers can't diverge (a comma/newline in the character name
 * was previously stripped on the CSV side only, leaving the CSV pointing at a
 * file the exporter never writes). Consumed by dsa.ts's export block AND
 * {@link customPoseAssetRows} — package-internal, not part of the index API.
 */
export function exporterFigureName(character: Pick<Character, 'name'>): string {
  // Beyond csvSafe's comma/newline guard, strip the characters Windows forbids
  // in file names (`< > : " / \ | ? *`): this name is BOTH handed to
  // the exporter's doExport — which writes `<name>_frame_<N>.fbx` to disk — and
  // baked into the CSV `file` column that points at it. An illegal char makes
  // the FBX write fail/mangle while the CSV still references the clean name, so
  // the HDA import breaks. Runs collapse to one space; a name with none of these
  // (e.g. "A B") is unchanged, so valid-character output stays byte-identical.
  return character.name.replace(/[\r\n,<>:"/\\|?*]+/g, ' ')
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
      ? csvSafe(
          `{{DTH_EXPORT_DIR}}/Reference Skeletons/${exporterFigureName(character)}_frame_${frame}.fbx`,
        )
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
 * GEN/FBM — `REFERENCE_FBX_SECTIONS`). These are the DTH Exporter's
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
 * XYZ and group offset/radius — is ground-truth from a node export; only the PHY
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
 * generations). `gpFrames` is the measured Golden Palace block length, checked
 * only when GP is included (its baked rows are stripped otherwise) — and with
 * the SAME polarity as `baseFrames`: unmeasured counts as not validated, so a
 * non-standard GP (≠ the baked 104) can't silently desync the splice.
 * `physFrames` is the measured physics-ROM length, checked only when the PHY
 * preset is on (nothing is spliced otherwise) with the same polarity again: the
 * fixed 43-row PHY block is renumbered from `presetEndFrame`, so a physics
 * asset that measures ≠ the baked 43 would shift every custom frame after it.
 */
export function poseAssetCsvValidated(
  character: Character,
  era: PoseAssetCsvEra,
  baseFrames?: number,
  gpFrames?: number,
  physFrames?: number,
): boolean {
  if (!poseAssetTemplateApplies(character)) return false
  const { includeGp, physPreset } = presetSelections(character.sections, character.gender)
  const tpl = GENERATIONS[character.genesis].template
  if (!tpl) return false
  // Era: an era-locked template (G9 → 2.0, the CURVE rows) only validates under
  // its era; an era-independent one (G8.1 → the pre-2.0 CTL-tail HDA, byte-identical
  // across releases) validates whatever release is active.
  if (tpl.era !== null && era !== tpl.era) return false
  // Baked-length guard (symmetric across generations AND across the three
  // measured lengths): the splice places PHY/custom rows at offsets measured
  // against fixed baked rows, so a base/GP/phys block that measures
  // differently — or is not measured at all — must fall to the experimental
  // path rather than silently desync. (A `!== undefined` escape once let an
  // unmeasured GP pass as validated, the opposite polarity of the base check;
  // every caller passes the measurement, so the escape was dead — and wrong.)
  if (baseFrames !== tpl.baseFrames) return false
  if (includeGp && gpFrames !== tpl.gpFrames) return false
  if (physPreset && physFrames !== tpl.physFrames) return false
  return true
}

/**
 * Whether the character's SHAPE (skinning + preset selections) fits its
 * generation's validated template at all — the structural half of
 * {@link poseAssetCsvValidated}, which additionally gates on the CSV era and
 * the measured block lengths. Also the gate for {@link templateBakedPoseNames}:
 * baked rows can only ship when the template applies.
 */
export function poseAssetTemplateApplies(character: Character): boolean {
  const { jcmPreset, facPreset, genPreset, includeDk, physPreset } = presetSelections(
    character.sections,
    character.gender,
  )
  if (characterSkinning(character) !== 'dqs' || !jcmPreset || !facPreset) return false
  const tpl = GENERATIONS[character.genesis].template
  if (!tpl) return false
  // GEN / PHY only where the template ships them (G8.1 ships neither; the G9
  // template bakes no Dicktator ROM, so a DK selection never fits either).
  if (genPreset && !tpl.allowGen) return false
  if (physPreset && !tpl.allowPhys) return false
  if (includeDk) return false
  return true
}

/**
 * The RESOLVED Unreal morph names the character's preset/template blocks
 * already export: every baked pose row that would survive the splice (GEN rows
 * only when GP is included, the PHY preset block when physics is on), with the
 * active group's `_l`/`_r` suffix applied — the same resolution custom rows go
 * through. Feed these to `romValidationErrors` as its `reservedPoseNames` so a
 * custom pose named after a baked one (e.g. an FBM pose called "Fence01" with
 * GP on) is flagged instead of silently overwriting the baked morph in Unreal.
 * Empty when no validated template applies (the experimental custom-only
 * layout ships no baked rows).
 */
export function templateBakedPoseNames(character: Character): Array<string> {
  if (!poseAssetTemplateApplies(character)) return []
  const templateCsv = GENERATION_TEMPLATE_CSV[character.genesis]
  if (!templateCsv) return []
  const { includeGp, physPreset } = presetSelections(character.sections, character.gender)
  const names: Array<string> = []
  const collect = (csv: string) => {
    let token = ''
    for (const line of csv.replace(/\r\n/g, '\n').split('\n')) {
      const cols = line.split(',')
      const type = cols[0]
      // Track the ACTIVE group's suffix — the HDA appends _l/_r to the pose
      // names of left/right groups, forming the final Unreal morph name
      // (SUFFIX_TOKEN_BY_INDEX resolves the menu index the emitters wrote).
      if (type === 'JCMGROUP') token = SUFFIX_TOKEN_BY_INDEX[Number(cols[2])] ?? ''
      else if (type === 'FACGROUP' || type === 'EXPGROUP' || type === 'GENGROUP')
        token = SUFFIX_TOKEN_BY_INDEX[Number(cols[3])] ?? ''
      else if (type === 'PHYGROUP') token = SUFFIX_TOKEN_BY_INDEX[Number(cols[2])] ?? ''
      else if (type === 'RET' || type === 'JCM' || type === 'FAC' || type === 'PHY')
        names.push(`${cols[2]}${token}`)
      else if (type === 'GEN' && includeGp) names.push(`${cols[2]}${token}`)
    }
  }
  collect(templateCsv)
  if (physPreset) collect(poseAssetPhysicsG9)
  return names
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
  const { includeGp, physPreset: includePhys } = presetSelections(sections, character.gender)

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
  // block and before the custom sections; its rows are renumbered from physStart:
  // one past the last preset frame BEFORE the physics block, derived from
  // presetEndFrame (the single offset source) by removing the phys term — a
  // separately-summed `base + gp` here silently lacked presetEndFrame's dk term,
  // the one crack in the single-source frame math (inert only while the template
  // gate forbids DK).
  const end = presetEndFrame(sections, character.gender, frames)
  const physStart = end + 1 - (includePhys ? frames.phys : 0)
  const physRows = includePhys ? physicsPoseAssetRows(physStart) : []
  const customRows = customPoseAssetRows(character, end)
  return [...head, ...physRows, ...customRows, ...tail].join('\n') + '\n'
}

/**
 * File name for the Houdini PoseAsset CSV: `<Name>_pose_asset.csv` (DTH
 * naming), or `<Name>_<Scene>_pose_asset.csv` for a scene override's variant.
 */
export function poseAssetFileName(character: Character, sceneSlug?: string): string {
  return `${characterSlug(character)}${sceneSlug ? `_${sceneSlug}` : ''}_pose_asset.csv`
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
   * CSV era from `poseAssetCsvEra` — selects which template's control-row
   * format is valid. A future breaking era branches through a new
   * {@link GENERATIONS} template row, shipped together with adding that release to
   * `POSEASSET_CSV_BREAKING_VERSIONS`.
   */
  era: PoseAssetCsvEra = '',
  /** Scene-override variant — suffixes the file name (see {@link poseAssetFileName}). */
  sceneSlug?: string,
): GeneratedFile {
  const templateCsv = GENERATION_TEMPLATE_CSV[character.genesis]
  if (templateCsv && poseAssetCsvValidated(character, era, frames.base, frames.gp, frames.phys)) {
    // Custom PHY is only half-modeled: the schema can't carry the physics
    // payload the HDA defines for PHY rows (offset_distance / radius / per-pose
    // push XYZ), so its rows import without a push direction. Until that's
    // modeled, a custom PHY section keeps the file honest by flagging it
    // experimental instead of shipping it as validated ground truth.
    const customPhy =
      character.sections.PHY.enabled && character.sections.PHY.mode === 'custom'
    return {
      fileName: poseAssetFileName(character, sceneSlug),
      content: spliceTemplate(templateCsv, character.genesis, character, frames),
      target: 'houdini',
      ...(customPhy ? { experimental: true } : {}),
    }
  }

  // Unvalidated configuration (linear, no FAC, Dicktator, custom base, wrong era,
  // non-standard baked length, …): only the custom sections, frames continuing
  // after the measured preset length. presetEndFrame is -1 with no base ROM → the
  // first custom pose lands at frame 0 (see referenceFrames). NEVER clamp to 0 —
  // that desyncs the CSV from Daz.
  const lastPresetFrame = presetEndFrame(character.sections, character.gender, frames)
  return {
    fileName: poseAssetFileName(character, sceneSlug),
    content: customPoseAssetRows(character, lastPresetFrame).join('\n') + '\n',
    target: 'houdini',
    experimental: true,
  }
}
