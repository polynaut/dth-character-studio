import { memo, useContext, useEffect, useMemo, useState } from 'react'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { Copy, Plus, Trash2 } from 'lucide-react'

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dth/ui'
import {
  BONE_LABEL_SECTIONS,
  CALC_FROM_SECTIONS,
  GROUPED_SECTIONS,
  METHOD_SECTIONS,
  REFERENCE_FBX_SECTIONS,
  genDefaultNode,
  newId,
} from '@dth/rom'

import type {
  CalculateFrom,
  Gender,
  GenerationMethod,
  GroupSuffix,
  RomGroup,
  RomPose,
  RomSection,
} from '@dth/rom'

import { headerSelectClass } from './cells.tsx'
import { FigureNodeContext } from './contexts.ts'
import { SortablePoseRow, poseColumns } from './pose-table.tsx'

import type { PoseTableMeta } from './pose-table.tsx'

/**
 * Scene-override mode for a whole SECTION's groups (built once in RomSections,
 * shared by every group card): the BASE groups stay untouched — checked rows
 * read/write `overriddenById` (keyed by the base pose's id), added rows live in
 * per-group `additions` and only ever append after the base rows. All group
 * chrome (label, method, suffix, mirror, remove) locks: the structure is the
 * base ROM's. Each card slices its own view out of this via its group id — the
 * object itself is memoized in RomSections, so it stays a stable memo prop.
 */
export interface SectionOverrideCtl {
  overriddenById: ReadonlyMap<string, RomPose>
  additionsFor: (groupId: string) => Array<RomPose>
  onToggleRow: (pose: RomPose, on: boolean) => void
  onReplacePose: (pose: RomPose) => void
  onAdditionsChange: (groupId: string, poses: Array<RomPose>) => void
}

/**
 * One pose group's table. Memoized — a page-level render (modifier keys,
 * polling, unrelated form edits) must not re-render every open pose table; the
 * parent passes identity-stable, id-based callbacks so only the group whose
 * data actually changed re-renders.
 */
