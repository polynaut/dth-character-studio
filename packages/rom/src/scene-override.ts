import { ROM_SECTIONS } from './types'

import type { Character, RomGroup, RomPose, RomSection, RomSections, SceneOverride } from './types'

/**
 * Per-Daz-scene ROM overrides. ONE rule: any divergence from the primary is an
 * override. A scene stores its OWN groups for each ROM section it diverges on
 * (`sceneOverrideSchema.sections` in types.ts — a partial map, present only for
 * a section that differs); a section it leaves alone inherits the primary's
 * groups verbatim. This module merges that snapshot into the base, DERIVES the
 * "overridden" marks by diffing against the primary (never stored as flags), and
 * decides which overrides generate. The scene-suffixed artifact generation lives
 * in generate.ts; the config delta in dsa.ts (`buildSceneConfigMap`).
 */

/**
 * The sections a scene override compiles to: each section is the scene's own
 * snapshot when it has one (`sections[S]`), else the base section's groups
 * verbatim. Both the editor's frame display and generation consume THIS, so what
 * the override grid shows is exactly what the scene's script + CSV get. Never
 * mutates the base.
 */
export function applySceneOverride(
  sections: RomSections,
  override: Pick<SceneOverride, 'sections'>,
): RomSections {
  const next = { ...sections }
  for (const section of ROM_SECTIONS) {
    const snapshot = override.sections[section]
    if (snapshot) next[section] = { ...sections[section], groups: snapshot }
  }
  return next
}

/** A pose's identity-free CONTENT signature (name + bone-scale + morph values,
 *  ignoring the pose/morph `id` grid keys) — the "does this row differ" tell. */
function poseContentSig(pose: RomPose): string {
  return JSON.stringify({
    name: pose.name,
    boneScaleRef: pose.boneScaleRef,
    morphs: pose.morphs.map((m) => ({
      node: m.node,
      prop: m.prop,
      value: m.value,
      base: m.base,
      autoBase: m.autoBase,
    })),
  })
}

/** A section's STRUCTURE signature: group order + group config + the pose-id
 *  order within each group, but NOT pose content. Two sections with the same
 *  structure differ only in row content (→ a per-row mark, not a section mark). */
function sectionStructureSig(groups: Array<RomGroup>): string {
  return JSON.stringify(
    groups.map((g) => ({
      id: g.id,
      label: g.label,
      suffix: g.suffix,
      method: g.method,
      calculateFrom: g.calculateFrom,
      poses: g.poses.map((p) => p.id),
    })),
  )
}

/** A section's FULL signature (structure + every pose's content) — the reliable,
 *  key-order-independent deep-equal used to prune a snapshot back to the base. */
function sectionFullSig(groups: Array<RomGroup>): string {
  return JSON.stringify(
    groups.map((g) => ({
      id: g.id,
      label: g.label,
      suffix: g.suffix,
      method: g.method,
      calculateFrom: g.calculateFrom,
      poses: g.poses.map((p) => ({ id: p.id, content: poseContentSig(p) })),
    })),
  )
}

/**
 * Whether a scene's section diverges STRUCTURALLY from the primary — its frame
 * count/order or its group layout differs (not just a row's content). This is
 * what lights the section-title "overridden" mark; a content-only difference
 * lights the per-row mark instead (see {@link sceneRowOverridden}). False for a
 * section with no snapshot (it inherits the primary).
 */
export function sceneSectionDiverged(
  base: RomSections,
  override: Pick<SceneOverride, 'sections'>,
  section: RomSection,
): boolean {
  const snapshot = override.sections[section]
  if (!snapshot) return false
  return sectionStructureSig(snapshot) !== sectionStructureSig(base[section].groups)
}

/** All primary ROM rows keyed by pose id — the lookup the row-diff needs. Pose
 *  ids are unique across the ROM (the schema heals duplicates), so one flat map
 *  covers every section. */
export function primaryRowsById(sections: RomSections): Map<string, RomPose> {
  const byId = new Map<string, RomPose>()
  for (const section of ROM_SECTIONS) {
    for (const group of sections[section].groups) {
      for (const pose of group.poses) byId.set(pose.id, pose)
    }
  }
  return byId
}

/**
 * Whether a scene row overrides its primary twin: it has no twin (an ADDED row)
 * or its content differs from the twin with the same pose id. Drives the per-row
 * green highlight + the row's reset control.
 */
export function sceneRowOverridden(primaryById: Map<string, RomPose>, pose: RomPose): boolean {
  const twin = primaryById.get(pose.id)
  return !twin || poseContentSig(twin) !== poseContentSig(pose)
}

/**
 * Normalize a scene override's ROM snapshot after an edit: drop any section whose
 * snapshot is now identical to the primary (an add-then-undo re-inherits, exactly
 * like a dial returned to base reads as not-overridden), and recompute the ROM
 * `enabled` gate from "any section still diverges". The identity/groom/preserve
 * blocks pass through untouched. Callers write the snapshot through this so the
 * stored override never carries a no-op section and `enabled` can't disagree.
 */
export function pruneSceneSections<T extends Pick<SceneOverride, 'sections' | 'enabled'>>(
  base: RomSections,
  override: T,
): T {
  const sections: Partial<Record<RomSection, Array<RomGroup>>> = {}
  for (const section of ROM_SECTIONS) {
    const snapshot = override.sections[section]
    if (snapshot && sectionFullSig(snapshot) !== sectionFullSig(base[section].groups)) {
      sections[section] = snapshot
    }
  }
  return { ...override, sections, enabled: Object.keys(sections).length > 0 }
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
 * Whether a scene override changes the ROM itself (its `enabled` gate — derived
 * from "a section diverges from the primary") — the only kind that produces
 * MERGED sections, and so its own scene-suffixed PoseAsset CSV. An identity- or
 * groom-only override keeps the base frames (its effect is a run-time config
 * delta / the per-scene hair list), so it rides the base CSV. Callers that mint
 * per-scene CSVs or check for file-name clashes filter on this.
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
