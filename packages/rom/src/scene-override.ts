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
  // Whole-section OWNERSHIP: the stored full config REPLACES the base section (mode,
  // preset assets, art direction, groups, custom path). Used once the scene diverges
  // in a way the sparse poses/additions can't hold (a structural row edit, or any
  // non-row config edit); the sparse entries for an owned section no longer apply.
  const ownedConfig = new Map(
    (override.sectionOverrides ?? []).map((entry) => [entry.section, entry.config]),
  )
  // Per-scene enable/disable: a lightweight overlay that flips `enabled` LAST, on top
  // of whichever config (base or owned) applies — so a plain toggle doesn't "own"/
  // freeze the section, and an owned section can still be toggled independently.
  const enabledFor = new Map(
    (override.sectionEnabled ?? []).map((entry) => [entry.section, entry.enabled]),
  )
  const next = { ...sections }
  for (const section of ROM_SECTIONS) {
    const base = sections[section]
    const owned = ownedConfig.get(section)
    let merged
    if (owned) {
      merged = owned
    } else {
      let groups = base.groups.map((group) => ({
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
      merged = { ...base, groups }
    }
    const enabled = enabledFor.get(section) ?? merged.enabled
    next[section] = enabled === merged.enabled ? merged : { ...merged, enabled }
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
 * The overrides that feed generation: at least one panel gate armed (ROM section
 * `enabled`, `identity`, `groom`, `preserve`, or `jcm`) AND still pointing at a
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
        override.preserve.enabled ||
        override.jcm.enabled) &&
      character.extraScenes.includes(override.scenePath),
  )
}

/**
 * The projection of `sections` that determines the PoseAsset CSV's frame layout:
 * per section its enable/mode/preset-asset/custom-path and its custom rows (whose
 * name + content are baked into the CSV). Art direction is deliberately EXCLUDED —
 * it's a run-time Daz config delta (`gp/dkArtDirection`), never in the CSV — so an
 * art-direction-only scene override rides the base CSV. `jcmMorphMods` likewise
 * isn't here (not part of `sections`, and a runtime delta).
 */
function sectionsCsvSignature(sections: RomSections): string {
  return JSON.stringify(
    ROM_SECTIONS.map((section) => {
      const c = sections[section]
      return {
        enabled: c.enabled,
        mode: c.mode,
        presetAssets: c.presetAssets,
        groups: c.groups,
        customAssetPath: c.customAssetPath,
      }
    }),
  )
}

/**
 * Whether a scene override changes the ROM's FRAME LAYOUT — and so needs its own
 * scene-suffixed PoseAsset CSV (Houdini has no runtime to select frames). True iff
 * the merged sections' frame-affecting projection ({@link sectionsCsvSignature})
 * differs from the base. A config override that only touches art direction or
 * `jcmMorphMods` — pure run-time deltas — keeps the base frames, so it rides the
 * base CSV. Callers that mint per-scene CSVs or check for file-name clashes filter
 * on this.
 */
export function sceneOverrideBuildsRom(
  character: Pick<Character, 'sections'>,
  override: SceneOverride,
): boolean {
  if (!override.enabled) return false
  const merged = applySceneOverride(character.sections, override)
  return sectionsCsvSignature(merged) !== sectionsCsvSignature(character.sections)
}

/**
 * The scene's effective character for generation: the base definition with the
 * ROM panel's merged sections folded in when armed ({@link applySceneOverride}),
 * and the per-scene `jcmMorphMods` swapped in when the `jcm` panel is armed. Feeds
 * the scene's `extraFrames`, its PoseAsset CSV, AND the per-scene config delta
 * (`buildCharacterConfig(mergeSceneOverride(...))` in dsa.ts).
 *
 * The identity dials and preserve lists do NOT merge here: they ride as run-time
 * config DELTAS computed straight from the override in `buildSceneConfigMap`
 * (dsa.ts). The groom gate has no generation effect (hair lives per scene in
 * `groomScenes`).
 */
export function mergeSceneOverride(character: Character, override: SceneOverride): Character {
  let merged = character
  if (override.enabled)
    merged = { ...merged, sections: applySceneOverride(character.sections, override) }
  if (override.jcm.enabled) merged = { ...merged, jcmMorphMods: override.jcm.mods }
  return merged
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
