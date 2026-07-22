import { Input, KeyedListEditor, Label, NumberField } from '@dth/ui'
import { PanelOverrideToggle } from '#/components/character/panel-override-toggle.tsx'
import { MorphIndexProvider } from '#/components/rom/morph-index-provider.tsx'
import { MorphNameCell } from '#/components/rom/morph-name-cell.tsx'

import type { Character, SceneOverride } from '@dth/rom'
import type { MorphIndexEntry } from '#/lib/rom/api.ts'

// The morph-name field wears the ordinary form-input look (bordered, h-9) rather
// than MorphNameCell's default borderless table-cell style, so it matches the
// node-transform Input beside it.
const MORPH_FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30'

/**
 * The two "preserve across the ROM load" list editors from the character editor's
 * Advanced options — morphs (name + hold value) and node transforms (node label).
 * Both are homogeneous add/remove lists (`KeyedListEditor`). Per-scene overridable:
 * with a non-primary Daz scene selected the lists lock until the top-right override
 * toggle arms them, then they edit the scene's OWN preserve lists — a full copy the
 * user can add to and delete from. `patch` is the route's partial-Character updater.
 */
export function PreserveFields({
  character,
  patch,
  overrideEligible,
  preserveOverrideActive,
  setPreserveOverrideEnabled,
  selectedSceneName,
  scenePath,
  sceneOverride,
  patchOverride,
  morphIndex,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** Scene-override arming, from useSceneSelection. */
  overrideEligible: boolean
  preserveOverrideActive: boolean
  setPreserveOverrideEnabled: (enabled: boolean) => void
  selectedSceneName: string
  /** The selected scene's path — renders the override toggle label's mini render. */
  scenePath: string
  sceneOverride: SceneOverride | undefined
  patchOverride: (partial: Partial<SceneOverride>) => void
  /** The scanned morph index — powers the Morph-name autocomplete, same as ROM. */
  morphIndex: Array<MorphIndexEntry>
}) {
  // Armed on a non-primary scene → edit the scene's preserve override; else base.
  const activePreserve = preserveOverrideActive ? sceneOverride?.preserve : undefined
  const overriding = activePreserve != null
  const morphs = overriding ? activePreserve.morphs : character.preserveMorphs
  const nodes = overriding ? activePreserve.nodeTransforms : character.preserveNodeTransforms
  const setMorphs = (next: Character['preserveMorphs']) => {
    if (overriding) patchOverride({ preserve: { ...activePreserve, morphs: next } })
    else patch({ preserveMorphs: next })
  }
  const setNodes = (next: Character['preserveNodeTransforms']) => {
    if (overriding) patchOverride({ preserve: { ...activePreserve, nodeTransforms: next } })
    else patch({ preserveNodeTransforms: next })
  }
  // Locked = a non-primary scene is selected but the override isn't armed (shows
  // the base lists, dimmed and read-only, until the user opts in).
  const locked = overrideEligible && !overriding

  return (
    <MorphIndexProvider morphIndex={morphIndex}>
      <div className="mb-3 flex justify-end">
        <PanelOverrideToggle
          eligible={overrideEligible}
          active={preserveOverrideActive}
          scenePath={scenePath}
          sceneName={selectedSceneName}
          noun="preserve lists"
          compact
          onToggle={setPreserveOverrideEnabled}
          info={
            <>
              Give this Daz scene its <strong>own preserve-after-ROM lists</strong>: select one of
              the extra scenes in the Daz scenes cards, enable the override, then add, edit or
              remove entries for that scene. On Save they ride the character's one Daz script and
              apply when this scene is open; the base scene keeps its own.
            </>
          }
        />
      </div>
      {/* Native fieldset disable cascades to every input + the add/remove buttons,
          so the whole preserve area locks with one flag. */}
      <fieldset
        disabled={locked}
        className={`grid grid-cols-1 gap-6 lg:grid-cols-2${locked ? ' text-muted-foreground' : ''}`}
      >
        <div className="space-y-5">
          <div>
            <Label className="mb-2 flex w-fit items-center gap-1">
              Preserve morphs after ROM loading
            </Label>
            <KeyedListEditor
              items={morphs}
              onChange={setMorphs}
              newItem={() => ({ name: '', keepValue: 1 })}
              addLabel="Add morph"
            >
              {(item, set) => (
                <>
                  <div className="min-w-0 flex-1">
                    <MorphNameCell
                      value={item.name}
                      placeholder="body_ctrl_BreastsUp-Down"
                      inputClassName={MORPH_FIELD_CLASS}
                      onCommit={(name) => set({ ...item, name })}
                      // Preserve morphs store only a name (no node), so a pick just
                      // takes the internal name.
                      onPick={(entry) => set({ ...item, name: entry.name })}
                    />
                  </div>
                  <NumberField
                    className="w-24 pr-6 text-right tabular-nums"
                    percent
                    value={item.keepValue}
                    onCommit={(keepValue) => set({ ...item, keepValue })}
                  />
                </>
              )}
            </KeyedListEditor>
          </div>
          <div>
            <Label className="mb-2 flex w-fit items-center gap-1">
              Preserve node transforms (e.g. eyes)
            </Label>
            <KeyedListEditor
              items={nodes}
              onChange={setNodes}
              newItem={() => ({ nodeLabel: '' })}
              addLabel="Add node"
            >
              {(item, set) => (
                <Input
                  value={item.nodeLabel}
                  placeholder="Left Eye"
                  onChange={(e) => set({ nodeLabel: e.target.value })}
                />
              )}
            </KeyedListEditor>
          </div>
        </div>
      </fieldset>
    </MorphIndexProvider>
  )
}