export const GroupCard = memo(function GroupCard({
  section,
  group,
  gender,
  startFrame,
  failedFrames,
  removable = true,
  expandedIds,
  onToggleExpanded,
  onChange,
  onRemove,
  onMirror,
  override,
}: {
  section: RomSection
  group: RomGroup
  gender: Gender
  startFrame: number
  failedFrames?: Set<number>
  removable?: boolean
  expandedIds: Set<string>
  onToggleExpanded: (poseId: string) => void
  onChange: (groupId: string, group: RomGroup) => void
  onRemove: (groupId: string) => void
  onMirror: (groupId: string) => void
  override?: SectionOverrideCtl
}) {
  const showBoneScale = REFERENCE_FBX_SECTIONS.includes(section)
  const showBoneLabel = BONE_LABEL_SECTIONS.includes(section)
  const showSuffix = GROUPED_SECTIONS.includes(section)
  const showMethod = METHOD_SECTIONS.includes(section)
  const showCalcFrom = CALC_FROM_SECTIONS.includes(section)
  const figureNode = useContext(FigureNodeContext)
  /** This group updated — the parent routes it back by id (stable callback). */
  const change = (updated: RomGroup) => onChange(group.id, updated)
  // The group's own id is its container droppable, so a pose can be dropped onto
  // an empty group's body. The DndContext spanning all groups lives in the parent
  // (PoseGroupsEditor), enabling drags between groups, not just within one.
  const { setNodeRef: setDropRef } = useDroppable({ id: group.id })

  // A freshly inserted pose's name field gets focused once its row renders (the
  // insert flows through the parent's onChange, so the row exists a render later).
  // Quote/backslash-escape is all a quoted attribute selector needs (CSS.escape
  // is unavailable in jsdom, and the bare name is shadowed by @dnd-kit's CSS).
  const [focusPoseId, setFocusPoseId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusPoseId) return
    const el = document.querySelector<HTMLInputElement>(
      `input[data-pose-input="${focusPoseId.replace(/["\\]/g, '\\$&')}"]`,
    )
    if (el) {
      el.focus()
      setFocusPoseId(null)
    }
  }, [focusPoseId, group.poses])

  // What the table shows: the base rows (each swapped for its override copy
  // when checked) plus the override's appended rows. Without an override this
  // is simply the group's poses. MEMOIZED because it feeds useReactTable's
  // `data`: an identity that changes every render makes the table re-derive
  // its row model each time, which can feed back into an endless sync
  // re-render loop (the table's own "give data a stable reference" rule —
  // group.poses used to provide that stability for free).
  const baseCount = group.poses.length
  const overriddenById = override?.overriddenById
  // Stable per overrideCtl identity: additionsFor returns the stored array (or
  // the shared EMPTY_POSES fallback), so this is a valid memo input.
  const additions = override ? override.additionsFor(group.id) : undefined
  const displayPoses = useMemo(
    () =>
      overriddenById && additions
        ? [...group.poses.map((pose) => overriddenById.get(pose.id) ?? pose), ...additions]
        : group.poses,
    [group.poses, overriddenById, additions],
  )

  // Route an edited row to where it lives: the base group, the override's
  // replaced-row map (checked base rows only — unchecked ones are read-only in
  // override mode), or the override's additions.
  function patchPose(rowIndex: number, patch: Partial<RomPose>) {
    if (!override || !additions) {
      change({
        ...group,
        poses: group.poses.map((pose, i) => (i === rowIndex ? { ...pose, ...patch } : pose)),
      })
      return
    }
    const pose = displayPoses[rowIndex]
    if (rowIndex < baseCount) {
      if (!override.overriddenById.has(pose.id)) return
      override.onReplacePose({ ...pose, ...patch })
    } else {
      override.onAdditionsChange(
        group.id,
        additions.map((p, i) => (i === rowIndex - baseCount ? { ...p, ...patch } : p)),
      )
    }
  }

  const meta: PoseTableMeta = {
    startFrame,
    failedFrames,
    showBoneScale,
    expandedIds,
    toggleExpanded: onToggleExpanded,
    figureNode,
    update: patchPose,
    updateMorphAt: (rowIndex, morphIndex, patch) => {
      const pose = displayPoses[rowIndex]
      const morphs = pose.morphs.length
        ? pose.morphs.map((m, mi) => (mi === morphIndex ? { ...m, ...patch } : m))
        : [{ id: newId(), node: '', prop: '', value: 1, ...patch }]
      patchPose(rowIndex, { morphs })
    },
    addMorph: (rowIndex) => {
      const pose = displayPoses[rowIndex]
      patchPose(rowIndex, {
        morphs: [
          ...pose.morphs,
          { id: newId(), node: pose.morphs[0]?.node ?? figureNode, prop: '', value: 1 },
        ],
      })
    },
    removeMorphAt: (rowIndex, morphIndex) => {
      const pose = displayPoses[rowIndex]
      if (pose.morphs.length <= 1) return
      patchPose(rowIndex, { morphs: pose.morphs.filter((_, mi) => mi !== morphIndex) })
    },
    remove: (rowIndex) => {
      if (!override || !additions) {
        change({ ...group, poses: group.poses.filter((_, i) => i !== rowIndex) })
        return
      }
      // Base rows never leave in override mode — only the override's own frames.
      if (rowIndex < baseCount) return
      override.onAdditionsChange(
        group.id,
        additions.filter((_, i) => i !== rowIndex - baseCount),
      )
    },
    insertAt: (index) => {
      // Override mode appends at the group end only (the insert menu is hidden
      // there — this guard just backs it up).
      if (override) return
      // Inherit the node from the pose before the insertion point (falling back
      // to the one after, then the section default) — pose lists usually target
      // the same node throughout.
      const neighbor = group.poses[index - 1] ?? group.poses[index]
      const node =
        neighbor?.morphs[0]?.node ?? (section === 'GEN' ? genDefaultNode(gender) : figureNode)
      const id = newId()
      const poses = [...group.poses]
      poses.splice(index, 0, {
        id,
        name: '',
        morphs: [{ id: newId(), node, prop: '', value: 1 }],
        boneScaleRef: false,
      })
      change({ ...group, poses })
      // Focus the new row's name field as soon as it renders.
      setFocusPoseId(id)
    },
    override: override
      ? {
          baseCount,
          isOverridden: (poseId) => override.overriddenById.has(poseId),
          toggle: (poseId, on) => {
            const base = group.poses.find((pose) => pose.id === poseId)
            if (base) override.onToggleRow(base, on)
          },
        }
      : undefined,
  }

  const table = useReactTable({
    data: displayPoses,
    columns: poseColumns,
    getCoreRowModel: getCoreRowModel(),
    meta,
    state: { columnVisibility: { boneScaleRef: showBoneScale, override: !!override } },
  })

  function addPose() {
    // Inherit the node from the previous pose — pose lists usually target the
    // same node throughout. A GEN group starts on the gender's geograft node.
    const lastNode =
      displayPoses[displayPoses.length - 1]?.morphs[0]?.node ??
      (section === 'GEN' ? genDefaultNode(gender) : figureNode)
    const pose: RomPose = {
      id: newId(),
      name: '',
      morphs: [{ id: newId(), node: lastNode, prop: '', value: 1 }],
      boneScaleRef: false,
    }
    if (override && additions) {
      // Appended after the base rows — the only place an override adds frames.
      override.onAdditionsChange(group.id, [...additions, pose])
    } else {
      change({ ...group, poses: [...group.poses, pose] })
    }
  }

  const endFrame = startFrame + displayPoses.length - 1
  const frameRange =
    displayPoses.length === 0
      ? 'empty'
      : displayPoses.length === 1
        ? `frame ${startFrame}`
        : `frames ${startFrame}–${endFrame}`

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        {/* Field availability per section mirrors the PoseAsset node's CSV
            format (docs/poseasset-csv-spec.md). FBM/MISC groups show nothing. */}
        {showBoneLabel && (
          <input
            className={`${headerSelectClass} w-36`}
            value={group.label}
            placeholder="driver bone(s)"
            title="The bone(s) driving this group's poses (CSV bones column)"
            disabled={!!override}
            onChange={(e) => change({ ...group, label: e.target.value })}
          />
        )}
        {showMethod && (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="How the group's morphs are calculated: default (the node's global setting) / individual (each in isolation) / additive (the rest are deltas on top of the first pose) / cumulative (each stacks on all previous poses) / advanced additive"
          >
            Generation
            <Select
              value={group.method}
              onValueChange={(value) => change({ ...group, method: value as GenerationMethod })}
            >
              <SelectTrigger size="sm" className="w-fit" disabled={!!override}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="individual">Individual</SelectItem>
                <SelectItem value="additive">Additive</SelectItem>
                <SelectItem value="cumulative">Cumulative</SelectItem>
                <SelectItem value="advancedAdditive">Advanced Additive</SelectItem>
              </SelectContent>
            </Select>
          </span>
        )}
        {showCalcFrom && (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="What the group's morph deltas are calculated against: default (the node's global setting) / the rest pose / the animation frame"
          >
            Calculate from
            <Select
              value={group.calculateFrom}
              onValueChange={(value) =>
                change({ ...group, calculateFrom: value as CalculateFrom })
              }
            >
              <SelectTrigger size="sm" className="w-fit" disabled={!!override}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="restPose">Rest Pose</SelectItem>
                <SelectItem value="animationFrame">Animation Frame</SelectItem>
              </SelectContent>
            </Select>
          </span>
        )}
        {showSuffix && (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            title="Suffix — generated morphs get _l/_r appended automatically"
          >
            Suffix
            <Select
              value={group.suffix}
              onValueChange={(value) => change({ ...group, suffix: value as GroupSuffix })}
            >
              <SelectTrigger size="sm" className="w-fit" disabled={!!override}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">Left</SelectItem>
                <SelectItem value="centre">Centre</SelectItem>
                <SelectItem value="right">Right</SelectItem>
              </SelectContent>
            </Select>
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{frameRange}</span>
        {/* Mirror/remove change the base structure — locked in override mode. */}
        {group.suffix === 'left' && !override && (
          <Button
            variant="ghost"
            size="sm"
            title="Append a mirrored right-side copy of this group"
            onClick={() => onMirror(group.id)}
          >
            <Copy /> Mirror right
          </Button>
        )}
        {removable && !override && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            title="Remove group"
            onClick={() => onRemove(group.id)}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        )}
      </div>
      <div ref={setDropRef}>
        <table className="w-full border-collapse text-sm">
          <thead>
            {/* Third sticky tier: the column titles pin right under the section
                title — the fixed `--chrome-h` (page chrome) plus the section title's
                own 48px height. z under its z-[5]. Sticky lives on the th's (not the
                tr), with a solid bg and an inset bottom shadow standing in for the
                border — collapsed table borders don't travel with sticky cells. */}
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                <th
                  className="sticky z-[4] w-7 bg-background shadow-[inset_0_-1px_0_0_var(--color-border)]"
                  style={{ top: 'calc(var(--chrome-h) + 48px)' }}
                />
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="sticky z-[4] bg-background px-2 py-1.5 text-left text-xs font-medium text-muted-foreground shadow-[inset_0_-1px_0_0_var(--color-border)]"
                    style={{ top: 'calc(var(--chrome-h) + 48px)' }}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <SortableContext
            items={displayPoses.map((pose) => pose.id)}
            strategy={verticalListSortingStrategy}
          >
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <SortablePoseRow
                  key={row.original.id}
                  row={row}
                  expanded={expandedIds.has(row.original.id)}
                  meta={meta}
                />
              ))}
              {displayPoses.length === 0 && (
                <tr>
                  {/* Mirror a TextCell's vertical metrics (1px border + py-1 +
                      a text-sm line) — a pose row's height is set by its name
                      input, so copying its class stack keeps this placeholder
                      exactly as tall as a pose row and adding the first morph
                      doesn't shift the layout. */}
                  <td
                    colSpan={poseColumns.length + 1}
                    className="px-4 py-0.5 text-center text-sm text-muted-foreground"
                  >
                    <div className="border-y border-transparent py-1">
                      No poses in this group yet.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </SortableContext>
        </table>
      </div>
      <div className="border-t p-1.5">
        <Button
          variant="outline"
          size="sm"
          title={
            override
              ? 'Append an override frame for the selected scene — added frames always go at the end of the group'
              : undefined
          }
          onClick={addPose}
        >
          <Plus /> Add morph
        </Button>
      </div>
    </div>
  )
})
