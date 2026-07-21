import { useCallback, useState } from 'react'

import { sceneOverrideSchema } from '@dth/rom'
import type { Character, SceneOverride } from '@dth/rom'

/**
 * The character editor's page-local Daz-scene selection (the scene cards) and
 * the per-scene ROM-override arming that follows it. Groom lists, the Override
 * toggle and — with more than one scene linked — the header's scene tag all
 * key off the selected scene. Entering the character selects the primary scene
 * by default; unlinking the selected extra scene falls back to it too (the
 * stored path just stops matching).
 */
export function useSceneSelection(character: Character, patch: (p: Partial<Character>) => void) {
  const [selectedScene, setSelectedScene] = useState('')
  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const effectiveScene = linkedScenes.includes(selectedScene)
    ? selectedScene
    : character.scenePath || ''
  // Scene override: an extra (non-primary) scene selected in the cards can
  // carry its own ROM override — most frames stay the base ROM's, a few rows
  // replaced / appended for that outfit. The override entry lives on the
  // character (per scene path) and follows the selection.
  const overrideEligible = effectiveScene !== '' && effectiveScene !== character.scenePath
  const sceneOverride: SceneOverride | undefined = character.sceneOverrides.find(
    (o) => o.scenePath === effectiveScene,
  )
  const overrideActive = overrideEligible && sceneOverride?.enabled === true
  /** The selected scene's display name (file stem) — the Override toggle's
   *  label and, with more than one scene linked, the header tag after the
   *  character name (so the active scene context rides the sticky header). */
  const selectedSceneName =
    effectiveScene.replace(/\\/g, '/').split('/').pop()?.replace(/\.duf$/i, '') ?? ''

  const setOverrideEnabled = useCallback(
    (enabled: boolean) => {
      const existing = character.sceneOverrides.find((o) => o.scenePath === effectiveScene)
      if (!existing && !enabled) return
      patch({
        sceneOverrides: existing
          ? character.sceneOverrides.map((o) =>
              o.scenePath === effectiveScene ? { ...o, enabled } : o,
            )
          : [
              ...character.sceneOverrides,
              // Mint a complete override (identity/groom default off) so a
              // freshly-armed scene carries every panel gate, not just ROM's.
              sceneOverrideSchema.parse({ scenePath: effectiveScene, enabled }),
            ],
      })
    },
    [character.sceneOverrides, effectiveScene, patch],
  )

  return {
    /** The effective selection (falls back to the primary scene). */
    effectiveScene,
    selectScene: setSelectedScene,
    linkedScenes,
    overrideEligible,
    overrideActive,
    sceneOverride,
    selectedSceneName,
    setOverrideEnabled,
  }
}
