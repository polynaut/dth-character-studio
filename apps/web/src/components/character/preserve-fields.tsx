import { cn, Input, KeyedListEditor, Label, OverrideMark, overrideLabelClass } from '@dth/ui'
import { preserveNodesKey } from '#/lib/preserve-diff.ts'

import type { Character, SceneOverride } from '@dth/rom'

/**
 * The "preserve across the ROM load" list editor from the character editor's
 * Advanced options — node transforms (node label), a homogeneous add/remove list
 * (`KeyedListEditor`). The companion "Preserve morphs after ROM loading" list
 * retired in schema v35 / runtime v83: the DTH release the studio targets holds
 * those morph values across the ROM itself.
 *
 * Per-scene overrides are IMPLICIT and PER-LIST (no toggle). On a non-primary Daz
 * scene the list starts inherited from the base and is editable inline; the moment
 * any row differs — a row added/removed/renamed — the whole list is overridden:
 * ONE mark in the label (like the other fields) that goes green with a reset
 * reverting the list to the primary. A green border still marks each differing
 * row. Rows are matched to the base by their natural identity (node label), so
 * reordering never mismarks them. `writePreserve` keeps the `preserve` block
 * present exactly while the list differs (presence = armed).
 */
export function PreserveFields({
  character,
  patch,
  overrideEligible,
  sceneOverride,
  writePreserve,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** True while a non-primary Daz scene is selected — rows can then be overridden. */
  overrideEligible: boolean
  sceneOverride: SceneOverride | undefined
  /** Implicit-override writer for the preserve list (from useSceneSelection). */
  writePreserve: (next: {
    nodeTransforms: NonNullable<SceneOverride['preserve']>['nodeTransforms']
  }) => void
}) {
  // The active preserve override — armed by PRESENCE for this non-primary scene.
  const ov = overrideEligible ? sceneOverride?.preserve : undefined
  const nodes = ov ? ov.nodeTransforms : character.preserveNodeTransforms
  const setNodes = (next: Character['preserveNodeTransforms']) =>
    overrideEligible ? writePreserve({ nodeTransforms: next }) : patch({ preserveNodeTransforms: next })

  // Rows are matched to the base by their natural key (node label); a row differs
  // from the base when it's new or renamed.
  const baseNodeLabels = new Set(character.preserveNodeTransforms.map((n) => n.nodeLabel))
  const nodeOverridden = (i: number) => !!ov && !baseNodeLabels.has(nodes[i].nodeLabel)
  // The override is per LIST, not per row: one control in the label (like the other
  // fields), green once the whole list differs from the base — a row changed, or one
  // was added/removed. Reset reverts the list to the primary scene's; the per-row
  // green border still marks which rows differ.
  // Whole-list divergence is compared as a MULTISET (via the shared preserve-diff
  // key), the SAME test `writePreserve` uses to arm the gate — so the reset handle
  // shows exactly when the override is armed, including the duplicate-key case a set
  // compare would miss (base [Head,Neck] → [Head,Head]).
  const nodesOverridden =
    !!ov && preserveNodesKey(nodes) !== preserveNodesKey(character.preserveNodeTransforms)
  const resetNodes = () => setNodes(character.preserveNodeTransforms)

  // A row still matching the base (inherited) reads muted-gray on a non-primary
  // scene — the "can be overridden, not yet" tell the other form fields carry
  // (identity dials, groom). Once the row itself differs it drops the mute and
  // takes the green override border instead. When a divergence has NO row to mark
  // green (the list is shorter because a row was deleted), the list still counts
  // as overridden, so the LABEL goes white + green handle on its own.
  const inheritedRow = (isOv: boolean) => overrideEligible && !isOv

  // One list of the Advanced options panel — the ROUTE owns the layout.
  return (
    <div>
      <Label
        className={cn(
          'mb-2 flex w-fit items-center gap-2',
          overrideLabelClass(nodesOverridden, overrideEligible),
        )}
      >
        Preserve node transforms
        {/* Handle only in override context — nothing to override on the primary. */}
        {overrideEligible && <OverrideMark overridden={nodesOverridden} onReset={resetNodes} />}
      </Label>
      <KeyedListEditor
        items={nodes}
        onChange={setNodes}
        newItem={() => ({ nodeLabel: '' })}
        addLabel="Add node"
        rowClassName="mb-2 flex items-start gap-2"
        emptyHint="No node transforms yet."
      >
        {(item, set, index) => {
          const isOv = nodeOverridden(index)
          return (
            <Input
              value={item.nodeLabel}
              overridden={isOv}
              className={cn(inheritedRow(isOv) && 'text-muted-foreground')}
              onChange={(e) => set({ nodeLabel: e.target.value })}
            />
          )
        }}
      </KeyedListEditor>
    </div>
  )
}
