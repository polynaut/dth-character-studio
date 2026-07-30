import { cn, KeyedListEditor, Label, NumberField, OverrideMark, overrideLabelClass } from '@dth/ui'
import { MorphIndexProvider } from '#/components/rom/morph-index-provider.tsx'
import { MorphNameCell } from '#/components/rom/morph-name-cell.tsx'
import { frameZeroMorphsKey } from '#/lib/preserve-diff.ts'

import type { Character, SceneOverride } from '@dth/rom'
import type { MorphIndexEntry } from '#/lib/rom/api.ts'

// The morph-name field wears the ordinary form-input look (bordered, h-9) rather
// than MorphNameCell's default borderless table-cell style, matching PreserveFields.
const MORPH_FIELD_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none transition-[color,box-shadow] focus:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30'

/**
 * The "Add morphs on frame 0" list editor — morph name + the value it is set
 * (and keyed) to at frame 0 of the ROM. The generated script applies each row
 * on EVERY node of the figure tree that carries the morph, so one row like a
 * clothing "Expand All" reaches whichever outfit pieces the open scene wears;
 * a scene without the morph just skips it (Daz-log warning, deliberately no
 * studio-side validation).
 *
 * Per-scene overrides follow the PreserveFields model exactly: IMPLICIT and per
 * LIST — on a non-primary Daz scene the list starts inherited from the base and
 * the moment any row differs the whole list is overridden (ONE mark in the
 * label, reset reverting to the primary's list); a green border still marks
 * each differing row. `writeFrameZero` keeps the `frameZero` block present
 * exactly while the list differs (presence = armed).
 */
export function FrameZeroFields({
  character,
  patch,
  overrideEligible,
  sceneOverride,
  writeFrameZero,
  morphIndex,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** True while a non-primary Daz scene is selected — rows can then be overridden. */
  overrideEligible: boolean
  sceneOverride: SceneOverride | undefined
  /** Implicit-override writer for the frame-0 list (from useSceneSelection). */
  writeFrameZero: (next: NonNullable<SceneOverride['frameZero']>) => void
  /** The scanned morph index — powers the Morph-name autocomplete, same as ROM. */
  morphIndex: Array<MorphIndexEntry>
}) {
  // The active frame-0 override — armed by PRESENCE for this non-primary scene.
  const ov = overrideEligible ? sceneOverride?.frameZero : undefined
  const morphs = ov ?? character.frameZeroMorphs
  const setMorphs = (next: Character['frameZeroMorphs']) =>
    overrideEligible ? writeFrameZero(next) : patch({ frameZeroMorphs: next })

  // Rows are matched to the base by their natural key (morph name); a row differs
  // from the base when it's new/renamed or its value changed.
  const baseValue = new Map(character.frameZeroMorphs.map((m) => [m.name, m.value]))
  const morphOverridden = (i: number) => {
    if (!ov) return false
    const m = morphs[i]
    return !baseValue.has(m.name) || baseValue.get(m.name) !== m.value
  }
  // Whole-list divergence as a MULTISET (shared key with writeFrameZero), so the
  // reset handle shows exactly when the override is armed — including a deleted
  // row, which leaves no row to mark green.
  const listOverridden =
    !!ov && frameZeroMorphsKey(morphs) !== frameZeroMorphsKey(character.frameZeroMorphs)
  const resetList = () => setMorphs(character.frameZeroMorphs)

  // A row still matching the base (inherited) reads muted-gray on a non-primary
  // scene — the "can be overridden, not yet" tell the other form fields carry.
  const inheritedRow = (isOv: boolean) => overrideEligible && !isOv

  return (
    <MorphIndexProvider morphIndex={morphIndex}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <Label
            className={cn(
              'mb-2 flex w-fit items-center gap-2',
              overrideLabelClass(listOverridden, overrideEligible),
            )}
          >
            Morphs set at frame 0
            {/* Handle only in override context — nothing to override on the primary. */}
            {overrideEligible && <OverrideMark overridden={listOverridden} onReset={resetList} />}
          </Label>
          <KeyedListEditor
            items={morphs}
            onChange={setMorphs}
            newItem={() => ({ name: '', value: 1 })}
            addLabel="Add morph"
            rowClassName="mb-2 flex items-center gap-2"
            emptyHint="No morphs on frame 0 yet."
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
                      // Frame-0 morphs store only a name (the script applies it on
                      // every node that carries it), so a pick just takes the
                      // internal name.
                      onPick={(entry) => set({ ...item, name: entry.name })}
                    />
                  </div>
                  <NumberField
                    className={cn(
                      'w-24 pr-6 text-right tabular-nums',
                      inheritedRow(isOv) && 'text-muted-foreground',
                    )}
                    percent
                    overridden={isOv}
                    value={item.value}
                    onCommit={(value) => set({ ...item, value })}
                  />
                </>
              )
            }}
          </KeyedListEditor>
        </div>
      </div>
    </MorphIndexProvider>
  )
}
