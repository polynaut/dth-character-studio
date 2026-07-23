import { useCallback, useState } from 'react'

import { sceneOverrideSchema } from '@dth/rom'
import { prettySceneName } from '#/lib/scene-name.ts'
import type { Character, SceneOverride } from '@dth/rom'

/** The overridable editor panels — each arms independently on a non-primary scene. */
export type OverridePanel = 'rom' | 'identity' | 'groom' | 'preserve'

/**
 * The character editor's page-local Daz-scene selection (the scene cards) and
 * the per-scene override arming that follows it. With a non-primary scene
 * selected, each overridable panel (ROM, Genesis-9 identity, hair) can arm its
 * own gate; the panels disable by default until armed, so an outfit scene starts
 * from the base and the user opts each panel in. Entering the character selects
 * the primary scene by default; unlinking the selected extra scene falls back to
 * it too (the stored path just stops matching).
 */
export function useSceneSelection(character: Character, patch: (p: Partial<Character>) => void) {
  const [selectedScene, setSelectedScene] = useState('')
  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const effectiveScene = linkedScenes.includes(selectedScene)
    ? selectedScene
    : character.scenePath || ''
  // A panel is overridable only while an EXTRA (non-primary) scene is selected —
  // the primary scene IS the base definition. The override entry lives on the
  // character (per scene path) and follows the selection.
  const overrideEligible = effectiveScene !== '' && effectiveScene !== character.scenePath
  const sceneOverride: SceneOverride | undefined = character.sceneOverrides.find(
    (o) => o.scenePath === effectiveScene,
  )
  /** The selected scene's display name — the override toggles' scene label and,
   *  with more than one scene linked, the header tag after the name. Prettified
   *  (character name stripped, separators spaced) so "KiraSummertide_G9_GP"
   *  reads "Summertide G9 GP", matching the header tag. */
  const rawSceneStem =
    effectiveScene.replace(/\\/g, '/').split('/').pop()?.replace(/\.duf$/i, '') ?? ''
  const selectedSceneName = prettySceneName(rawSceneStem, character.name)

  const panelGate = (o: SceneOverride | undefined, panel: OverridePanel): boolean => {
    if (!o) return false
    if (panel === 'rom') return o.enabled
    if (panel === 'identity') return o.identity.enabled
    if (panel === 'groom') return o.groom.enabled
    return o.preserve.enabled
  }
  const panelActive = (panel: OverridePanel) => overrideEligible && panelGate(sceneOverride, panel)

  // Arm/disarm one panel's gate for the selected scene. Minting a fresh override
  // seeds the identity block from the base character's dials (so arming it starts
  // as a copy of the base, then diverges); ROM/groom mint empty (ROM rows are
  // opted in per frame; the hair list already lives per scene in `groomScenes`).
  const setPanelEnabled = useCallback(
    (panel: OverridePanel, enabled: boolean) => {
      const existing = character.sceneOverrides.find((o) => o.scenePath === effectiveScene)
      if (!existing && !enabled) return
      // Flip one panel's gate. Arming identity/preserve for the FIRST time (their
      // values still at the schema defaults / empty) seeds from the base — so the
      // override starts as a copy the user can tweak or delete from — whatever the
      // arm order. A re-arm keeps whatever was already stored.
      const withGate = (o: SceneOverride): SceneOverride => {
        if (panel === 'rom') return { ...o, enabled }
        if (panel === 'groom') return { ...o, groom: { ...o.groom, enabled } }
        if (panel === 'identity') {
          const fresh =
            !o.identity.enabled &&
            o.identity.facsDetailStrength === 1 &&
            o.identity.flexionStrength === 1 &&
            !o.identity.applyUE5TearUV
          return {
            ...o,
            identity:
              enabled && fresh
                ? {
                    enabled: true,
                    facsDetailStrength: character.facsDetailStrength,
                    flexionStrength: character.flexionStrength,
                    applyUE5TearUV: character.applyUE5TearUV,
                  }
                : { ...o.identity, enabled },
          }
        }
        const preserveFresh =
          o.preserve.morphs.length === 0 && o.preserve.nodeTransforms.length === 0
        return {
          ...o,
          preserve:
            enabled && preserveFresh
              ? {
                  enabled: true,
                  morphs: character.preserveMorphs,
                  nodeTransforms: character.preserveNodeTransforms,
                }
              : { ...o.preserve, enabled },
        }
      }
      patch({
        sceneOverrides: existing
          ? character.sceneOverrides.map((o) => (o.scenePath === effectiveScene ? withGate(o) : o))
          : [
              ...character.sceneOverrides,
              withGate(sceneOverrideSchema.parse({ scenePath: effectiveScene })),
            ],
      })
    },
    [
      character.sceneOverrides,
      character.facsDetailStrength,
      character.flexionStrength,
      character.applyUE5TearUV,
      character.preserveMorphs,
      character.preserveNodeTransforms,
      effectiveScene,
      patch,
    ],
  )

  /** Patch the selected scene's override in place (for a panel's field edits
   *  while armed — e.g. the G9 dials). No-op if no override exists for it yet. */
  const patchOverride = useCallback(
    (partial: Partial<SceneOverride>) => {
      patch({
        sceneOverrides: character.sceneOverrides.map((o) =>
          o.scenePath === effectiveScene ? { ...o, ...partial } : o,
        ),
      })
    },
    [character.sceneOverrides, effectiveScene, patch],
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
      const start = existing && existing.identity.enabled ? existing.identity : { enabled: false, ...base }
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

  const setOverrideEnabled = useCallback(
    (enabled: boolean) => setPanelEnabled('rom', enabled),
    [setPanelEnabled],
  )
  const setIdentityOverrideEnabled = useCallback(
    (enabled: boolean) => setPanelEnabled('identity', enabled),
    [setPanelEnabled],
  )
  const setGroomOverrideEnabled = useCallback(
    (enabled: boolean) => setPanelEnabled('groom', enabled),
    [setPanelEnabled],
  )
  const setPreserveOverrideEnabled = useCallback(
    (enabled: boolean) => setPanelEnabled('preserve', enabled),
    [setPanelEnabled],
  )

  return {
    /** The effective selection (falls back to the primary scene). */
    effectiveScene,
    selectScene: setSelectedScene,
    linkedScenes,
    /** True while an extra (non-primary) scene is selected — a panel can override. */
    overrideEligible,
    selectedSceneName,
    sceneOverride,
    patchOverride,
    /** Implicit-override writer for the Genesis-9 dials (see above). */
    writeIdentity,
    // ROM panel (names kept for RomEditorSection's memoized props).
    overrideActive: panelActive('rom'),
    setOverrideEnabled,
    // Genesis-9 identity panel.
    identityOverrideActive: panelActive('identity'),
    setIdentityOverrideEnabled,
    // Hair panel.
    groomOverrideActive: panelActive('groom'),
    setGroomOverrideEnabled,
    // Preserve (Advanced options) panel.
    preserveOverrideActive: panelActive('preserve'),
    setPreserveOverrideEnabled,
  }
}
