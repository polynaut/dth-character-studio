import { InfoPopup, Input, KeyedListEditor, Label, NumberField } from '@dth/ui'

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
            <InfoPopup label="Preserve morphs after ROM loading — more information">
              Morphs listed here are restored to the value you set after the DTH ROM loads —
              which otherwise zeroes them. Use it for body-shaping controls (e.g. breast or
              muscle morphs) you want to keep across the ROM. Enter the morph's property name
              and its hold value.
            </InfoPopup>
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
            <InfoPopup label="Preserve node transforms — more information">
              A node's transform is memorized before the ROM loads and restored afterwards, so
              posed nodes (e.g. eyes) keep their orientation instead of being reset. Enter the
              node's label as it appears in Daz.
            </InfoPopup>
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
