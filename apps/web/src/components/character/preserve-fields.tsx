import { Input, KeyedListEditor, Label, NumberField } from '@dth/ui'

import type { Character } from '@dth/rom'

/**
 * The two "preserve across the ROM load" list editors from the character
 * editor's Advanced options — morphs (name + hold value) and node transforms
 * (node label). Both are homogeneous add/remove lists, so they're rendered via
 * `KeyedListEditor`; `patch` is the route's partial-Character updater.
 */
export function PreserveFields({
  character,
  patch,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <div>
          <Label className="mb-2 flex w-fit items-center gap-1">
            Preserve morphs after ROM loading
          </Label>
          <KeyedListEditor
            items={character.preserveMorphs}
            onChange={(preserveMorphs) => patch({ preserveMorphs })}
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
            items={character.preserveNodeTransforms}
            onChange={(preserveNodeTransforms) => patch({ preserveNodeTransforms })}
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
    </div>
  )
}
