import { ROM_SECTIONS } from '@dth/rom'

import type { RomSection, RomSectionConfig, RomSections } from '@dth/rom'

/**
 * Pure logic behind the ROM "Fill from character" wizard (the timeline panel's
 * Fill button): which of a source character's sections are worth offering, a
 * short content summary per offered section, and the actual fill — replacing
 * the picked sections of the target with deep copies of the source's.
 *
 * GEN is special-cased throughout: its enabled state and its GP/DK preset
 * selection are derived from the character's PRIMARY SCENE (its geograft — see
 * `genEnabledForScan` / `primarySceneDerivation` in scene-compat.ts) and are
 * not user-operable, so a fill copies the section's WORK (mode, art direction,
 * custom groups) while the target keeps its own scene-derived plumbing.
 */

/** Whether a section holds anything worth copying: enabled, and — in custom
 *  mode — actually carrying content (a pose in some group, or a custom base
 *  ROM). An enabled preset section is always "filled": the preset selection
 *  (and its art direction) IS the config. */
export function sectionFilled(config: RomSectionConfig): boolean {
  if (!config.enabled) return false
  if (config.mode === 'preset') return true
  return config.groups.some((group) => group.poses.length > 0) || config.customAssetPath !== ''
}

/** The source's filled sections, in canonical ROM order — the wizard's
 *  checkbox list. RET has no independent existence (the retargeting poses
 *  live inside the JCM base ROM — the ROM editor derives its enable state
 *  the same way), so it counts as filled exactly when JCM is an enabled
 *  preset, ignoring its own stored flag. */
export function filledSections(sections: RomSections): Array<RomSection> {
  return ROM_SECTIONS.filter((section) =>
    section === 'RET'
      ? sections.JCM.enabled && sections.JCM.mode === 'preset'
      : sectionFilled(sections[section]),
  )
}

/** Short content summary for a wizard checkbox row, e.g. "preset ROM · 2
 *  art-directed frames" or "3 groups · 12 poses". */
export function sectionContentSummary(config: RomSectionConfig): string {
  if (config.mode === 'preset') {
    const art = config.artDirection.length
    return art > 0 ? `preset ROM · ${art} art-directed frame${art === 1 ? '' : 's'}` : 'preset ROM'
  }
  const parts: Array<string> = []
  if (config.customAssetPath) parts.push('custom base ROM')
  const groups = config.groups.filter((group) => group.poses.length > 0)
  const poses = groups.reduce((n, group) => n + group.poses.length, 0)
  if (groups.length > 1) parts.push(`${groups.length} groups`)
  if (poses > 0) parts.push(`${poses} pose${poses === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/**
 * Replace the picked sections of `target` with deep copies of the source's
 * config — the wizard's "Fill from character". Unpicked sections stay
 * untouched. The copies keep the source's group/pose ids: they can't collide
 * inside the target (a section's ids live only in that section, and the fill
 * replaces it wholesale), and the character schema's parse transform re-mints
 * duplicates anyway.
 *
 * GEN keeps the TARGET's `enabled` + `presetAssets`: both follow the primary
 * scene's GP/DK geograft (not user choice), and copying a both-grafts source
 * selection into a single-graft character would splice in a genital ROM block
 * its scene has no geograft for.
 */
export function fillSectionsFrom(
  target: RomSections,
  source: RomSections,
  picked: ReadonlyArray<RomSection>,
): RomSections {
  const next = { ...target }
  for (const section of picked) {
    const copy = structuredClone(source[section])
    if (section === 'GEN') {
      copy.enabled = target.GEN.enabled
      copy.presetAssets = [...target.GEN.presetAssets]
    }
    next[section] = copy
  }
  return next
}
