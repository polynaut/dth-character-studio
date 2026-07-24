import { useState } from 'react'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createColumnHelper, flexRender } from '@tanstack/react-table'
import { ChevronDown, ChevronRight, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'

import type { Row } from '@tanstack/react-table'

import { Button, InfoPopup } from '@dth/ui'
import { sanitizePoseName } from '@dth/rom'

import type { ColumnDef } from '@tanstack/react-table'
import type { RomPose } from '@dth/rom'

import { NumberCell, OptionalNumberCell, TextCell } from './cells.tsx'
import { MorphNameCell } from './morph-name-cell.tsx'

export interface MorphPatch {
  node?: string
  prop?: string
  value?: number
  base?: number | undefined
  autoBase?: boolean | undefined
}

/**
 * Scene-override mode state for the table (a non-primary Daz scene is selected, and
 * this section is NOT yet whole-overridden). Two row kinds, told apart by id:
 * a BASE ROM row (editable — editing one arms a per-scene value override, so it
 * turns green and can be reset) and the override's OWN appended frame ({@link
 * isAddition} — green, removable). Reorder / insert-between / deleting a base row are
 * structural edits the sparse layer can't hold, so they ESCALATE the whole section
 * to a scene override (handled a layer up); once escalated the section edits like the
 * primary and this meta is absent.
 */
export interface PoseOverrideMeta {
  /** A base ROM row the user value-edited for this scene (green, resettable). */
  isOverridden: (poseId: string) => boolean
  /** An override's own appended frame — green, freely removable (not base ROM). */
  isAddition: (poseId: string) => boolean
  /** Reset a base row: drop its value override, falling back to the base ROM frame. */
  reset: (poseId: string) => void
}

export interface PoseTableMeta {
  startFrame: number
  /** Absolute frames whose morphs failed in the last ROM run — rows marked red. */
  failedFrames?: Set<number>
  showBoneScale: boolean
  expandedIds: Set<string>
  toggleExpanded: (poseId: string) => void
  update: (rowIndex: number, patch: Partial<RomPose>) => void
  updateMorphAt: (rowIndex: number, morphIndex: number, patch: MorphPatch) => void
  addMorph: (rowIndex: number) => void
  removeMorphAt: (rowIndex: number, morphIndex: number) => void
  remove: (rowIndex: number) => void
  /** Insert an empty pose at this index (frames renumber — they're never stored). */
  insertAt: (index: number) => void
  /** Default scene node for new entries — the generation's unrenamed base figure. */
  figureNode: string
  /** Set = the grid is in scene-override mode (see {@link PoseOverrideMeta}). */
  override?: PoseOverrideMeta
  /** Scene-override structural lock threaded down from the group card (which disables
   *  the base-structure buttons in override mode). Vestigial here — the table body no
   *  longer reads it (the old Override checkbox column it gated is gone). */
  locked?: boolean
}

/**
 * The small "+" behind each frame number — opens a two-item menu right at the
 * icon to insert an empty pose before/after this row. Frame numbers are computed
 * from order, so the rest of the list simply renumbers.
 */
function InsertFrameMenu({ onBefore, onAfter }: { onBefore: () => void; onAfter: () => void }) {
  const [open, setOpen] = useState(false)
  function pick(action: () => void) {
    setOpen(false)
    action()
  }
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title="Insert a frame here"
        aria-label="Insert a frame here"
        className="rounded p-0.5 text-muted-foreground/50 hover:bg-muted hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <Plus className="size-3" />
      </button>
      {open && (
        <>
          {/* Click-away layer — any click outside the menu closes it. */}
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute top-1/2 left-full z-30 ml-1 w-28 -translate-y-1/2 rounded-md border bg-background p-1 shadow-md">
            <button
              type="button"
              className="block w-full rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => pick(onBefore)}
            >
              Add before
            </button>
            <button
              type="button"
              className="block w-full rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => pick(onAfter)}
            >
              Add after
            </button>
          </div>
        </>
      )}
    </span>
  )
}

const columnHelper = createColumnHelper<RomPose>()

