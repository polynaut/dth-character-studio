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
 * Per-scene overrides are IMPLICIT and WHOLE-LIST — one {@link OverrideMark} in each
 * list's LABEL, exactly like the other Daz-scene fields (no per-row control). On a
 * non-primary Daz scene the list starts inherited from the base and is editable
 * inline; the moment it differs from the base as a whole — any changed hold value,
 * an added row, or a removed one — the list counts as overridden: its label cube
 * goes green (reset there reverts the WHOLE list to the base) and its rows pick up
 * the green field border. The comparison is the same natural-identity set check
 * (morph name / node label) `writePreserve` uses to derive the `preserve.enabled`
 * gate, so reordering or removing a row never spuriously arms it.
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
  /** True while a non-primary Daz scene is selected — a list can then be overridden. */
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

  // Whole-list override: a list is overridden once it differs from the base scene as
  // a whole — compared by natural identity (morph name + hold value / node label) so
  // reordering never counts. Mirrors the `morphsSame`/`nodesSame` check writePreserve
  // uses to gate `preserve.enabled`.
  const baseMorphValue = new Map(character.preserveMorphs.map((m) => [m.name, m.keepValue]))
  const morphsSame =
    morphs.length === character.preserveMorphs.length &&
    morphs.every((m) => baseMorphValue.get(m.name) === m.keepValue)
  const baseNodeLabels = new Set(character.preserveNodeTransforms.map((n) => n.nodeLabel))
  const nodesSame =
    nodes.length === character.preserveNodeTransforms.length &&
    nodes.every((n) => baseNodeLabels.has(n.nodeLabel))
  const morphsOverridden = ov != null && !morphsSame
  const nodesOverridden = ov != null && !nodesSame
  // Reset reverts the whole list to the base scene's.
  const resetMorphs = () => setMorphs(character.preserveMorphs)
  const resetNodes = () => setNodes(character.preserveNodeTransforms)

  return (
    <MorphIndexProvider morphIndex={morphIndex}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <Label className="mb-2 flex w-fit items-center gap-1">
              Preserve morphs after ROM loading
              <OverrideMark overridden={morphsOverridden} onReset={resetMorphs} />
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
                      inputClassName={cn(
                        MORPH_FIELD_CLASS,
                        morphsOverridden &&
                          'border-daz-green focus:border-daz-green focus-visible:ring-daz-green/50',
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
                    overridden={morphsOverridden}
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
              <OverrideMark overridden={nodesOverridden} onReset={resetNodes} />
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
                  overridden={nodesOverridden}
                  placeholder="Left Eye"
                  onChange={(e) => set({ nodeLabel: e.target.value })}
                />
              )}
            </KeyedListEditor>
          </div>
        </div>
      </div>
    </MorphIndexProvider>
  )
}
