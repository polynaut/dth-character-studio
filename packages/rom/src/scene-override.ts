import { ROM_SECTIONS, flatSectionGroupId } from './types'

import type { Character, RomPose, RomSections, SceneOverride } from './types'

/**
 * Per-Daz-scene ROM overrides: merging an override into the base sections and
 * the helpers that decide which overrides generate. The schema lives in
 * types.ts (`sceneOverrideSchema`); the scene-suffixed artifact generation in
 * generate.ts (`generateSceneOverride`).
 */

/**
 * The sections a scene override actually compiles to. Two layers:
 *
 * - A **whole-section override** (`sectionOverrides`) replaces that section's groups
 *   verbatim — used once a structural edit (reorder / insert / add / remove) makes the
 *   section differ in order or count, which the sparse layer can't represent.
 * - Otherwise the **sparse** layer: every base row stays at its position (replaced rows
 *   substitute CONTENT only, by pose id) and the override's added rows are appended at
 *   their group's end — so the base frames keep their numbers and the additions
 *   continue after them.
 *
 * Orphaned entries (a replaced pose or a target group that no longer exists in the
 * base) are ignored. Both the editor's frame display and the generation consume THIS,
 * so what the override grid shows is what the scene's script + CSV get.
 */
export function applySceneOverride(
  sections: RomSections,
  override: Pick<SceneOverride, 'poses' | 'additions'> & {
    sectionOverrides?: SceneOverride['sectionOverrides']
    sectionEnabled?: SceneOverride['sectionEnabled']
  },
): RomSections {
  const replaced = new Map(override.poses.map((pose) => [pose.id, pose]))
  const additions = new Map(override.additions.map((entry) => [entry.groupId, entry.poses]))
  const sectionFull = new Map(
    (override.sectionOverrides ?? []).map((entry) => [entry.section, entry.groups]),
  )
  // Per-scene enable/disable: the stored value REPLACES the base section's on/off
  // state (mode/groups stay the base's), so a disabled section contributes no frames
  // and an enabled one uses the base config. Applied on BOTH assignment paths below.
  const enabledFor = new Map(
    (override.sectionEnabled ?? []).map((entry) => [entry.section, entry.enabled]),
  )
  const next = { ...sections }
  for (const section of ROM_SECTIONS) {
    const config = sections[section]
    const enabled = enabledFor.get(section) ?? config.enabled
    // Whole-section override wins: a structural edit snapshotted the scene's entire
    // section, so use its groups verbatim (the sparse replace/append no longer apply).
    const full = sectionFull.get(section)
    if (full) {
      next[section] = { ...config, enabled, groups: full }
      continue
    }
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
    next[section] = { ...config, enabled, groups }
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
 * Whether two ROM poses are equal for OVERRIDE purposes — same name, bone-scale flag
 * and morph list (each morph's node / prop / value / base / autoBase, in order). Row
 * and morph ids are ignored: they're editing handles, not content. Used to tell when a
 * per-scene value override has been edited back to the base row (e.g. a bone-scale flag
 * toggled on then off), so the override can be DROPPED instead of lingering as a no-op
 * copy that keeps the row falsely marked overridden (green).
 */
export function romPoseEqual(a: RomPose, b: RomPose): boolean {
  if (a.name !== b.name || (a.boneScaleRef ?? false) !== (b.boneScaleRef ?? false)) return false
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