export const poseColumns: Array<ColumnDef<RomPose, any>> = [
  columnHelper.display({
    id: 'frame',
    header: 'Frame',
    cell: ({ row, table }) => {
      const meta = table.options.meta as PoseTableMeta
      return (
        <span className="flex items-center">
          <span className="pr-1 pl-2 text-sm text-muted-foreground tabular-nums">
            {meta.startFrame + row.index}
          </span>
          {/* Insert an empty frame here — on a non-primary scene this escalates the
              section to a scene override (the section title's Reset brings it back). */}
          <InsertFrameMenu
            onBefore={() => meta.insertAt(row.index)}
            onAfter={() => meta.insertAt(row.index + 1)}
          />
        </span>
      )
    },
  }),
  columnHelper.accessor('name', {
    header: () => (
      <span className="flex items-center gap-1">
        Name
        <InfoPopup label="Name — more information" className="-my-1">
          The generated morph's name in <strong>Houdini</strong> and later{' '}
          <strong>Unreal Engine</strong> — the one value that travels the whole pipeline.
          Letters, numbers and underscores only — Houdini accepts nothing else. The
          group's Left/Right suffix is appended for you (<code>_l</code>/<code>_r</code>).
        </InfoPopup>
      </span>
    ),
    cell: ({ getValue, row, table }) => {
      const meta = table.options.meta as PoseTableMeta
      const field = (
        <TextCell
          value={getValue()}
          placeholder="e.g. BodyTone"
          dataId={row.original.id}
          // Houdini only accepts [A-Za-z0-9_] — flag anything else instead of
          // silently rewriting what the user typed (same rule the generator's
          // sanitizePoseName enforces on the CSV).
          validate={(v) =>
            v !== sanitizePoseName(v)
              ? 'Only letters, numbers and underscores — Houdini rejects anything else.'
              : ''
          }
          onCommit={(name) => meta.update(row.index, { name })}
        />
      )
      // Reserve a small slot before EVERY name (all scenes) so switching to a
      // non-primary scene never shifts the grid in X. An override's OWN appended
      // frame (isAddition — new relative to the primary scene) fills it with a green
      // "*"; every other row keeps it empty. mt-1.5 optically drops the top-heavy
      // glyph so it reads centred against the name text.
      const isNew = meta.override?.isAddition(row.original.id) === true
      return (
        <span className="flex items-center">
          <span
            className={`w-3 shrink-0 text-center text-base leading-none font-bold text-daz-green ${isNew ? 'mt-1.5' : ''}`}
            title={isNew ? "New frame for this scene — not in the primary scene's ROM" : undefined}
          >
            {isNew ? '*' : ''}
          </span>
          <span className="min-w-0 flex-1">{field}</span>
        </span>
      )
    },
  }),
  // The node a morph lives on (Genesis9, GoldenPalace_G9, bone nodes, …) is
  // edited in the morphs expansion — it is constant for typical pose lists.
  columnHelper.accessor((pose) => pose.morphs[0]?.prop ?? '', {
    id: 'prop',
    header: () => (
      <span className="flex items-center gap-1">
        Morph name
        <InfoPopup label="Morph name — more information" className="-my-1">
          <strong>Must exactly match the morph's internal name in Daz Studio</strong>{' '}
          (e.g. <code>body_bs_BodyTone</code>) — that's how the ROM script finds and
          dials it; a mismatch fails on that frame. See the guide for how to look the
          internal name up in Daz, or import the exact names from a{' '}
          <code>Scan_Frames</code> CSV.
        </InfoPopup>
      </span>
    ),
    cell: ({ getValue, row, table }) =>
      row.original.morphs.length > 1 ? (
        <span className="px-2 text-sm text-muted-foreground italic">
          {row.original.morphs.length} morphs combined
        </span>
      ) : (
        <MorphNameCell
          value={getValue()}
          placeholder="body_bs_BodyTone"
          onCommit={(prop) =>
            (table.options.meta as PoseTableMeta).updateMorphAt(row.index, 0, { prop })
          }
          // Picking from the index also selects the node the morph lives on.
          onPick={(e) =>
            (table.options.meta as PoseTableMeta).updateMorphAt(row.index, 0, {
              prop: e.name,
              node: e.node,
            })
          }
        />
      ),
  }),
  columnHelper.accessor((pose) => pose.morphs[0]?.value ?? 1, {
    id: 'value',
    // Mirror the NumberCell geometry (w-20 box, right-aligned digits, pr-5 "%"
    // gutter) so the title sits flush over the numbers instead of floating at
    // the column's left edge.
    header: () => <span className="block w-20 pr-5 text-right">Value</span>,
    cell: ({ getValue, row, table }) =>
      row.original.morphs.length > 1 ? null : (
        <NumberCell
          value={getValue()}
          onCommit={(value) =>
            (table.options.meta as PoseTableMeta).updateMorphAt(row.index, 0, { value })
          }
        />
      ),
  }),
  columnHelper.accessor('boneScaleRef', {
    id: 'boneScaleRef',
    // Center the title (+ its "i") over the column: the cell centers its checkbox,
    // so a left-aligned header floated off to the side of it (same idea as the
    // Value header mirroring the NumberCell).
    header: () => (
      <span className="flex items-center justify-center gap-1">
        Bone scale
        <InfoPopup label="Bone scale — more information">
          Turn this on for a morph that scales <strong>bones</strong> (e.g. Torso Length,
          Proportion Height). Unreal can't drive bone scale from a morph alone, so when an
          export directory is set the DTH Exporter writes a per-frame{' '}
          <strong>reference-skeleton FBX</strong> for the frame and the studio fills its path
          into the PoseAsset CSV automatically. With no export directory it's simply a no-op —
          nothing exports, so you handle the reference skeletons yourself.
        </InfoPopup>
      </span>
    ),
    cell: ({ getValue, row, table }) => {
      const meta = table.options.meta as PoseTableMeta
      // Match the row: an overridden row (a value-edited base frame or the override's
      // own appended frame) reads green, so its active checkbox is green too — not the
      // primary orange (same `overridden` test as SortablePoseRow).
      const override = meta.override
      const overridden =
        override !== undefined &&
        (override.isAddition(row.original.id) || override.isOverridden(row.original.id))
      return (
        <span className="flex justify-center">
          <input
            type="checkbox"
            className={`size-3.5 ${overridden ? 'accent-daz-green' : 'accent-primary'}`}
            title="This morph scales bones — export a reference-skeleton FBX for it"
            checked={getValue()}
            onChange={(e) => meta.update(row.index, { boneScaleRef: e.target.checked })}
          />
        </span>
      )
    },
  }),
  columnHelper.display({
    id: 'expand',
    header: '',
    cell: ({ row, table }) => {
      const meta = table.options.meta as PoseTableMeta
      const expanded = meta.expandedIds.has(row.original.id)
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          title="Combine multiple Daz morphs into this single generated morph"
          onClick={() => meta.toggleExpanded(row.original.id)}
        >
          {row.original.morphs.length > 1 ? `${row.original.morphs.length} morphs` : 'morphs'}
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        </Button>
      )
    },
  }),
  columnHelper.display({
    id: 'actions',
    header: '',
    cell: ({ row, table }) => {
      const meta = table.options.meta as PoseTableMeta
      const override = meta.override
      const id = row.original.id
      const isAddition = override?.isAddition(id) === true
      // The green reset handle: an edited base row resets its value override back to
      // the base ROM; an added frame (no base to fall back to) is simply removed. Its
      // footprint is ALWAYS reserved — an invisible placeholder when there's nothing
      // to reset — so the actions column, and the whole grid, never shifts between
      // scenes or when a row becomes overridden. The bin is always shown (an added
      // frame keeps it for consistency, even though it too just removes the row).
      const showReset = isAddition || override?.isOverridden(id) === true
      return (
        <span className="flex items-center justify-end gap-0.5">
          {showReset ? (
            <Button
              variant="ghost"
              size="icon"
              // Green reset glyph that turns white on hover over a button silhouette.
              // The reset only ever shows on a green (overridden) row, where the plain
              // ghost accent hover washes out — so use a foreground overlay that stays
              // visible there. The icon inherits the button's text colour (currentColor).
              className="size-7 text-daz-green hover:bg-foreground/15 hover:text-white dark:hover:bg-foreground/15"
              title={
                isAddition
                  ? 'Reset this added frame — removes it (not in the primary scene)'
                  : 'Reset this frame to the base ROM'
              }
              onClick={() => (isAddition ? meta.remove(row.index) : override?.reset(id))}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          ) : (
            // Reserve the reset button's footprint so nothing shifts when it appears.
            <span className="size-7 shrink-0" aria-hidden />
          )}
          <Button
            variant="ghost"
            size="icon"
            // Gray at rest, red on hover (the delete-danger cue) over the SAME button
            // silhouette as the reset (visible on the green overridden row too). No
            // tooltip — the icon reads on its own; an aria-label keeps it accessible.
            className="size-7 text-muted-foreground hover:bg-foreground/15 hover:text-destructive dark:hover:bg-foreground/15"
            aria-label={
              isAddition
                ? 'Delete this added frame for this scene'
                : override
                  ? 'Delete this frame for this scene'
                  : 'Remove pose'
            }
            onClick={() => meta.remove(row.index)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </span>
      )
    },
  }),
]

