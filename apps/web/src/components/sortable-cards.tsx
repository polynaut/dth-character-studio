import { DndContext, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

import type { DragEndEvent } from '@dnd-kit/core'
import type { ReactNode } from 'react'

import { cn } from '@dth/ui'

/**
 * Drag-to-reorder for a flex-wrap row of linked-asset cards (Daz scenes,
 * Houdini projects): wrap the row in {@link CardReorderContext} and each card
 * in a {@link SortableCard} keyed by the same id. A drop reports the reordered
 * id list — persisting it is the caller's business (the card lists render in
 * array order, so the array IS the order).
 *
 * Pointer-only like the pose tables' row drag (same 4px activation distance,
 * so plain clicks on the card never read as drags). Items OUTSIDE the id list
 * can sit in the same row untouched — the Daz primary card stays first and
 * simply isn't sortable.
 */
export function CardReorderContext({
  ids,
  onReorder,
  children,
}: {
  /** The sortable ids in their current order — one per SortableCard. */
  ids: Array<string>
  /** A drop landed somewhere new — `next` is the full reordered id list. */
  onReorder: (next: Array<string>) => void
  children: ReactNode
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  )
}

/**
 * One sortable card: positions itself while a drag is in flight and shows a
 * hover-revealed grip in the card's top-left corner (the one corner the card
 * shell leaves free — badge bottom-left, extra under the title, controls
 * bottom-right, selected check top-right). The grip is the ONLY drag activator:
 * the cards are dense with interactive children (rename title, path chip,
 * corner cluster), so a whole-card drag would fight every one of them.
 */
export function SortableCard({
  id,
  className,
  children,
}: {
  id: string
  className?: string
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group/sort relative', isDragging && 'z-20 opacity-70', className)}
    >
      {children}
      {/* Same hover-reveal + adornment recipe as the card's corner cluster
          (ghost at rest, solid #333 + white/20 edge on hover), so the grip
          reads as one of the card's own controls. z-10 lifts it above the
          card's transparent cover button. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        className="absolute top-1.5 left-2.5 z-10 flex size-6 cursor-grab items-center justify-center rounded-md border border-transparent text-muted-foreground opacity-0 transition-opacity group-hover/sort:opacity-100 focus-visible:opacity-100 hover:border-white/20 hover:bg-[#333] hover:text-foreground hover:shadow-sm active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
    </div>
  )
}
