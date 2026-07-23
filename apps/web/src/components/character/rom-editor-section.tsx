import { memo, useCallback, useMemo } from 'react'

import { InfoPopup } from '@dth/ui'
import { GuideLink } from '#/components/guide-link.tsx'
import { RomSections } from '#/components/rom-sections.tsx'
import { RomTimeline } from '#/components/rom/rom-timeline.tsx'
import { applySceneOverride, characterSkinning, romTimeline, sceneOverrideSchema } from '@dth/rom'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'
import type { PoseAssetCatalog } from '#/components/rom/preset-asset-picker.tsx'
import type { Character, PresetFrames, RomSection, SceneOverride } from '@dth/rom'

/**
 * The ROM block: heading, the timeline, and the eight-section editor. On a
 * non-primary Daz scene the grid is implicitly in override mode (arm-on-edit — no
 * toggle). Memoized with identity-stable callbacks from the page
 * (the draft hook's `patch` is stable) — this is the editor's heavy subtree,
 * and page-level churn that doesn't touch its props must not re-render it.
 */
export const RomEditorSection = memo(function RomEditorSection({
  character,
  patch,
  catalog,
  presetFrames,
  failedFrames,
  revealFrame,
  revealPose,
  morphIndex,
  overrideEligible,
  scenePath,
  sceneOverride,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  catalog: PoseAssetCatalog
  presetFrames: PresetFrames | null
  failedFrames?: Set<number>
  revealFrame: { frame: number; nonce: number } | null
  revealPose: { section: RomSection; poseId: string; nonce: number } | null
  morphIndex: Array<MorphIndexEntry>
  /** True while a non-primary Daz scene is selected — the grid then edits a
   *  per-scene ROM override (arm-on-edit) instead of the base sections. */
  overrideEligible: boolean
  /** The selected scene's path — keys the per-scene override. */
  scenePath: string
  sceneOverride: SceneOverride | undefined
}) {
  // Stable callback identities so the memoized RomSections doesn't re-render
  // on every ROM-editor render (deps change only when the data they map does).
  const onSectionsChange = useCallback(
    (sections: Character['sections']) => patch({ sections }),
    [patch],
  )
  const onJcmMorphModsChange = useCallback(
    (jcmMorphMods: Character['jcmMorphMods']) => patch({ jcmMorphMods }),
    [patch],
  )
  const onOverrideChange = useCallback(
    (next: SceneOverride) => {
      // The grid already normalized `next` (RomSections' `pruneSceneSections` drops
      // no-op section snapshots and recomputes the `enabled` gate), so persist it
      // as-is — upsert by scene path.
      const exists = character.sceneOverrides.some((o) => o.scenePath === next.scenePath)
      patch({
        sceneOverrides: exists
          ? character.sceneOverrides.map((o) => (o.scenePath === next.scenePath ? next : o))
          : [...character.sceneOverrides, next],
      })
    },
    [character.sceneOverrides, patch],
  )
  // On a non-primary scene the grid edits this scene's OWN snapshot of the
  // sections (any divergence from the primary is the override). A fresh (unstored)
  // override backs the display until the first edit persists one.
  const overrideProp = useMemo(
    () =>
      overrideEligible
        ? {
            data: sceneOverride ?? sceneOverrideSchema.parse({ scenePath }),
            onChange: onOverrideChange,
          }
        : undefined,
    [overrideEligible, sceneOverride, scenePath, onOverrideChange],
  )
  // The timeline segments — a full walk over the (merged) sections, so compute
  // it only when its actual inputs change, not on every render.
  const timelineSegments = useMemo(
    () =>
      presetFrames
        ? romTimeline(
            overrideProp
              ? applySceneOverride(character.sections, overrideProp.data)
              : character.sections,
            character.gender,
            presetFrames,
          )
        : null,
    [character.sections, character.gender, presetFrames, overrideProp],
  )

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="flex w-fit items-center gap-1 text-xl font-semibold">
          ROM
          <InfoPopup label="ROM — more information">
            The eight pose-asset categories in canonical order. Frame numbers follow section, group
            and pose order — the generated Daz script and PoseAsset CSV share them automatically.{' '}
            <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/04-first-character.html#the-rom-definition" />
          </InfoPopup>
        </h2>
      </div>
      {timelineSegments && (
        <div className="mb-4 rounded-lg border bg-card p-3">
          <RomTimeline segments={timelineSegments} />
        </div>
      )}
      <RomSections
        sections={character.sections}
        genesis={character.genesis}
        gender={character.gender}
        skinning={characterSkinning(character)}
        catalog={catalog}
        presetFrames={presetFrames}
        failedFrames={failedFrames}
        revealFrame={revealFrame}
        revealPose={revealPose}
        morphIndex={morphIndex}
        jcmMorphMods={character.jcmMorphMods}
        onJcmMorphModsChange={onJcmMorphModsChange}
        override={overrideProp}
        onChange={onSectionsChange}
      />
    </section>
  )
})
