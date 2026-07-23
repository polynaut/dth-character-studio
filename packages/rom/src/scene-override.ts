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
  override: Pick<SceneOverride, 'poses' | 'additions'>,
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
 * The overrides that feed generation: at least one panel gate armed (ROM
 * `enabled`, `identity.enabled`, or `groom.enabled`) AND still pointing at a
 * linked EXTRA scene (an override for an unlinked scene stays stored but inert;
 * the primary scene is by definition the base). THE single gate — the one
 * character script's per-scene config map, stale-artifact cleanup and save
 * validation all ask here, so they can't disagree. Use {@link sceneOverrideBuildsRom}
 * to narrow to the subset that also needs its own PoseAsset CSV.
 */
export function activeSceneOverrides(
  character: Pick<Character, 'extraScenes' | 'sceneOverrides'>,
): Array<SceneOverride> {
  return character.sceneOverrides.filter(
    (override) =>
      (override.enabled ||
        override.identity.enabled ||
        override.groom.enabled ||
        override.preserve.enabled) &&
      character.extraScenes.includes(override.scenePath),
  )
}

/**
 * Whether a scene override changes the ROM itself (its `enabled` ROM panel) —
 * the only kind that produces MERGED sections, and so its own scene-suffixed
 * PoseAsset CSV. An identity- or groom-only override keeps the base frames (its
 * effect is a run-time config delta / the per-scene hair list), so it rides the
 * base CSV. Callers that mint per-scene CSVs or check for file-name clashes
 * filter on this.
 */
export function sceneOverrideBuildsRom(override: Pick<SceneOverride, 'enabled'>): boolean {
  return override.enabled
}

/**
 * The scene's effective character for FRAME purposes: the base definition with
 * the ROM panel's merged sections folded in when it's armed
 * ({@link applySceneOverride}). Feeds the scene's `extraFrames` AND its PoseAsset
 * CSV — both derive from `sections` only, and that single shared derivation is
 * what keeps the Daz timeline and the Houdini CSV frame-aligned per scene.
 *
 * The identity dials and preserve lists do NOT merge here: they don't change
 * frames or the CSV, so they ride as a run-time config DELTA computed straight
 * from the override in `buildSceneConfigMap` (dsa.ts). The groom gate has no
 * generation effect at all (hair lives per scene in `groomScenes`).
 */
export function mergeSceneOverride(character: Character, override: SceneOverride): Character {
  return override.enabled
    ? { ...character, sections: applySceneOverride(character.sections, override) }
    : character
}

/** A deep copy of a pose, safe to store as an override row and edit freely. */
export function clonePose(pose: RomPose): RomPose {
  return { ...pose, morphs: pose.morphs.map((morph) => ({ ...morph })) }
}

/**
 * Whether two poses are materially identical — same name, bone-scale flag and
 * morph list (node/prop/value/base/autoBase, in order). Stable-editing ids are
 * ignored: they never reach generated output, so a pose differing only by id
 * still produces the same frame. This is the inverse of arm-on-edit: the editor
 * uses it to DISARM a scene override when a base row is edited back to match the
 * base (otherwise the override lingers as an identical, still-green copy).
 */
export function posesEqual(a: RomPose, b: RomPose): boolean {
  if (a.name !== b.name) return false
  if ((a.boneScaleRef ?? false) !== (b.boneScaleRef ?? false)) return false
  if (a.morphs.length !== b.morphs.length) return false
  return a.morphs.every((m, i) => {
    const n = b.morphs[i]
    return (
      m.node === n.node &&
      m.prop === n.prop &&
      m.value === n.value &&
      m.base === n.base &&
      m.autoBase === n.autoBase
    )
  })
}
