import { cn, Input, KeyedListEditor, Label, NumberField, OverrideMark, overrideLabelClass } from '@dth/ui'
import { MorphNodeInfo } from '#/components/character/morph-node-info.tsx'
import { MorphIndexProvider } from '#/components/rom/morph-index-provider.tsx'
import { MorphNameCell } from '#/components/rom/morph-name-cell.tsx'
import { morphRowKey, preserveMorphsKey, preserveNodesKey } from '#/lib/preserve-diff.ts'

import type { Character, SceneOverride } from '@dth/rom'
import type { MorphIndexEntry } from '#/lib/rom/api.ts'

// The morph-name field wears the ordinary form-input look (bordered, h-9) rather
// than MorphNameCell's default borderless table-cell style, so it matches the
// node-transform Input beside it.
const MORPH_FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30'

/**
 * The two "preserve across the ROM load" list editors from the character editor's
 * Advanced options — morphs (name + optional item scope + hold value) and node
 * transforms (node label). Both are homogeneous add/remove lists
 * (`KeyedListEditor`). A preserve morph's Item scope points the runtime's
 * lookup at that scene node (matched by internal name or label) — empty keeps
 * the pre-v32 reach, the figure root, which is why the empty scope reads
 * "Figure": a clothing morph picked from the index NEEDS the scope or the
 * runtime never finds it. The scope is READ-ONLY and shown as the small-label
 * info row UNDER the name field (see {@link MorphNodeInfo} — the same facts
 * the picked suggestion showed): picking a suggestion sets both the name and
 * the node, the badge's ✕ returns the lookup to the figure.
 *
 * Per-scene overrides are IMPLICIT and PER-LIST (no toggle). On a non-primary Daz
 * scene the lists start inherited from the base and are editable inline; the moment
 * any row differs — a hold value changed, or a row added/removed — the whole list is
 * overridden: ONE mark in the label (like the other fields) that goes green with a
 * reset reverting the list to the primary. A green border still marks each differing
 * row. Rows are matched to the base by their natural identity (morph name / node
 * label), so reordering never mismarks them. `writePreserve` keeps the
 * `preserve` block present exactly while a list differs (presence = armed).
 */
