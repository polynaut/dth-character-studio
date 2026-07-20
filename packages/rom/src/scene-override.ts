import { ROM_SECTIONS, flatSectionGroupId } from './types'

import type { Character, RomPose, RomSections, SceneOverride } from './types'

/**
 * Per-Daz-scene ROM overrides: merging an override into the base sections and
 * the helpers that decide which overrides generate. The schema lives in
 * types.ts (`sceneOverrideSchema`); the scene-suffixed artifact generation in
 * generate.ts (`generateSceneOverride`).
 */

/**
 * The sections a scene override actually compiles to: every base row stays at
 * its position (replaced rows substitute CONTENT only, by pose id), and the
 * override's added rows are appended at their group's end — so the base frames
 * keep their numbers and the additions continue after them. Orphaned entries
 * (a replaced pose or a target group that no longer exists in the base) are
 * ignored. Both the editor's frame display and the generation consume THIS, so
 * what the override grid shows is what the scene's script + CSV get.
 */
export function applySceneOverride(
  sections: RomSections,
  override: SceneOverride,
): RomSections {
  const replaced = new Map(override.poses.map((pose) => [pose.id, pose]))
  const additions = new Map(override.additions.map((entry) => [entry.groupId, entry.poses]))
  const next = { ...sections }
  for (const section of ROM_SECTIONS) {
    const config = sections[section]
    let groups = config.groups.map((group) => ({
      ...group,
      poses: [
        ...group.poses.map((pose) => replaced.get(pose.id) ?? pose),
        ...(additions.get(group.id) ?? []),
      ],
    }))
    // Added rows for a flat section that has no stored group yet key the
    // editor's implicit group — materialize it so they generate.
    const flatAdds = additions.get(flatSectionGroupId(section))
    if (groups.length === 0 && flatAdds && flatAdds.length > 0) {
      groups = [
        {
          id: flatSectionGroupId(section),
          label: '',
          suffix: 'centre',
          method: 'default',
          calculateFrom: 'default',
          poses: flatAdds,
        },
      ]
    }
    next[section] = { ...config, groups }
  }
  return next
}

/**
 * Filesystem-safe scene discriminator for a scene override's generated files —
 * the scene file's base name reduced to the characters generated file names
 * allow (same rule as {@link characterSlug}), e.g.
 * "D:\…\Electra Beach.duf" → "ElectraBeach".
 */
export function sceneOverrideSlug(scenePath: string): string {
  const base = scenePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const stem = base.replace(/\.[^.]*$/, '')
  return stem.replace(/[^A-Za-z0-9_]+/g, '') || 'Scene'
}

/**
 * The overrides that generate scene-specific artifacts: enabled AND still
 * pointing at a linked EXTRA scene (an override for an unlinked scene stays
 * stored but inert; the primary scene is by definition the base ROM). THE
 * single gate — generation, stale-artifact cleanup and save validation all ask
 * here, so they can't disagree.
 */
export function activeSceneOverrides(
  character: Pick<Character, 'extraScenes' | 'sceneOverrides'>,
): Array<SceneOverride> {
  return character.sceneOverrides.filter(
    (override) => override.enabled && character.extraScenes.includes(override.scenePath),
  )
}

/** A deep copy of a pose, safe to store as an override row and edit freely. */
export function clonePose(pose: RomPose): RomPose {
  return { ...pose, morphs: pose.morphs.map((morph) => ({ ...morph })) }
}
