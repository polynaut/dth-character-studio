import { memo, useCallback, useEffect, useRef, useState } from 'react'

import { createPortal } from 'react-dom'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { GripVertical } from 'lucide-react'

import type { CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'

import { flatSectionGroupId, mirrorGroup } from '@dth/rom'

import type { Gender, RomGroup, RomPose, RomSection } from '@dth/rom'

import { GroupCard } from './group-card.tsx'

import type { SectionOverrideCtl } from './group-card.tsx'

export type { SectionOverrideCtl } from './group-card.tsx'

/**
 * Cross-group drag-and-drop for a section's pose groups: one DndContext spans
 * every group so a morph (pose) can be dragged *between* groups, not just
 * reordered within one. The move resolves on drag end — dropped onto a pose it
 * inserts at that position; dropped on an empty group's body it appends. Also
 * used for the flat FBM/MISC list (a single group → reorder only). In scene-
 * override mode the drag handles disappear (GroupCard/pose-table), so no drag
 * can start — the base order is fixed there.
 *
 * Memoized, with all GroupCard callbacks identity-stable (latest-ref + id
 * routing): editing one section must not re-render every other section's
 * tables, and a page-level render (modifier keys, polling) must not re-render
 * any of them. `onGroupsChange` reports the SECTION alongside the groups, so
 * the parent can hand every section the same stable handler.
 */
export const PoseGroupsEditor = memo(function PoseGroupsEditor({
  section,
  groups,
  gender,
  startFrames,
  failedFrames,
  removable,
  override,
  onGroupsChange,
}: {
  section: RomSection
  groups: Array<RomGroup>
  gender: Gender
  startFrames: Map<string, number>
  failedFrames?: Set<number>
  removable: boolean
  override?: SectionOverrideCtl
  onGroupsChange: (section: RomSection, groups: Array<RomGroup>) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [activePose, setActivePose] = useState<RomPose | null>(null)
  // While dragging we work on a local copy so the groups "make space" live as a
  // pose moves between them, without rewriting the character on every frame —
  // the result is committed once on drop.
  const [dragGroups, setDragGroups] = useState<Array<RomGroup> | null>(null)
  const display = dragGroups ?? groups
  // Hold the resolved drop target for the frame right after a pose hops into a
  // new group, so collision detection doesn't bounce it back at the boundary.
  const lastOverId = useRef<string | null>(null)
  const justMoved = useRef(false)
  useEffect(() => {
    requestAnimationFrame(() => {
      justMoved.current = false
    })
  }, [display])

  // Latest-ref: the stable id-routing callbacks below always see the CURRENT
  // groups/section/onGroupsChange while keeping ONE identity for GroupCard memo.
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const sectionRef = useRef(section)
  sectionRef.current = section
  const emitRef = useRef(onGroupsChange)
  emitRef.current = onGroupsChange
  const emitGroups = useCallback((next: Array<RomGroup>) => {
    emitRef.current(sectionRef.current, next)
  }, [])
  const changeGroup = useCallback(
    (groupId: string, updated: RomGroup) => {
      emitGroups(groupsRef.current.map((g) => (g.id === groupId ? updated : g)))
    },
    [emitGroups],
  )
  const removeGroup = useCallback(
    (groupId: string) => {
      emitGroups(groupsRef.current.filter((g) => g.id !== groupId))
    },
    [emitGroups],
  )
  const mirrorGroupAfter = useCallback(
    (groupId: string) => {
      const list = groupsRef.current
      const i = list.findIndex((g) => g.id === groupId)
      if (i < 0) return
      emitGroups([...list.slice(0, i + 1), mirrorGroup(list[i]), ...list.slice(i + 1)])
    },
    [emitGroups],
  )

  const toggleExpanded = useCallback(
    (poseId: string) =>
      setExpandedIds((ids) => {
        const next = new Set(ids)
        if (next.has(poseId)) next.delete(poseId)
        else next.add(poseId)
        return next
      }),
    [],
  )

  // The group index owning a draggable id within `list`: a pose id (search each
  // group's poses) or a group's own id (its container droppable).
  function groupIndexOf(list: Array<RomGroup>, id: string): number {
    const asContainer = list.findIndex((g) => g.id === id)
    if (asContainer >= 0) return asContainer
    return list.findIndex((g) => g.poses.some((p) => p.id === id))
  }

  // Pointer-first detection that drills from a hovered group into its closest
  // pose, and holds the last target across the reflow after a cross-group hop —
  // the dnd-kit "multiple containers" recipe, which stops boundary flicker.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointer = pointerWithin(args)
      const hits = pointer.length > 0 ? pointer : rectIntersection(args)
      let overId = getFirstCollision(hits, 'id')
      if (overId != null) {
        const overGroup = display.find((g) => g.id === String(overId))
        if (overGroup && overGroup.poses.length > 0) {
          const ids = new Set(overGroup.poses.map((p) => p.id))
          const inner = closestCorners({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (c) => c.id !== overId && ids.has(String(c.id)),
            ),
          })
          overId = getFirstCollision(inner, 'id') ?? overId
        }
        lastOverId.current = String(overId)
        return [{ id: overId }]
      }
      if (justMoved.current && activePose) lastOverId.current = activePose.id
      return lastOverId.current ? [{ id: lastOverId.current }] : []
    },
    [display, activePose],
  )

  function handleDragStart(event: DragStartEvent) {
    setExpandedIds(new Set()) // a tall expanded row makes a clumsy drag
    const id = String(event.active.id)
    setActivePose(groups.flatMap((g) => g.poses).find((p) => p.id === id) ?? null)
    setDragGroups(groups)
  }

  // Live cross-group move: pull the dragged pose into the hovered group so both
  // groups animate (the source closes up, the target opens a slot). Same-group
  // hovering is left to the sortable strategy; the exact slot settles on drop.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    setDragGroups((prev) => {
      const list = prev ?? groups
      const from = groupIndexOf(list, activeId)
      const to = groupIndexOf(list, overId)
      if (from < 0 || to < 0 || from === to) return list
      const fromPoses = list[from].poses
      const toPoses = list[to].poses
      const activeIndex = fromPoses.findIndex((p) => p.id === activeId)
      if (activeIndex < 0) return list
      const moved = fromPoses[activeIndex]
      const overIndex =
        list[to].id === overId ? toPoses.length : toPoses.findIndex((p) => p.id === overId)
      const insertAt = overIndex < 0 ? toPoses.length : overIndex
      justMoved.current = true
      return list.map((g, i) => {
        if (i === from) return { ...g, poses: fromPoses.filter((_, idx) => idx !== activeIndex) }
        if (i === to) {
          const next = [...toPoses]
          next.splice(insertAt, 0, moved)
          return { ...g, poses: next }
        }
        return g
      })
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const list = dragGroups ?? groups
    let result = list
    if (over) {
      const activeId = String(active.id)
      const overId = String(over.id)
      const idx = groupIndexOf(list, activeId)
      // The cross-group hop already happened in onDragOver; settle the exact
      // position within the resolved group.
      if (idx >= 0 && groupIndexOf(list, overId) === idx && activeId !== overId) {
        const poses = list[idx].poses
        const oldIndex = poses.findIndex((p) => p.id === activeId)
        const newIndex = poses.findIndex((p) => p.id === overId)
        if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
          result = list.map((g, i) =>
            i === idx ? { ...g, poses: arrayMove(poses, oldIndex, newIndex) } : g,
          )
        }
      }
    }
    emitGroups(result)
    setDragGroups(null)
    setActivePose(null)
  }

  function handleDragCancel() {
    setDragGroups(null)
    setActivePose(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="space-y-3">
        {display.map((group) => (
          <GroupCard
            key={group.id}
            section={section}
            group={group}
            gender={gender}
            startFrame={startFrames.get(group.id) ?? 1}
            failedFrames={failedFrames}
            removable={removable}
            expandedIds={expandedIds}
            onToggleExpanded={toggleExpanded}
            override={override}
            onChange={changeGroup}
            onRemove={removeGroup}
            onMirror={mirrorGroupAfter}
          />
        ))}
        {display.length === 0 && (
          <p className="rounded-lg border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
            No groups yet — e.g. one group per driver bone, or left/right/centre groups for
            mirrored poses.
          </p>
        )}
      </div>
      {createPortal(
        // Portalled to <body> so no transformed/clipping ancestor (the accordion,
        // the sticky header) can hide the position:fixed overlay.
        <DragOverlay dropAnimation={null}>
          {activePose ? (
            <div className="flex cursor-grabbing items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm text-card-foreground shadow-xl ring-1 ring-primary/50">
              <GripVertical className="size-3.5 text-muted-foreground" />
              <span className="font-medium">{activePose.name || '(unnamed morph)'}</span>
              <span className="text-xs text-muted-foreground">
                {activePose.morphs.length} morph{activePose.morphs.length === 1 ? '' : 's'}
              </span>
            </div>
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
})

/** The implicit single group of a flat FBM/MISC section (no group management).
 *  Its id comes from the core (`flatSectionGroupId`) — scene-override additions
 *  key on it, so the merge can materialize the group at generation time. */
export function flatGroup(section: RomSection): RomGroup {
  return {
    id: flatSectionGroupId(section),
    label: '',
    suffix: 'centre',
    method: 'default',
    calculateFrom: 'default',
    poses: [],
  }
}