export function PreserveFields({
  character,
  patch,
  overrideEligible,
  sceneOverride,
  writePreserve,
  morphIndex,
  scenePath,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** True while a non-primary Daz scene is selected — rows can then be overridden. */
  overrideEligible: boolean
  sceneOverride: SceneOverride | undefined
  /** Implicit-override writer for the preserve lists (from useSceneSelection). */
  writePreserve: (next: {
    morphs?: NonNullable<SceneOverride['preserve']>['morphs']
    nodeTransforms?: NonNullable<SceneOverride['preserve']>['nodeTransforms']
  }) => void
  /** The scanned morph index — powers the Morph-name autocomplete, same as ROM. */
  morphIndex: Array<MorphIndexEntry>
  /** The selected Daz scene — scopes the autocomplete's scene-scanned entries. */
  scenePath?: string
}) {
  // The active preserve override — armed by PRESENCE for this non-primary scene.
  const ov = overrideEligible ? sceneOverride?.preserve : undefined
  const morphs = ov ? ov.morphs : character.preserveMorphs
  const nodes = ov ? ov.nodeTransforms : character.preserveNodeTransforms
  const setMorphs = (next: Character['preserveMorphs']) =>
    overrideEligible ? writePreserve({ morphs: next }) : patch({ preserveMorphs: next })
  const setNodes = (next: Character['preserveNodeTransforms']) =>
    overrideEligible ? writePreserve({ nodeTransforms: next }) : patch({ preserveNodeTransforms: next })

  // Rows are matched to the base by their natural key (morph name + item scope /
  // node label); a row differs from the base when it's new/renamed/rescoped or
  // its hold value changed.
  const baseMorphValue = new Map(character.preserveMorphs.map((m) => [morphRowKey(m), m.keepValue]))
  const baseNodeLabels = new Set(character.preserveNodeTransforms.map((n) => n.nodeLabel))
  const morphOverridden = (i: number) => {
    if (!ov) return false
    const m = morphs[i]
    return !baseMorphValue.has(morphRowKey(m)) || baseMorphValue.get(morphRowKey(m)) !== m.keepValue
  }
  const nodeOverridden = (i: number) => !!ov && !baseNodeLabels.has(nodes[i].nodeLabel)
  // The override is per LIST, not per row: one control in the label (like the other
  // fields), green once the whole list differs from the base — a row changed, or one
  // was added/removed. Reset reverts the list to the primary scene's; the per-row
  // green border still marks which rows differ.
  // Whole-list divergence is compared as a MULTISET (via the shared preserve-diff
  // keys), the SAME test `writePreserve` uses to arm the gate — so the reset handle
  // shows exactly when the override is armed, including the duplicate-key case a set
  // compare would miss (base [Head,Neck] → [Head,Head]).
  const morphsOverridden =
    !!ov && preserveMorphsKey(morphs) !== preserveMorphsKey(character.preserveMorphs)
  const nodesOverridden =
    !!ov && preserveNodesKey(nodes) !== preserveNodesKey(character.preserveNodeTransforms)
  const resetMorphs = () => setMorphs(character.preserveMorphs)
  const resetNodes = () => setNodes(character.preserveNodeTransforms)

  // A row still matching the base (inherited) reads muted-gray on a non-primary
  // scene — the "can be overridden, not yet" tell the other form fields carry
  // (identity dials, groom). Once the row itself differs it drops the mute and
  // takes the green override border instead. When a divergence has NO row to mark
  // green (the list is shorter because a row was deleted), the list still counts
  // as overridden, so the LABEL goes white + green handle on its own.
  const inheritedRow = (isOv: boolean) => overrideEligible && !isOv

  // items-start: the info row under a morph-name field makes the left column
  // two lines tall — the value + remove stay on the input line.
  const rowClass = 'mb-2 flex items-start gap-2'

  return (
    <MorphIndexProvider morphIndex={morphIndex} scenePath={scenePath}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-5">
          <div>
            <Label
              className={cn(
                'mb-2 flex w-fit items-center gap-2',
                overrideLabelClass(morphsOverridden, overrideEligible),
              )}
            >
              Preserve morphs after ROM loading
              {/* Handle only in override context — nothing to override on the primary. */}
              {overrideEligible && (
                <OverrideMark overridden={morphsOverridden} onReset={resetMorphs} />
              )}
            </Label>
            <KeyedListEditor
              items={morphs}
              onChange={setMorphs}
              newItem={() => ({ name: '', keepValue: 1, node: '' })}
              addLabel="Add morph"
              rowClassName={rowClass}
              emptyHint="No morphs to preserve yet."
            >
              {(item, set, index) => {
                const isOv = morphOverridden(index)
                return (
                  <>
                    <div className="min-w-0 flex-1">
                      <MorphNameCell
                        value={item.name}
                        inputClassName={cn(
                          MORPH_FIELD_CLASS,
                          inheritedRow(isOv) && 'text-muted-foreground',
                          isOv &&
                            'border-daz-green focus:border-daz-green focus-visible:ring-daz-green/50',
                        )}
                        onCommit={(name) => set({ ...item, name })}
                        // A pick takes the node along with the internal name — a
                        // clothing morph is only ever found under its own item,
                        // never on the figure root the empty scope searches.
                        onPick={(entry) => set({ ...item, name: entry.name, node: entry.node })}
                      />
                      <MorphNodeInfo
                        name={item.name}
                        node={item.node}
                        fallback="Figure"
                        fallbackTitle="Looked up on the figure itself — pick a suggestion to point it at the item the morph lives on"
                        scopedTitle={`Looked up on "${item.node}" (set by the picked suggestion)`}
                        muted={inheritedRow(isOv)}
                        onClear={() => set({ ...item, node: '' })}
                      />
                    </div>
                    <NumberField
                      className={cn(
                        'w-24 pr-6 text-right tabular-nums',
                        inheritedRow(isOv) && 'text-muted-foreground',
                      )}
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
            <Label
              className={cn(
                'mb-2 flex w-fit items-center gap-2',
                overrideLabelClass(nodesOverridden, overrideEligible),
              )}
            >
              Preserve node transforms
              {overrideEligible && (
                <OverrideMark overridden={nodesOverridden} onReset={resetNodes} />
              )}
            </Label>
            <KeyedListEditor
              items={nodes}
              onChange={setNodes}
              newItem={() => ({ nodeLabel: '' })}
              addLabel="Add node"
              rowClassName={rowClass}
              emptyHint="No node transforms yet."
            >
              {(item, set, index) => {
                const isOv = nodeOverridden(index)
                return (
                  <>
                    <Input
                      value={item.nodeLabel}
                      overridden={isOv}
                      className={cn(inheritedRow(isOv) && 'text-muted-foreground')}
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
