import { Input, KeyedListEditor, Label, NumberField } from '@dth/ui'

import type { Character, SceneOverride } from '@dth/rom'

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
  sceneOverride,
  patchOverride,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** Scene-override arming, from useSceneSelection. The arming TOGGLE lives up in the
   *  section header (rendered by the route); these just gate the lists' lock state. */
  overrideEligible: boolean
  preserveOverrideActive: boolean
  sceneOverride: SceneOverride | undefined
  patchOverride: (partial: Partial<SceneOverride>) => void
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
    <div>
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
                  <Input
                    value={item.name}
                    placeholder="body_ctrl_BreastsUp-Down"
                    onChange={(e) => set({ ...item, name: e.target.value })}
                  />
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
    </div>
  )
}
