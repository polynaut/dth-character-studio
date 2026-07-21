import { memo, useCallback, useMemo } from 'react'

import { InfoPopup } from '@dth/ui'
import { GuideLink } from '#/components/guide-link.tsx'
import { PanelOverrideToggle } from '#/components/character/panel-override-toggle.tsx'
import { RomSections } from '#/components/rom-sections.tsx'
import { RomTimeline } from '#/components/rom/rom-timeline.tsx'
import { applySceneOverride, characterSkinning, romTimeline } from '@dth/rom'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'
import type { PoseAssetCatalog } from '#/components/rom/preset-asset-picker.tsx'
import type { Character, PresetFrames, RomSection, SceneOverride } from '@dth/rom'

/**
 * The ROM block: heading + per-scene Override toggle, the timeline, and the
 * eight-section editor. Memoized with identity-stable callbacks from the page
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
  overrideActive,
  selectedSceneName,
  sceneOverride,
  setOverrideEnabled,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  catalog: PoseAssetCatalog
  presetFrames: PresetFrames | null
  failedFrames?: Set<number>
  revealFrame: { frame: number; nonce: number } | null
  revealPose: { section: RomSection; poseId: string; nonce: number } | null
  morphIndex: Array<MorphIndexEntry>
  /** Scene-override arming, from useSceneSelection. */
  overrideEligible: boolean
  overrideActive: boolean
  selectedSceneName: string
  sceneOverride: SceneOverride | undefined
  setOverrideEnabled: (enabled: boolean) => void
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
    (next: SceneOverride) =>
      patch({
        sceneOverrides: character.sceneOverrides.map((o) =>
          o.scenePath === next.scenePath ? next : o,
        ),
      }),
    [character.sceneOverrides, patch],
  )
  const overrideProp = useMemo(
    () =>
      overrideActive && sceneOverride
        ? { data: sceneOverride, onChange: onOverrideChange }
        : undefined,
    [overrideActive, sceneOverride, onOverrideChange],
  )
  // The timeline segments — a full walk over the (merged) sections, so compute
  // it only when its actual inputs change, not on every render.
  const timelineSegments = useMemo(
    () =>
      presetFrames
        ? romTimeline(
            overrideActive && sceneOverride
              ? applySceneOverride(character.sections, sceneOverride)
              : character.sections,
            character.gender,
            presetFrames,
          )
        : null,
    [character.sections, character.gender, presetFrames, overrideActive, sceneOverride],
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
        {/* Per-scene override toggle: armed only while an EXTRA scene is
            selected in the Daz scenes cards (the primary scene IS the base
            ROM). Toggling off keeps the stored override, just inactive. */}
        <span className="ml-auto">
          <PanelOverrideToggle
            eligible={overrideEligible}
            active={overrideActive}
            sceneName={selectedSceneName}
            noun="ROM frames"
            onToggle={setOverrideEnabled}
            info={
              <>
                Drive <strong>different morphs for another Daz scene</strong> of this character
                (e.g. a second outfit): select one of the extra scenes in the Daz scenes cards,
                enable the override, then check <strong>Override</strong> on the rows to replace
                for that scene or add frames at the end of a group. Everything unchecked stays
                exactly as the base ROM. On Save the scene's frames go into the character's{' '}
                <em>one</em> Daz script (picked by the open scene at run time) and its own
                PoseAsset CSV.
              </>
            }
          />
        </span>
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