export function SortablePoseRow({
  row,
  expanded,
  meta,
}: {
  row: Row<RomPose>
  expanded: boolean
  meta: PoseTableMeta
}) {
  const pose = row.original
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pose.id,
  })
  const visibleCells = row.getVisibleCells()
  // Marked red when this pose's frame failed in the last ROM run (see the
  // run report at the top of the page).
  const absFrame = meta.startFrame + row.index
  const failed = meta.failedFrames?.has(absFrame) === true
  // Scene-override mode (section not yet whole-owned): a row reads green when it's
  // the override's own added frame, or a base row the user has value-edited. Base
  // rows not yet overridden stay normal and editable — edit one to override it.
  const override = meta.override
  const overridden =
    override !== undefined &&
    (override.isAddition(row.original.id) || override.isOverridden(row.original.id))
  return (
    <>
      <tr
        ref={setNodeRef}
        id={failed ? `dth-rom-frame-${absFrame}` : undefined}
        data-pose-id={row.original.id}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        title={failed ? 'This morph failed in the last ROM run — see the report above' : undefined}
        className={`border-b last:border-b-0 ${
          failed
            ? 'bg-destructive/15 hover:bg-destructive/25'
            : overridden
              ? 'bg-[color-mix(in_oklab,var(--color-daz-green)_11%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-daz-green)_16%,transparent)]'
              : 'hover:bg-muted/30'
        } ${isDragging ? 'relative z-10 bg-muted/50 opacity-70' : ''}`}
      >
        <td className="px-1 py-0.5">
          {/* Drag to reorder. On a non-primary scene a reorder is a structural change
              the sparse layer can't hold, so dropping escalates the whole section to a
              scene override (its title's Reset control brings it back to the primary). */}
          <button
            type="button"
            className="flex cursor-grab items-center px-1 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
            title="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
          </button>
        </td>
        {visibleCells.map((cell) => (
          <td key={cell.id} className="px-1 py-0.5">
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>
      {expanded && (
        // The multi-morph editor renders as REAL table rows sharing the parent grid's
        // columns, so its sub-columns line up under the main ones: drag→(blank),
        // Frame→#, Name→Node, Morph name→Property, Value→Value, Bone scale→Base,
        // morphs→Auto, actions→(remove). (A colSpan block with its own widths couldn't
        // align to the auto-sized table columns.)
        <>
          <tr className="bg-muted/20 text-xs font-medium text-muted-foreground">
            <td />
            <td className="px-1 py-1 text-right">#</td>
            <td className="px-1 py-1" title="The scene node the morph lives on (Genesis9, GoldenPalace_G9, a bone, …)">
              Node
            </td>
            <td className="px-1 py-1" title="The internal property name of the Daz morph">
              Property
            </td>
            <td className="px-1 py-1 text-right" title="The value the pose dials the morph to">
              Value
            </td>
            <td
              className="px-1 py-1 text-right"
              title="The value the sawtooth returns to on the frames around the pose (default 0) — for morphs already dialed in as part of the base shape"
            >
              Base
            </td>
            <td
              className="px-1 py-1 text-center"
              title="Resolve the base from the morph's current scene value at apply time"
            >
              Auto
            </td>
            <td />
          </tr>
          {pose.morphs.map((morph, morphIndex) => (
            <tr key={morph.id} className="bg-muted/20">
              <td />
              <td className="px-1 py-0.5 text-right text-xs text-muted-foreground tabular-nums">
                {morphIndex + 1}.
              </td>
              <td className="px-1 py-0.5">
                <TextCell
                  value={morph.node}
                  placeholder={meta.figureNode}
                  onCommit={(node) => meta.updateMorphAt(row.index, morphIndex, { node })}
                />
              </td>
              <td className="px-1 py-0.5">
                <MorphNameCell
                  value={morph.prop}
                  placeholder="body_bs_BodyTone"
                  onCommit={(prop) => meta.updateMorphAt(row.index, morphIndex, { prop })}
                  onPick={(e) =>
                    meta.updateMorphAt(row.index, morphIndex, { prop: e.name, node: e.node })
                  }
                />
              </td>
              <td className="px-1 py-0.5 text-right">
                <NumberCell
                  value={morph.value}
                  onCommit={(value) => meta.updateMorphAt(row.index, morphIndex, { value })}
                />
              </td>
              <td className="px-1 py-0.5 text-right">
                <OptionalNumberCell
                  value={morph.base}
                  placeholder="0"
                  disabled={morph.autoBase === true}
                  onCommit={(base) => meta.updateMorphAt(row.index, morphIndex, { base })}
                />
              </td>
              <td className="px-1 py-0.5 text-center">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  title="Resolve the base from the morph's current scene value at apply time"
                  checked={morph.autoBase === true}
                  onChange={(e) =>
                    meta.updateMorphAt(row.index, morphIndex, {
                      autoBase: e.target.checked ? true : undefined,
                    })
                  }
                />
              </td>
              <td className="px-1 py-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  title="Remove this morph"
                  disabled={pose.morphs.length <= 1}
                  onClick={() => meta.removeMorphAt(row.index, morphIndex)}
                >
                  <Trash2 className="size-3 text-destructive" />
                </Button>
              </td>
            </tr>
          ))}
          <tr className="border-b bg-muted/20">
            <td />
            <td />
            <td colSpan={visibleCells.length - 1} className="px-1 py-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => meta.addMorph(row.index)}
              >
                <Plus className="size-3.5" /> Add morph
              </Button>
            </td>
          </tr>
        </>
      )}
    </>
  )
}
