import { useCallback, useState } from 'react'

import { sceneOverrideSchema } from '@dth/rom'
import type { Character, SceneOverride } from '@dth/rom'

/**
 * The character editor's page-local Daz-scene selection (the scene cards) and the
 * per-scene override writers that follow it. With a non-primary scene selected an
 * overridable field edits a per-scene override (stored on the character, keyed by
 * scene path) instead of the base — implicitly: a value that DIFFERS from the base
 * is the override, so there are no arm/disarm toggles. Entering the character selects
 * the primary scene by default; unlinking the selected extra scene falls back to it
 * too (the stored path just stops matching).
 */
export function useSceneSelection(character: Character, patch: (p: Partial<Character>) => void) {
  const [selectedScene, setSelectedScene] = useState('')
  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const effectiveScene = linkedScenes.includes(selectedScene)
    ? selectedScene
    : character.scenePath || ''
  // A field is overridable only while an EXTRA (non-primary) scene is selected —
  // the primary scene IS the base definition. The override entry lives on the
  // character (per scene path) and follows the selection.
  const overrideEligible = effectiveScene !== '' && effectiveScene !== character.scenePath
  const sceneOverride: SceneOverride | undefined = character.sceneOverrides.find(
    (o) => o.scenePath === effectiveScene,
  )

  /**
   * Write the Genesis-9 identity dials for the selected non-primary scene under the
   * implicit-override model: a dial that differs from the base character IS an
   * override, so `identity.enabled` (the gate generation reads) is derived from
   * "any dial differs". Untouched dials stay equal to the base, so they never read
   * as overridden. Passing a base value back in is how a field resets. No-op on the
   * primary scene (there editing goes straight to the base via `patch`).
   */
  const writeIdentity = useCallback(
    (
      next: Partial<
        Pick<
          SceneOverride['identity'],
          'facsDetailStrength' | 'flexionStrength' | 'applyUE5TearUV'
        >
      >,
    ) => {
      if (!overrideEligible) return
      const base = {
        facsDetailStrength: character.facsDetailStrength,
        flexionStrength: character.flexionStrength,
        applyUE5TearUV: character.applyUE5TearUV,
      }
      const existing = character.sceneOverrides.find((o) => o.scenePath === effectiveScene)
      // Start from the base (inherited) unless an override is already active — so
      // untouched dials compare equal to the base and never read as overridden even
      // if the stored block carried stale defaults from another panel's arming.
      const start =
        existing && existing.identity.enabled ? existing.identity : { enabled: false, ...base }
      const merged = { ...start, ...next }
      const enabled =
        merged.facsDetailStrength !== base.facsDetailStrength ||
        merged.flexionStrength !== base.flexionStrength ||
        merged.applyUE5TearUV !== base.applyUE5TearUV
      const identity = { ...merged, enabled }
      patch({
        sceneOverrides: existing
          ? character.sceneOverrides.map((o) =>
              o.scenePath === effectiveScene ? { ...o, identity } : o,
            )
          : [
              ...character.sceneOverrides,
              { ...sceneOverrideSchema.parse({ scenePath: effectiveScene }), identity },
            ],
      })
    },
    [
      character.sceneOverrides,
      character.facsDetailStrength,
      character.flexionStrength,
      character.applyUE5TearUV,
      effectiveScene,
      overrideEligible,
      patch,
    ],
  )

  /**
   * Write the per-scene preserve lists (morphs / node transforms) under the same
   * implicit-override model. `preserve.enabled` (the gate generation reads) is
   * derived from "the list differs from the base" — compared as a SET keyed by the
   * natural identity (morph name / node label), so reordering or removing a row
   * never spuriously arms it. Untouched rows equal the base, so they never read as
   * overridden. No-op on the primary scene (edits there go to the base).
   */
  const writePreserve = useCallback(
    (next: {
      morphs?: SceneOverride['preserve']['morphs']
      nodeTransforms?: SceneOverride['preserve']['nodeTransforms']
    }) => {
      if (!overrideEligible) return
      const baseMorphs = character.preserveMorphs
      const baseNodes = character.preserveNodeTransforms
      const existing = character.sceneOverrides.find((o) => o.scenePath === effectiveScene)
      const start =
        existing && existing.preserve.enabled
          ? existing.preserve
          : { enabled: false, morphs: baseMorphs, nodeTransforms: baseNodes }
      const merged = { ...start, ...next }
      const baseMorphByName = new Map(baseMorphs.map((m) => [m.name, m.keepValue]))
      const morphsSame =
        merged.morphs.length === baseMorphs.length &&
        merged.morphs.every((m) => baseMorphByName.get(m.name) === m.keepValue)
      const baseNodeSet = new Set(baseNodes.map((n) => n.nodeLabel))
      const nodesSame =
        merged.nodeTransforms.length === baseNodes.length &&
        merged.nodeTransforms.every((n) => baseNodeSet.has(n.nodeLabel))
      const preserve = { ...merged, enabled: !(morphsSame && nodesSame) }
      patch({
        sceneOverrides: existing
          ? character.sceneOverrides.map((o) =>
              o.scenePath === effectiveScene ? { ...o, preserve } : o,
            )
          : [
              ...character.sceneOverrides,
              { ...sceneOverrideSchema.parse({ scenePath: effectiveScene }), preserve },
            ],
      })
    },
    [
      character.sceneOverrides,
      character.preserveMorphs,
      character.preserveNodeTransforms,
      effectiveScene,
      overrideEligible,
      patch,
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
