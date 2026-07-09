import { useState } from 'react'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createColumnHelper, flexRender } from '@tanstack/react-table'
import { ChevronDown, ChevronRight, FolderOpen, GripVertical, Plus, Trash2 } from 'lucide-react'

import { pickFbxPath } from '#/lib/desktop.ts'

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

export interface PoseTableMeta {
  startFrame: number
  /** Absolute frames whose morphs failed in the last ROM run — rows marked red. */
  failedFrames?: Set<number>
  showReferenceFbx: boolean
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
    cell: ({ getValue, row, table }) => (
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
        onCommit={(name) => (table.options.meta as PoseTableMeta).update(row.index, { name })}
      />
    ),
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
          <code>DthScanFrames</code> CSV.
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
  columnHelper.accessor('referenceFbx', {
    id: 'referenceFbx',
    header: 'Reference FBX',
    cell: ({ getValue, row, table }) => (
      <div className="flex items-center gap-1">
        <TextCell
          value={getValue()}
          placeholder="optional .fbx path"
          onCommit={(referenceFbx) =>
            (table.options.meta as PoseTableMeta).update(row.index, { referenceFbx })
          }
        />
        <button
          type="button"
          className="flex shrink-0 items-center px-1 text-muted-foreground/60 hover:text-foreground"
          title="Pick the reference FBX with a file dialog"
          onClick={async () => {
            const path = await pickFbxPath()
            if (path) (table.options.meta as PoseTableMeta).update(row.index, { referenceFbx: path })
          }}
        >
          <FolderOpen className="size-3.5" />
        </button>
      </div>
    ),
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
    cell: ({ row, table }) => (
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        title="Remove pose"
        onClick={() => (table.options.meta as PoseTableMeta).remove(row.index)}
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    ),
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
  return (
    <>
      <tr
        ref={setNodeRef}
        id={failed ? `dth-rom-frame-${absFrame}` : undefined}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        title={failed ? 'This morph failed in the last ROM run — see the report above' : undefined}
        className={`border-b last:border-b-0 ${
          failed ? 'bg-destructive/15 hover:bg-destructive/25' : 'hover:bg-muted/30'
        } ${isDragging ? 'relative z-10 bg-muted/50 opacity-70' : ''}`}
      >
        <td className="px-1 py-0.5">
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
        <tr className="border-b bg-muted/20">
          <td />
          <td colSpan={visibleCells.length} className="px-2 py-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <span className="w-5 text-right">#</span>
                <span className="w-44 px-2" title="The scene node the morph lives on (Genesis9, GoldenPalace_G9, a bone, …)">
                  Node
                </span>
                <span className="flex-1 px-2" title="The internal property name of the Daz morph">
                  Property
                </span>
                <span className="w-20 px-2 text-right" title="The value the pose dials the morph to">
                  Value
                </span>
                <span
                  className="w-16 px-2 text-right"
                  title="The value the sawtooth returns to on the frames around the pose (default 0) — for morphs already dialed in as part of the base shape"
                >
                  Base
                </span>
                <span
                  className="w-14 text-center"
                  title="Resolve the base from the morph's current scene value at apply time"
                >
                  Auto
                </span>
                <span className="w-6" />
              </div>
              {pose.morphs.map((morph, morphIndex) => (
                <div key={morphIndex} className="flex items-center gap-2">
                  <span className="w-5 text-right text-xs text-muted-foreground tabular-nums">
                    {morphIndex + 1}.
                  </span>
                  <div className="w-44">
                    <TextCell
                      value={morph.node}
                      placeholder={meta.figureNode}
                      onCommit={(node) => meta.updateMorphAt(row.index, morphIndex, { node })}
                    />
                  </div>
                  <div className="flex-1">
                    <MorphNameCell
                      value={morph.prop}
                      placeholder="body_bs_BodyTone"
                      onCommit={(prop) => meta.updateMorphAt(row.index, morphIndex, { prop })}
                      onPick={(e) =>
                        meta.updateMorphAt(row.index, morphIndex, { prop: e.name, node: e.node })
                      }
                    />
                  </div>
                  <NumberCell
                    value={morph.value}
                    onCommit={(value) => meta.updateMorphAt(row.index, morphIndex, { value })}
                  />
                  <OptionalNumberCell
                    value={morph.base}
                    placeholder="0"
                    disabled={morph.autoBase === true}
                    onCommit={(base) => meta.updateMorphAt(row.index, morphIndex, { base })}
                  />
                  <span className="flex w-14 justify-center">
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
                  </span>
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
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-1 h-7 text-xs"
              onClick={() => meta.addMorph(row.index)}
            >
              <Plus className="size-3.5" /> Add morph
            </Button>
          </td>
        </tr>
      )}
    </>
  )
}
