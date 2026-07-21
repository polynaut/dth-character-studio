import { presetSelections } from './frames'
import { characterSkinning, genAssetGender, genRomIncludes } from './types'

import type { Character, DthPoseAsset, Gender, GenesisVersion, RomSection } from './types'

/**
 * Catalog / path resolution: which shipped DTH preset `.duf`s a character's
 * selections resolve to, whether a section's preset is available at all, and
 * the fingerprint that tells the editor when to re-measure preset frames.
 * The generators (dsa.ts / csv.ts) never look at the catalog — they consume
 * the resolved {@link RomPaths}.
 */

/** Exact .duf paths for the wrapper's options — resolved from the catalog. */
export interface RomPaths {
  jcm?: string
  mouth?: string
  gp?: string
  dk?: string
  phys?: string
}

/**
 * The catalog's FAC-preset support for a generation, derived from ONE signal:
 * FAC frames ride in a FAC-variant JCM base ROM (`includesFac`), never in a
 * FAC-section asset — the FAC-section entry is the G9 Mouth COMPANION, which
 * only adds mouth-node keys over those same base frames (runtime v19: the
 * mouth pass runs only when a mouth asset resolves; G8.1 has FAC in its base
 * and no mouth at all). Both {@link sectionPresetAvailable}'s FAC chip and
 * {@link resolveRomPaths}'s mouth resolution consume THIS, so the two views
 * can't diverge: a catalog shipping a mouth but only FAC-less bases reports
 * unavailable AND resolves no mouth (there are no base FAC frames for the
 * companion to serve); a FAC-capable base with no mouth reports available
 * with an empty companion list (the G8.1 shape).
 */
export function facPresetSupport(
  assets: Array<DthPoseAsset>,
  genesis: GenesisVersion,
): { available: boolean; mouths: Array<DthPoseAsset> } {
  const forGen = assets.filter((a) => a.genesis === null || a.genesis === genesis)
  const available = forGen.some((a) => a.section === 'JCM' && a.includesFac)
  return { available, mouths: available ? forGen.filter((a) => a.section === 'FAC') : [] }
}

/**
 * Resolves the exact ROM files for the character's preset selections, using
 * the same logic as the UI (explicit pick wins, else the DQS/FAC-matching
 * default). Returns {} when no catalog is available — the wrapper then falls
 * back to the DTH_POSES_PATH resolution in DthOptions.dsa. The preset-block
 * selection booleans come from {@link presetSelections} (the single source —
 * hand-rewriting `enabled && mode === 'preset'` here is exactly the pattern
 * behind the historical dk-term desync).
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

  const { jcmPreset, facPreset, physPreset, includeGp, includeDk } = presetSelections(
    sections,
    gender,
  )
  // The mouth companion resolves through the ONE FAC rule (facPresetSupport):
  // no FAC-capable base in the catalog → no mouth, matching the availability chip.
  const facSupport = facPresetSupport(catalog.assets, genesis)
  const resolveMouth = (skinning: DthPoseAsset['skinning']) =>
    facSupport.mouths.find((a) => a.skinning === skinning) ?? facSupport.mouths[0]

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
      const mouth = resolveMouth(effective?.skinning ?? characterSkinning(character))
      if (mouth) paths.mouth = join(mouth.relPath)
    }
  }

  // Custom JCM: the base ROM path comes from the user (set in the generator,
  // not the catalog); still resolve the FAC mouth from the catalog when enabled.
  if (sections.JCM.enabled && sections.JCM.mode === 'custom' && facPreset && !paths.mouth) {
    const mouth = resolveMouth(characterSkinning(character))
    if (mouth) paths.mouth = join(mouth.relPath)
  }

  if (includeGp || includeDk) {
    const genAssets = catalog.assets.filter((a) => a.section === 'GEN' && forGenesis(a))
    if (includeGp) {
      const gp = genAssets.find((a) => genAssetGender(a.name) === 'female')
      if (gp) paths.gp = join(gp.relPath)
    }
    if (includeDk) {
      const dk = genAssets.find((a) => genAssetGender(a.name) === 'male')
      if (dk) paths.dk = join(dk.relPath)
    }
  }

  if (physPreset) {
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
 * FAC-section asset (the shared rule lives in {@link facPresetSupport}); GEN
 * needs the gendered ROM(s) {@link genRomIncludes} selects; PHY any physics
 * asset. Sections without preset assets (EXP, FBM, MISC — and RET, which lives
 * inside the JCM base) always report available. An EMPTY catalog reports
 * available too: "unknown" must not lock the editor.
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
  if (section === 'FAC') return facPresetSupport(catalog.assets, genesis).available
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
 * {@link resolveRomPaths}, {@link genRomIncludes} and `jcmIsBaseRom`.
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
