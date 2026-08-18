import { createContext, useContext } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'

import type { DragEndEvent } from '@dnd-kit/core'
import type { ReactNode } from 'react'

import { cn } from '@dth/ui'

/**
 * Is there anything to reorder AGAINST? One card cannot be dragged anywhere, so
 * its grip would be a control that does nothing — the shape this codebase
 * refuses elsewhere (a live-looking ✕ beside a properly disabled Cancel). The
 * context lets {@link SortableCard} answer that without every caller counting
 * its own list. `false` outside a provider: a card that is not in a reorder
 * context is not sortable.
 */
const SortableEnabled = createContext(false)

/**
 * Drag-to-reorder for a flex-wrap row of linked-asset cards (Daz scenes,
 * Houdini projects): wrap the row in {@link CardReorderContext} and each card
 * in a {@link SortableCard} keyed by the same id. A drop reports the reordered
 * id list — persisting it is the caller's business (the card lists render in
 * array order, so the array IS the order).
 *
 * Pointer + keyboard. The 4px activation distance is the pose tables' recipe,
 * so plain clicks on the card never read as drags. The KeyboardSensor is not
 * optional politeness: `useSortable`'s attributes announce the grip as
 * `aria-roledescription="sortable"` and point `aria-describedby` at dnd-kit's
 * own "press the space bar to pick up" instructions, which DndContext renders
 * into the DOM — register no KeyboardSensor and that instruction is a lie the
 * component tells every screen-reader user.
 *
 * Items OUTSIDE the id list can sit in the same row untouched — the Daz primary
 * card stays first and simply isn't sortable.
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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
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
        <SortableEnabled.Provider value={ids.length > 1}>{children}</SortableEnabled.Provider>
      </SortableContext>
    </DndContext>
  )
}

/**
 * One sortable card: positions itself while a drag is in flight and shows a
 * hover-revealed grip in the card's top-left corner — the one corner the
 * LinkedAssetCard shell leaves free (badge bottom-left, extra under the title,
 * controls bottom-right, selected check top-right). A card that is NOT that
 * shell has to say where its own free space is: pass `gripClass`.
 *
 * The grip is the ONLY drag activator: the cards are dense with interactive
 * children (rename title, path chip, corner cluster), so a whole-card drag
 * would fight every one of them.
 *
 * With nothing to reorder against (a single card) there is no grip at all and
 * the sortable is disabled — see {@link SortableEnabled}.
 */
export function SortableCard({
  id,
  className,
  gripClass,
  children,
}: {
  id: string
  className?: string
  /** Move the grip for a card whose top-left corner is NOT free. Merged over
   *  the default placement (tailwind-merge, so `top-*`/`drop-shadow-*` and
   *  friends replace rather than stack). */
  gripClass?: string
  children: ReactNode
}) {
  const sortable = useContext(SortableEnabled)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('group/sort relative', isDragging && 'z-20 opacity-70', className)}
    >
      {children}
      {/* Hover-revealed like the card's corner cluster, but a bare glyph, not
          a button: it highlights (text brightens) rather than growing a border
          and fill — a grip is a handle, not an action. z-10 lifts it above the
          card's transparent cover button. */}
      {sortable && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          title="Drag to reorder"
          aria-label="Drag to reorder"
          className={cn(
            'absolute top-1.5 left-2.5 z-10 flex size-6 cursor-grab items-center justify-center text-muted-foreground opacity-0 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition-opacity group-hover/sort:opacity-100 focus-visible:opacity-100 hover:text-foreground active:cursor-grabbing',
            gripClass,
          )}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
    </div>
  )
}
