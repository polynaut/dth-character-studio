import { useCallback, useState } from 'react'

import { sceneOverrideSchema, sceneRecordEmpty } from '@dth/rom'
import type { Character, SceneOverride } from '@dth/rom'

import { preserveMorphsKey, preserveNodesKey } from './preserve-diff.ts'

/**
 * The character editor's page-local Daz-scene selection (the scene cards) and the
 * per-scene override writers that follow it. With a non-primary scene selected an
 * overridable field edits a per-scene record (stored on the character, keyed by
 * scene path) instead of the base — implicitly: a value that DIFFERS from the base
 * is the override, so there are no arm/disarm toggles. Panels are PRESENCE-armed
 * (schema v24): a block existing on the record IS the override; writing a panel
 * back to the base deletes its block, and a record left carrying nothing is
 * dropped entirely ({@link sceneRecordEmpty}). Entering the character selects
 * the primary scene by default; unlinking the selected extra scene falls back to
 * it too (the stored path just stops matching).
 */
export function useSceneSelection(character: Character, patch: (p: Partial<Character>) => void) {
  const [selectedScene, setSelectedScene] = useState('')
  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const effectiveScene = linkedScenes.includes(selectedScene)
    ? selectedScene
    : character.scenePath || ''
  // A field is overridable only while an EXTRA (non-primary) scene is selected —
  // the primary scene IS the base definition. The record lives on the character
  // (per scene path) and follows the selection.
  const overrideEligible = effectiveScene !== '' && effectiveScene !== character.scenePath
  const sceneOverride: SceneOverride | undefined = character.sceneOverrides.find(
    (o) => o.scenePath === effectiveScene,
  )

  /** Store `record` as the selected scene's record — replacing the existing one,
   *  appending a new one, or (when it holds nothing anymore) dropping it. */
  const writeRecord = useCallback(
    (record: SceneOverride) => {
      const others = character.sceneOverrides.filter((o) => o.scenePath !== effectiveScene)
      patch({
        sceneOverrides: sceneRecordEmpty(record) ? others : [...others, record],
      })
    },
    [character.sceneOverrides, effectiveScene, patch],
  )

  /**
   * Write the Genesis-9 identity dials for the selected non-primary scene under
   * the implicit-override model: a dial that differs from the base character IS
   * an override — the `identity` block exists exactly while some dial differs.
   * Untouched dials stay equal to the base, so they never read as overridden,
   * and passing a base value back in is how a field resets (the block — and an
   * otherwise-empty record — disappear when the last dial returns to base).
   * No-op on the primary scene (there editing goes straight to the base).
   */
  const writeIdentity = useCallback(
    (next: Partial<NonNullable<SceneOverride['identity']>>) => {
      if (!overrideEligible) return
      const base = {
        facsDetailStrength: character.facsDetailStrength,
        flexionStrength: character.flexionStrength,
        applyUE5TearUV: character.applyUE5TearUV,
      }
      const existing = character.sceneOverrides.find((o) => o.scenePath === effectiveScene)
      const merged = { ...(existing?.identity ?? base), ...next }
      const diverges =
        merged.facsDetailStrength !== base.facsDetailStrength ||
        merged.flexionStrength !== base.flexionStrength ||
        merged.applyUE5TearUV !== base.applyUE5TearUV
      const record = existing ?? sceneOverrideSchema.parse({ scenePath: effectiveScene })
      writeRecord({ ...record, identity: diverges ? merged : undefined })
    },
    [
      character.sceneOverrides,
      character.facsDetailStrength,
      character.flexionStrength,
      character.applyUE5TearUV,
      effectiveScene,
      overrideEligible,
      writeRecord,
    ],
  )

  /**
   * Write the per-scene preserve lists (morphs / node transforms) under the same
   * implicit-override model. The `preserve` block exists exactly while a list
   * differs from the base — compared as a canonical MULTISET keyed by the natural
   * identity (morph name+value / node label), so reordering never spuriously arms
   * it, yet renaming a row to duplicate another base key still counts as a
   * divergence (a plain Set misses that and would revert the edit). Untouched
   * rows equal the base, so they never read as overridden. No-op on the primary
   * scene (edits there go to the base).
   */
  const writePreserve = useCallback(
    (next: {
      morphs?: NonNullable<SceneOverride['preserve']>['morphs']
      nodeTransforms?: NonNullable<SceneOverride['preserve']>['nodeTransforms']
    }) => {
      if (!overrideEligible) return
      const baseMorphs = character.preserveMorphs
      const baseNodes = character.preserveNodeTransforms
      const existing = character.sceneOverrides.find((o) => o.scenePath === effectiveScene)
      const start = existing?.preserve ?? { morphs: baseMorphs, nodeTransforms: baseNodes }
      const merged = { ...start, ...next }
      const morphsSame = preserveMorphsKey(merged.morphs) === preserveMorphsKey(baseMorphs)
      const nodesSame = preserveNodesKey(merged.nodeTransforms) === preserveNodesKey(baseNodes)
      const record = existing ?? sceneOverrideSchema.parse({ scenePath: effectiveScene })
      writeRecord({ ...record, preserve: morphsSame && nodesSame ? undefined : merged })
    },
    [
      character.sceneOverrides,
      character.preserveMorphs,
      character.preserveNodeTransforms,
      effectiveScene,
      overrideEligible,
      writeRecord,
    ],
  )

  return {
    /** The effective selection (falls back to the primary scene). */
    effectiveScene,
    selectScene: setSelectedScene,
    linkedScenes,
    /** True while an extra (non-primary) scene is selected — a field can override. */
    overrideEligible,
    sceneOverride,
    /** Implicit-override writer for the Genesis-9 dials (see above). */
    writeIdentity,
    /** Implicit-override writer for the preserve lists (see above). */
    writePreserve,
  }
}
