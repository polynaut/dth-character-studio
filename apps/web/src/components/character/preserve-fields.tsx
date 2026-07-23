import { cn, Input, KeyedListEditor, Label, NumberField, OverrideMark } from '@dth/ui'
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
 * Both are homogeneous add/remove lists (`KeyedListEditor`).
 *
 * Per-scene overrides are IMPLICIT and PER-ITEM (no toggle). On a non-primary Daz
 * scene the lists start inherited from the base and are editable inline; a row that
 * differs from the base — a morph whose hold value changed, or a row not in the base
 * at all — becomes an override: a green border + a green dot that swaps to a reset on
 * row hover. Rows are matched to the base by their natural identity (morph name /
 * node label), so reordering or deleting one never mismarks the others.
 * `writePreserve` derives the `preserve.enabled` gate from "the list differs".
 */
export function PreserveFields({
  character,
  patch,
  overrideEligible,
  sceneOverride,
  writePreserve,
  morphIndex,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** True while a non-primary Daz scene is selected — rows can then be overridden. */
  overrideEligible: boolean
  sceneOverride: SceneOverride | undefined
  /** Implicit-override writer for the preserve lists (from useSceneSelection). */
  writePreserve: (next: {
    morphs?: SceneOverride['preserve']['morphs']
    nodeTransforms?: SceneOverride['preserve']['nodeTransforms']
  }) => void
  /** The scanned morph index — powers the Morph-name autocomplete, same as ROM. */
  morphIndex: Array<MorphIndexEntry>
}) {
  // The active preserve override (only when armed for this non-primary scene).
  const ov =
    overrideEligible && sceneOverride && sceneOverride.preserve.enabled
      ? sceneOverride.preserve
      : undefined
  const morphs = ov ? ov.morphs : character.preserveMorphs
  const nodes = ov ? ov.nodeTransforms : character.preserveNodeTransforms
  const setMorphs = (next: Character['preserveMorphs']) =>
    overrideEligible ? writePreserve({ morphs: next }) : patch({ preserveMorphs: next })
  const setNodes = (next: Character['preserveNodeTransforms']) =>
    overrideEligible ? writePreserve({ nodeTransforms: next }) : patch({ preserveNodeTransforms: next })

  // Rows are matched to the base by their natural key (morph name / node label).
  const baseMorphValue = new Map(character.preserveMorphs.map((m) => [m.name, m.keepValue]))
  const baseNodeLabels = new Set(character.preserveNodeTransforms.map((n) => n.nodeLabel))
  const morphOverridden = (i: number) => {
    if (!ov) return false
    const m = morphs[i]
    return !baseMorphValue.has(m.name) || baseMorphValue.get(m.name) !== m.keepValue
  }
  const resetMorph = (i: number) => {
    const m = morphs[i]
    const baseValue = baseMorphValue.get(m.name)
    // A changed base row resets to its base hold value; a row not in the base
    // (added / renamed) resets by dropping it.
    setMorphs(
      baseValue !== undefined
        ? morphs.map((x, j) => (j === i ? { ...x, keepValue: baseValue } : x))
        : morphs.filter((_, j) => j !== i),
    )
  }
  const nodeOverridden = (i: number) => !!ov && !baseNodeLabels.has(nodes[i].nodeLabel)
  // A node has no value — it's inherited (in the base) or an addition; reset drops it.
  const resetNode = (i: number) => setNodes(nodes.filter((_, j) => j !== i))

  const rowClass = 'group/ovr mb-2 flex items-center gap-2'

  return (
    <MorphIndexProvider morphIndex={morphIndex}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
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
              rowClassName={rowClass}
            >
              {(item, set, index) => {
                const isOv = morphOverridden(index)
                return (
                  <>
                    <span className="flex w-4 shrink-0 justify-center">
                      <OverrideMark overridden={isOv} onReset={() => resetMorph(index)} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <MorphNameCell
                        value={item.name}
                        placeholder="body_ctrl_BreastsUp-Down"
                        inputClassName={cn(
                          MORPH_FIELD_CLASS,
                          isOv && 'border-daz-green focus:border-daz-green',
                        )}
                        onCommit={(name) => set({ ...item, name })}
                        // Preserve morphs store only a name (no node), so a pick just
                        // takes the internal name.
                        onPick={(entry) => set({ ...item, name: entry.name })}
                      />
                    </div>
                    <NumberField
                      className="w-24 pr-6 text-right tabular-nums"
                      percent
                      overridden={isOv}
                      value={item.keepValue}
                      onCommit={(keepValue) => set({ ...item, keepValue })}
                    />
                  </>
                )
              }}
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
              rowClassName={rowClass}
            >
              {(item, set, index) => {
                const isOv = nodeOverridden(index)
                return (
                  <>
                    <span className="flex w-4 shrink-0 justify-center">
                      <OverrideMark overridden={isOv} onReset={() => resetNode(index)} />
                    </span>
                    <Input
                      value={item.nodeLabel}
                      overridden={isOv}
                      placeholder="Left Eye"
                      onChange={(e) => set({ nodeLabel: e.target.value })}
                    />
                  </>
                )
              }}
            </KeyedListEditor>
          </div>
        </div>
      </div>
    </MorphIndexProvider>
  )
}
