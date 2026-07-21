import { useCallback, useState } from 'react'

import { sceneOverrideSchema } from '@dth/rom'
import { prettySceneName } from '#/lib/scene-name.ts'
import type { Character, SceneOverride } from '@dth/rom'

/** The overridable editor panels — each arms independently on a non-primary scene. */
export type OverridePanel = 'rom' | 'identity' | 'groom'

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

  const panelGate = (o: SceneOverride | undefined, panel: OverridePanel): boolean =>
    o
      ? panel === 'rom'
        ? o.enabled
        : panel === 'identity'
          ? o.identity.enabled
          : o.groom.enabled
      : false
  const panelActive = (panel: OverridePanel) => overrideEligible && panelGate(sceneOverride, panel)

  // Arm/disarm one panel's gate for the selected scene. Minting a fresh override
  // seeds the identity block from the base character's dials (so arming it starts
  // as a copy of the base, then diverges); ROM/groom mint empty (ROM rows are
  // opted in per frame; the hair list already lives per scene in `groomScenes`).
  const setPanelEnabled = useCallback(
    (panel: OverridePanel, enabled: boolean) => {
      const existing = character.sceneOverrides.find((o) => o.scenePath === effectiveScene)
      if (!existing && !enabled) return
      const withGate = (o: SceneOverride): SceneOverride =>
        panel === 'rom'
          ? { ...o, enabled }
          : panel === 'identity'
            ? { ...o, identity: { ...o.identity, enabled } }
            : { ...o, groom: { ...o.groom, enabled } }
      const minted = (): SceneOverride => {
        const base = sceneOverrideSchema.parse({ scenePath: effectiveScene })
        if (panel === 'identity' && enabled) {
          return {
            ...base,
            identity: {
              enabled: true,
              facsDetailStrength: character.facsDetailStrength,
              flexionStrength: character.flexionStrength,
              applyUE5TearUV: character.applyUE5TearUV,
            },
          }
        }
        return withGate(base)
      }
      patch({
        sceneOverrides: existing
          ? character.sceneOverrides.map((o) => (o.scenePath === effectiveScene ? withGate(o) : o))
          : [...character.sceneOverrides, minted()],
      })
    },
    [
      character.sceneOverrides,
      character.facsDetailStrength,
      character.flexionStrength,
      character.applyUE5TearUV,
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
    // ROM panel (names kept for RomEditorSection's memoized props).
    overrideActive: panelActive('rom'),
    setOverrideEnabled,
    // Genesis-9 identity panel.
    identityOverrideActive: panelActive('identity'),
    setIdentityOverrideEnabled,
    // Hair panel.
    groomOverrideActive: panelActive('groom'),
    setGroomOverrideEnabled,
  }
}
