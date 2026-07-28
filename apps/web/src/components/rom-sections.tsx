import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ChevronRight, FolderOpen, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { pickCsvPath, pickDufPath } from '#/lib/desktop.ts'
import { importPosesFromCsv } from '#/lib/rom/api.ts'

import { Button, cn, InfoPopup, Input, Modal, OverrideMark, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@dth/ui'
import { CsvImportDialog } from '#/components/csv-import-dialog.tsx'
import { ScanCsvPickerDialog } from '#/components/scan-csv-picker-dialog.tsx'
import {
  GROUPED_SECTIONS,
  ROM_SECTIONS,
  SECTION_LABELS,
  SECTION_MODES,
  applySceneOverride,
  flatSectionGroupId,
  genesisFigureNode,
  newId,
  presetFrameCount,
  romPoseEqual,
  sectionPresetAvailable,
} from '@dth/rom'

import type { BoneIndexEntry, MorphIndexEntry } from '#/lib/rom/api.ts'
import type {
  Gender,
  GenesisVersion,
  JcmMorphMod,
  PresetFrames,
  RomGroup,
  RomPose,
  RomSection,
  RomSectionConfig,
  RomSections as RomSectionsModel,
  SceneOverride,
  SceneRomOverride,
  SectionMode,
} from '@dth/rom'

import { ArtDirectionEditor } from './rom/art-direction.tsx'
import { JcmModsGrid } from './rom/jcm-mods-grid.tsx'
import { FigureNodeContext } from './rom/contexts.ts'
import { MorphIndexProvider } from './rom/morph-index-provider.tsx'
import { ImportCsvButton } from './rom/import-csv-button.tsx'
import { PRESET_DESCRIPTIONS, PresetAssetPicker } from './rom/preset-asset-picker.tsx'
import { PoseGroupsEditor, flatGroup } from './rom/pose-groups-editor.tsx'

import type { SectionOverrideCtl } from './rom/pose-groups-editor.tsx'
import type { PoseAssetCatalog } from './rom/preset-asset-picker.tsx'

/**
 * Accordion over the eight pose asset categories — all collapsed initially
 * so the whole ROM can be scanned at a glance. Preset sections show a simple
 * form (they compile into the DthWorkflow include flags); custom sections
 * hold the group/pose grid (they compile into the extra-JSON frames and the
 * PoseAsset CSV).
 */

interface RomSectionsProps {
  sections: RomSectionsModel
  genesis: GenesisVersion
  gender: Gender
  skinning: 'linear' | 'dqs'
  catalog: PoseAssetCatalog
  /** Measured preset-block frame lengths; null while unmeasurable (assets unread). */
  presetFrames: PresetFrames | null
  /** Scanned morphs for this character's generation — enables the Morph-name
   *  autocomplete when a Scan_Morphs_<Genesis> run has produced an index. */
  morphIndex?: Array<MorphIndexEntry>
  /** Scanned bones for this generation — enables the bone-name autocomplete in
   *  the "Modify JCM frames" editor (same Scan_Morphs_<Genesis> index). */
  boneIndex?: Array<BoneIndexEntry>
  /** Absolute frames whose morphs failed in the last ROM run (from the run log) —
   *  matching pose rows are marked red. */
  failedFrames?: Set<number>
  /** Set (with a fresh nonce) to open the section holding `frame` and scroll its
   *  pose row into view — driven by clicking a failed morph in the run report. */
  revealFrame?: { frame: number; nonce: number } | null
  /** A blocked-save validation error: open its section, scroll the pose row into
   *  view and focus its first empty field. */
  revealPose?: { section: RomSection; poseId: string; nonce: number } | null
  /** Bone-rotation morph drives along the JCM ROM (character.jcmMorphMods) —
   *  both must be passed for the JCM section's "Modify JCM frames" grid. */
  jcmMorphMods?: Array<JcmMorphMod>
  onJcmMorphModsChange?: (mods: Array<JcmMorphMod>) => void
  /**
   * Scene-override mode (the page's Override toggle, one entry per extra Daz
   * scene): the base setup locks, base rows dim until their Override checkbox
   * marks them replaced for that scene, and new frames append at group ends
   * only. Frame numbers shown come from the MERGED sections — exactly what the
   * scene's own script + CSV generate.
   */
  override?: { data: SceneOverride; onChange: (next: SceneOverride) => void }
  /** A non-primary scene is selected but its ROM override isn't armed yet — the
   *  whole ROM is read-only (a dimmed base view) until the page's Override toggle
   *  arms it, exactly like the other per-scene panels. Sections still expand so
   *  the rows can be inspected. */
  locked?: boolean
  onChange: (sections: RomSectionsModel) => void
}

/** Sections whose ON/OFF state is driven by the primary Daz scene's contents,
 *  never by hand: GEN follows the scene's GP/DK geograft (the geografts add
 *  bones, and every scene must produce the primary's skeleton — the add-scene
 *  dialog validates that). The state is derived when a primary scene is
 *  chosen (`primarySceneDerivation` — character create / relink); here the
 *  enable toggle is permanently disabled and a per-scene enable override is
 *  refused. The section's CONTENT stays fully editable — including per-scene
 *  overrides (e.g. a different art direction for an outfit scene). */
const SCENE_GATED_SECTIONS: ReadonlyArray<RomSection> = ['GEN']

/** Shared empty-additions fallback — a stable identity (see overrideCtl). */
const EMPTY_POSES: Array<RomPose> = []

/** Stable per-section fallback for an EMPTY flat FBM/MISC section. flatGroup is
 *  deterministic per section (its id is the core's `flatSectionGroupId`), but a
 *  freshly built `[flatGroup(section)]` each render defeated the
 *  PoseGroupsEditor/GroupCard memo chain — so the singleton is cached here. */
const FLAT_GROUP_FALLBACKS = new Map<RomSection, Array<RomGroup>>()
function flatGroupFallback(section: RomSection): Array<RomGroup> {
  let groups = FLAT_GROUP_FALLBACKS.get(section)
  if (!groups) {
    groups = [flatGroup(section)]
    FLAT_GROUP_FALLBACKS.set(section, groups)
  }
  return groups
}

function sectionSummary(config: RomSectionConfig): string {
  if (!config.enabled) return 'disabled'
  if (config.mode === 'preset') return 'enabled'
  const poses = config.groups.reduce((sum, group) => sum + group.poses.length, 0)
  return `custom · ${config.groups.length} ${config.groups.length === 1 ? 'group' : 'groups'} · ${poses} ${poses === 1 ? 'frame' : 'frames'}`
}

/**
 * Memoized: the ROM subtree is the page's heavy part (every open pose table),
 * so page-level renders that don't change any of its props (modifier keys,
 * polling, focus refetches) must stop here. The character page passes
 * identity-stable callbacks/objects to make that hold.
 */
export const RomSections = memo(function RomSections({
  sections,
  genesis,
  gender,
  skinning,
  catalog,
  presetFrames,
  failedFrames,
  revealFrame,
  revealPose,
  morphIndex,
  boneIndex,
  jcmMorphMods,
  onJcmMorphModsChange,
  override,
  locked = false,
  onChange,
}: RomSectionsProps) {
  const [open, setOpen] = useState<Partial<Record<RomSection, boolean>>>({})
  // The section whose scan-CSV picker is open (null = no import in progress).
  const [pickerSection, setPickerSection] = useState<RomSection | null>(null)
  // A picked CSV awaiting its frame-range dialog (null = no import in progress).
  const [pendingCsv, setPendingCsv] = useState<{
    section: RomSection
    poses: Awaited<ReturnType<typeof importPosesFromCsv>>
  } | null>(null)
  // A pending "Clear" request awaiting its confirm modal: a custom section's
  // whole definition, or (`rules`) the JCM "Modify frames" rule list.
  const [clearRequest, setClearRequest] = useState<{ section: RomSection; rules?: boolean } | null>(
    null,
  )


  // Scene-override mode: everything frame-related displays the MERGED sections
  // (replaced rows in place, added rows at group ends, and a whole-owned section
  // verbatim) — exactly what the scene's own artifacts generate. The base `sections`
  // stay the editing model. Memoized so a section's `groups` keep a stable identity
  // across renders (they feed the memoized group tables' `data`).
  const overrideData = override?.data
  const displaySections = useMemo(
    () => (overrideData ? applySceneOverride(sections, overrideData) : sections),
    [sections, overrideData],
  )

  // The scene override's grid controller, shared by every section's group
  // editor. Since schema v24 the override rows live SECTION-KEYED on the
  // record's `rom` map; the controller keeps its flat interface (the group
  // editors don't know sections) and derives each write's section from the base
  // pose/group ids. Checking a row seeds its override with a copy of the base
  // pose. The maps and the empty-additions fallback keep STABLE identities
  // across re-renders — they end up in GroupCard's memoized table `data`, which
  // must not churn. The controller itself is memoized too: it's a prop of the
  // memoized group editors, so its identity may only change when the override
  // data does.
  const overriddenById = useMemo(
    () =>
      new Map(
        Object.values(overrideData?.rom ?? {}).flatMap((entry) =>
          (entry?.replaced ?? []).map((pose) => [pose.id, pose] as const),
        ),
      ),
    [overrideData?.rom],
  )
  // Base (primary-scene) attribution across every section: the pose by id (so an
  // override edited back to match its base row can be dropped instead of
  // lingering as a green no-op) and each pose/group id's SECTION (so the flat
  // controller's writes land at the right `rom` key — flat sentinels included).
  const { basePoseById, poseSection, groupSection } = useMemo(() => {
    const poses = new Map<string, RomPose>()
    const poseSec = new Map<string, RomSection>()
    const groupSec = new Map<string, RomSection>()
    for (const section of ROM_SECTIONS) {
      groupSec.set(flatSectionGroupId(section), section)
      for (const group of sections[section].groups) {
        groupSec.set(group.id, section)
        for (const pose of group.poses) {
          poses.set(pose.id, pose)
          poseSec.set(pose.id, section)
        }
      }
    }
    return { basePoseById: poses, poseSection: poseSec, groupSection: groupSec }
  }, [sections])
  const onOverrideChange = override?.onChange
  // ONE rom-entry updater: applies `update` at the section's key and prunes an
  // entry left carrying nothing (no owned config, no enable overlay, no rows) —
  // the structural cleanup that keeps a record's `rom` free of dead keys (and,
  // via the empty-record prune in onOverrideChange, the character free of dead
  // records).
  const updateRomEntry = useCallback(
    (
      od: SceneOverride,
      section: RomSection,
      update: (entry: SceneRomOverride) => SceneRomOverride,
    ): SceneOverride => {
      const next = update(od.rom[section] ?? { replaced: [], added: [] })
      const rom = { ...od.rom }
      if (
        next.owned === undefined &&
        next.enabled === undefined &&
        next.replaced.length === 0 &&
        next.added.length === 0
      ) {
        delete rom[section]
      } else {
        rom[section] = next
      }
      return { ...od, rom }
    },
    [],
  )
  const overrideCtl = useMemo<SectionOverrideCtl | undefined>(
    () =>
      onOverrideChange && overrideData
        ? {
            overriddenById,
            additionsFor: (groupId) => {
              const section = groupSection.get(groupId)
              const added =
                section &&
                overrideData.rom[section]?.added.find((entry) => entry.groupId === groupId)
              return added?.poses ?? EMPTY_POSES
            },
            // Arm-on-edit: editing a base row upserts its override copy (keyed by the
            // base pose id); the display substitutes it in place. There's no explicit
            // "check to override" — touching the row IS the override. But an edit that
            // lands back ON the base row (e.g. a bone-scale flag toggled off again)
            // drops the copy, so the row stops reading as overridden.
            upsertPose: (pose) => {
              const section = poseSection.get(pose.id)
              if (!section) return
              const base = basePoseById.get(pose.id)
              onOverrideChange(
                updateRomEntry(overrideData, section, (entry) => {
                  const rest = entry.replaced.filter((p) => p.id !== pose.id)
                  return {
                    ...entry,
                    replaced: base && romPoseEqual(pose, base) ? rest : [...rest, pose],
                  }
                }),
              )
            },
            // Reset a base row → drop its override copy so it falls back to the base.
            resetPose: (poseId) => {
              const section = poseSection.get(poseId)
              if (!section) return
              onOverrideChange(
                updateRomEntry(overrideData, section, (entry) => ({
                  ...entry,
                  replaced: entry.replaced.filter((p) => p.id !== poseId),
                })),
              )
            },
            onAdditionsChange: (groupId, poses) => {
              const section = groupSection.get(groupId)
              if (!section) return
              onOverrideChange(
                updateRomEntry(overrideData, section, (entry) => {
                  const rest = entry.added.filter((e) => e.groupId !== groupId)
                  return {
                    ...entry,
                    added: poses.length > 0 ? [...rest, { groupId, poses }] : rest,
                  }
                }),
              )
            },
          }
        : undefined,
    [
      onOverrideChange,
      overrideData,
      overriddenById,
      basePoseById,
      poseSection,
      groupSection,
      updateRomEntry,
    ],
  )
  // On a non-primary scene the section STRUCTURE (enable/mode/groups) is locked —
  // whether the override is armed (overrideCtl) or not (locked). Mute the section
  // titles to match their disabled enable toggle, so the whole block reads as
  // "structure fixed for this scene, you're only overriding frame values".
  const structureLocked = !!overrideCtl || locked

  // Absolute timeline frame of each custom group's first pose: the measured
  // preset ROM blocks (base, GP/DK, Physics) come first, then the custom
  // sequence continues. Left empty when frames couldn't be measured — the
  // editor shows a notice and the group editors fall back to a relative count.
  // Memoized on the real inputs — these maps were rebuilt on EVERY page render
  // (and startFrames feeds the memoized group editors, so identity matters).
  const { startFrames, sectionByFrame } = useMemo(() => {
    const starts = new Map<string, number>()
    // Which section holds each absolute frame, for the "reveal a failed morph" jump.
    const byFrame = new Map<number, RomSection>()
    if (presetFrames) {
      let frame = presetFrameCount(displaySections, gender, presetFrames)
      for (const section of ROM_SECTIONS) {
        const config = displaySections[section]
        if (config.mode !== 'custom') continue
        // A DISABLED custom section still lays its rows out at the frame they'd occupy
        // if it were on (so the numbers don't collapse to 1 while the user decides what
        // to do with them) — but it must NOT advance the global counter, since a disabled
        // section contributes no frames and mustn't shift the sections after it. Only
        // enabled sections map into `byFrame` (the run-report jump) + move the counter.
        let cursor = frame
        for (const group of config.groups) {
          starts.set(group.id, cursor)
          if (config.enabled) {
            for (let i = 0; i < group.poses.length; i++) byFrame.set(cursor + i, section)
          }
          cursor += group.poses.length
        }
        if (config.enabled) frame = cursor
      }
    }
    return { startFrames: starts, sectionByFrame: byFrame }
  }, [displaySections, gender, presetFrames])

  // A failed morph clicked in the run report: open its section and scroll the row
  // (which carries id `dth-rom-frame-<abs>`) into view. Two rAFs so the section
  // body has mounted before we scroll.
  useEffect(() => {
    if (!revealFrame) return
    const section = sectionByFrame.get(revealFrame.frame)
    if (!section) return
    setOpen((o) => ({ ...o, [section]: true }))
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .getElementById(`dth-rom-frame-${revealFrame.frame}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealFrame?.nonce])

  // A blocked-save validation error: open the section, scroll the offending pose
  // row into view and focus the field that's actually wrong, so the fix is one
  // keystroke away. Prefer the red-bordered input (aria-invalid — a filled-but-
  // invalid name), then fall back to the first empty input (an empty required
  // field is flagged by emptiness, not aria-invalid).
  useEffect(() => {
    if (!revealPose) return
    setOpen((o) => ({ ...o, [revealPose.section]: true }))
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-pose-id="${revealPose.poseId}"]`)
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        if (!row) return
        const inputs = Array.from(row.querySelectorAll('input'))
        const target =
          inputs.find((i) => i.getAttribute('aria-invalid') === 'true') ??
          inputs.find((i) => i.value.trim() === '')
        target?.focus()
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealPose?.nonce])

  function patchSection(section: RomSection, patch: Partial<RomSectionConfig>) {
    onChange({ ...sections, [section]: { ...sections[section], ...patch } })
  }

  // ONE identity-stable groups handler shared by every section's (memoized) group
  // editor — the editor reports its section alongside the new groups, so no
  // per-section closure (which would defeat the memo) is needed. Latest-ref so the
  // stable callback always sees the current sections / override.
  const sectionsRef = useRef(sections)
  sectionsRef.current = sections
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const overrideDataRef = useRef(overrideData)
  overrideDataRef.current = overrideData
  const onOverrideChangeRef = useRef(onOverrideChange)
  onOverrideChangeRef.current = onOverrideChange
  const jcmMorphModsRef = useRef(jcmMorphMods)
  jcmMorphModsRef.current = jcmMorphMods
  // THE per-scene section-config writer. On the primary scene it edits the base
  // section; on a non-primary scene it makes the scene OWN the section's config —
  // ANY config field (mode, preset assets, art direction, groups, custom path) can
  // be overridden this way. The first owning edit ESCALATES: it snapshots the
  // merged section config (base + this scene's sparse edits + the enable
  // overlay), applies the patch, and clears the sparse layers AND the overlay AT
  // THE SAME `rom` KEY — the owned config carries `enabled` itself, and dead
  // layers structurally can't linger under it (the point of the v24 shape).
  const patchSectionForScene = useCallback(
    (section: RomSection, patch: Partial<RomSectionConfig>) => {
      const od = overrideDataRef.current
      const emit = onOverrideChangeRef.current
      if (!od || !emit) {
        onChangeRef.current({
          ...sectionsRef.current,
          [section]: { ...sectionsRef.current[section], ...patch },
        })
        return
      }
      const owned = od.rom[section]?.owned
      if (owned) {
        emit(updateRomEntry(od, section, (entry) => ({ ...entry, owned: { ...owned, ...patch } })))
        return
      }
      const merged = applySceneOverride(sectionsRef.current, od)[section]
      emit(
        updateRomEntry(od, section, () => ({
          replaced: [],
          added: [],
          owned: { ...merged, ...patch },
        })),
      )
    },
    [updateRomEntry],
  )
  // The groups editor reports (section, groups); route it through the general writer.
  const onSectionGroupsChange = useCallback(
    (section: RomSection, groups: Array<RomGroup>) => patchSectionForScene(section, { groups }),
    [patchSectionForScene],
  )

  // Per-scene enable/disable of a whole section. Stored only when it DIFFERS from
  // the base (toggling back to the base value drops the entry, so the mark quiets).
  // The base section's mode/groups are untouched — a disabled section just stops
  // contributing frames for this scene; an enabled one uses the base config.
  const onSectionEnabledChange = useCallback(
    (section: RomSection, enabled: boolean) => {
      const od = overrideDataRef.current
      const emit = onOverrideChangeRef.current
      if (!od || !emit) return
      // A scene-gated section's on/off state follows the primary scene's
      // contents on EVERY scene — a per-scene enable override is refused
      // (backstop; the switch itself is disabled).
      if (SCENE_GATED_SECTIONS.includes(section)) return
      // An OWNED section keeps `enabled` in its own config (the overlay was
      // cleared on escalation), so its toggle patches the owned config — NOT the
      // overlay, whose base-relative drop rule can't express the owned resting
      // value (that mismatch is what made a disabled-then-customized section's
      // re-enable go dead).
      if (od.rom[section]?.owned) {
        patchSectionForScene(section, { enabled })
        return
      }
      // The overlay is stored only while it DIFFERS from the base (undefined
      // drops it — and an entry left empty prunes with it).
      const baseEnabled = sectionsRef.current[section].enabled
      emit(
        updateRomEntry(od, section, (entry) => ({
          ...entry,
          enabled: enabled === baseEnabled ? undefined : enabled,
        })),
      )
    },
    [patchSectionForScene, updateRomEntry],
  )

  // Per-scene "Modify JCM frames" override — the scene's own jcmMorphMods list.
  // PRESENT only while it DIFFERS from the base (presence = armed), so editing
  // it back to the base list deletes the block (and the runtime rides the base
  // delta). No-op on the primary scene (there the grid edits the base via
  // onJcmMorphModsChange).
  const onJcmModsForScene = useCallback((mods: Array<JcmMorphMod>) => {
    const od = overrideDataRef.current
    const emit = onOverrideChangeRef.current
    if (!od || !emit) return
    const same = JSON.stringify(mods) === JSON.stringify(jcmMorphModsRef.current ?? [])
    emit({ ...od, jcm: same ? undefined : mods })
  }, [])

  // Execute a confirmed Clear (the modal at the bottom): `rules` empties the JCM
  // "Modify frames" list, a section clear empties its groups — both through the
  // same per-scene writers as row edits, so on a non-primary scene the clear
  // escalates and the scene owns the emptied definition.
  function onClearConfirmed() {
    if (!clearRequest) return
    if (clearRequest.rules) {
      if (overrideData) onJcmModsForScene([])
      else onJcmMorphModsChange?.([])
    } else {
      onSectionGroupsChange(clearRequest.section, [])
    }
    setClearRequest(null)
  }

  // Bulk-import a DAZ morph CSV into a section: the picker dialog lists the
  // Scan_Frames scans (plus Browse for hand-curated files); a full scene scan
  // covers the whole ROM, so the chosen file then opens the frame-range dialog
  // and applyCsvImport commits the slice.
  async function loadCsv(section: RomSection, filePath: string) {
    setPickerSection(null)
    let imported: Awaited<ReturnType<typeof importPosesFromCsv>>
    try {
      imported = await importPosesFromCsv({ data: { filePath } })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return
    }
    if (imported.length === 0) {
      toast.error('No morphs found in that CSV')
      return
    }
    setPendingCsv({ section, poses: imported })
  }

  async function browseCsv(section: RomSection) {
    const filePath = await pickCsvPath('Select a DAZ morph CSV')
    if (!filePath) return
    await loadCsv(section, filePath)
  }

  // Commit the chosen frame range: each selected row becomes a pose (a cleaned
  // name + its morphs). Grouped sections get a new group; the flat FBM/MISC list
  // appends to its single group. The section is enabled + custom.
  function applyCsvImport(start: number, end: number) {
    if (!pendingCsv) return
    const { section, poses: source } = pendingCsv
    setPendingCsv(null)
    const inRange = source.filter((pose) => pose.frame >= start && pose.frame <= end)
    if (inRange.length === 0) {
      toast.error('No morphs in that frame range')
      return
    }
    const poses: Array<RomPose> = inRange.map((pose) => ({
      id: newId(),
      name: pose.name,
      morphs: pose.morphs,
      boneScaleRef: false,
    }))
    // Append to whatever the editor owns: on a non-primary scene that's the MERGED
    // section (so the import lands in the scene's own section and escalates it).
    const editorConfig = displaySections[section]
    const newGroup = (): RomGroup => ({
      id: newId(),
      label: '',
      suffix: 'centre',
      method: 'default',
      calculateFrom: 'default',
      poses,
    })
    const groups: Array<RomGroup> = GROUPED_SECTIONS.includes(section)
      ? [...editorConfig.groups, newGroup()]
      : [
          editorConfig.groups[0]
            ? { ...editorConfig.groups[0], poses: [...editorConfig.groups[0].poses, ...poses] }
            : // A flat FBM/MISC section's implicit group must carry the STABLE
              // `flatSectionGroupId` (via flatGroup), NOT a random newGroup() id —
              // scene-override additions key on it, and applySceneOverride only
              // materializes flat-id additions when the base group matches. A random
              // id silently drops those overridden frames from the editor and the
              // scene's generated artifacts.
              { ...flatGroup(section), poses },
          ...editorConfig.groups.slice(1),
        ]
    // patchSectionForScene edits the base on the primary scene and escalates to the
    // scene's owned config on a non-primary one — so an import is per-scene there.
    patchSectionForScene(section, { enabled: true, mode: 'custom', groups })
    toast.success(
      `Imported ${inRange.length} morph${inRange.length === 1 ? '' : 's'} into ${SECTION_LABELS[section]}`,
    )
  }

  // Memoize the context value so it's referentially stable across renders —
  // constructing it inline re-renders every FigureNodeContext consumer each time.
  const figureNode = useMemo(() => genesisFigureNode(genesis, gender), [genesis, gender])

  return (
    <MorphIndexProvider morphIndex={morphIndex}>
    <FigureNodeContext.Provider value={figureNode}>
    <div className="space-y-2">
      {!presetFrames && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          Couldn't measure the preset ROM frame lengths from the pose assets, so absolute frame
          numbers are unavailable. Make sure the DTH release is scanned in Settings and reachable.
        </div>
      )}
      {ROM_SECTIONS.map((section) => {
        const config = sections[section]
        // The MERGED section (base + this scene's overrides, incl. per-scene
        // enable/disable). On the primary scene displaySections === sections.
        const mergedConfig = displaySections[section]
        const modes = SECTION_MODES[section]
        const isOpen = open[section] ?? false
        // RET has no independent existence: the retargeting poses live inside
        // the JCM base ROM, so its state is derived from the JCM section.
        const tiedToJcm = section === 'RET'
        // A scene-gated section's enable toggle is never user-operable — its
        // on/off state was derived from the primary scene's geograft when the
        // scene was linked (see SCENE_GATED_SECTIONS). Content stays editable.
        const enableGated = SCENE_GATED_SECTIONS.includes(section)
        // The effective on/off state reads the MERGED sections, so a section a scene
        // has toggled shows (and the wrapper dims) for the override, not the base.
        const effectiveEnabled = tiedToJcm
          ? displaySections.JCM.enabled && displaySections.JCM.mode === 'preset'
          : mergedConfig.enabled
        // A scene has flipped THIS section's on/off state vs the primary — the section
        // is overridden even with no row edits (RET follows JCM, never toggled alone).
        const enabledOverridden =
          !!overrideData && !tiedToJcm && mergedConfig.enabled !== config.enabled
        // Whether the installed DTH release ships this section's preset asset for
        // the character's generation (e.g. GP/DK and Physics don't exist for
        // G8/G8.1, FAC doesn't for G8). Unavailable → preset mode isn't offered:
        // enabling the section lands directly on the custom morph list, the Mode
        // select locks the preset option, and a legacy character that still HAS
        // it enabled in preset mode gets a red chip (generation fails loud).
        // The rules live in @dth/rom next to the path resolution they gate.
        const presetAvailable = sectionPresetAvailable(
          section,
          catalog,
          genesis,
          gender,
          config.presetAssets,
        )
        const missingPresetAsset =
          effectiveEnabled && config.mode === 'preset' && !presetAvailable
        // Scene-override editing model for THIS section. Not escalated → the sparse
        // ctl edits base rows/appends (green) over the merged display; once a
        // structural edit escalates it, the scene OWNS the section (its rom
        // entry's `owned`) and it edits like the primary (plain groups, no ctl).
        const romEntry = overrideData?.rom[section]
        const escalated = !!romEntry?.owned
        const editorGroups = overrideData ? displaySections[section].groups : config.groups
        const editorOverride = overrideData && !escalated ? overrideCtl : undefined
        // The JCM "Modify frames" grid is a per-scene override tied to the JCM section.
        const jcmOverridden = section === 'JCM' && overrideData?.jcm !== undefined
        // The section-title override marker goes green whenever the section
        // diverges from the primary scene's ROM in ANY way. Its rom entry
        // EXISTING is that signal (entries prune the moment they carry nothing,
        // and upsertPose already drops a per-row copy that matches its base) —
        // plus the JCM-rules override riding the JCM section.
        const sectionOverridden = !!romEntry || jcmOverridden
        // Every part of a section is overridable per scene now (enable, mode, preset
        // asset, art direction, rows, JCM mods), so the mark shows on EVERY section on a
        // non-primary scene (never RET, which follows JCM) — the resting "can override"
        // hint like the other fields, going green once the section diverges in any way.
        // A scene-gated section shows it too: its CONTENT is overridable (only its
        // enable state is pinned — the disabled toggle's tooltip says why).
        const showSectionMark = !!overrideData && !tiedToJcm
        // Head-area text colour. A section carrying a scene override turns its whole
        // title row Daz-green (the override accent, matching the field labels + mark);
        // otherwise it dims to muted in the locked/override view, or keeps the default
        // foreground on the primary.
        const headText = sectionOverridden
          ? 'text-daz-green'
          : structureLocked
            ? 'text-muted-foreground'
            : ''
        return (
          // Each section is its own wrapper on purpose: position:sticky constrains
          // the title to its parent, which is exactly what makes the NEXT section's
          // title push the previous one out (iOS-contacts style) instead of stacking.
          <div
            key={section}
            // A disabled section dims — UNLESS it's a per-scene override (a scene that
            // turned it off IS overriding it), which reads as active (full opacity, the
            // green title / label / toggle stay fully visible).
            className={`rounded-lg border ${effectiveEnabled || sectionOverridden ? '' : 'opacity-60'}`}
          >
            {/* Sticky section title: pins right below the character page's collapsed
                sticky header via `--sticky-header-h` (published live by EditorHeader,
                since the header's collapsed height is dynamic — a hardcoded px drifts
                as the design changes). z below its z-10. Solid bg so rows can't show
                through; rounded-t so the bg doesn't square out the card's top corners
                at rest. NB: the ancestor `contain: layout paint` re-scopes
                position:fixed but NOT sticky (sticky binds to the scrollport, which
                containment doesn't create), and no ancestor up to the page scroller
                has overflow. */}
            <div
              className="sticky z-[5] flex cursor-pointer items-center gap-3 rounded-t-lg bg-background px-4 py-3 select-none"
              style={{ top: 'calc(var(--sticky-header-h, 128px) + var(--override-bar-h, 0px))' }}
              // The WHOLE header row toggles the accordion, not just the title
              // button — except the interactive children (the accordion button
              // handles itself, the Switch and OverrideMark do their own thing)
              // and the summary text beside the Switch (`data-accordion-ignore`):
              // it hugs the toggle, so a slight miss there must not flip the
              // accordion under the pointer. The real <button> below stays the
              // accessible control (focus, Enter/Space, aria-expanded) — this
              // handler only enlarges the pointer target.
              onClick={(e) => {
                if ((e.target as Element).closest('button, [role="switch"], [data-accordion-ignore]'))
                  return
                setOpen((o) => ({ ...o, [section]: !isOpen }))
              }}
            >
              {/* A real accordion BUTTON (was a click-only div): the core editing
                  surface must be focusable and Enter/Space-operable, and announce
                  its state via aria-expanded. The Switch stays OUTSIDE it — a
                  nested interactive control would be invalid HTML. */}
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [section]: !isOpen }))}
                className="flex min-w-0 cursor-pointer items-center gap-3 text-left"
              >
                <ChevronRight
                  className={`size-4 shrink-0 transition-transform ${sectionOverridden ? 'text-daz-green' : 'text-muted-foreground'} ${isOpen ? 'rotate-90' : ''}`}
                />
                <span className={`w-12 font-mono text-sm font-semibold ${headText}`}>
                  {section}
                </span>
                <span className={`font-medium ${headText}`}>{SECTION_LABELS[section]}</span>
                {missingPresetAsset && (
                  <span
                    className="rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive"
                    title={`The installed DTH release ships no ${SECTION_LABELS[section]} preset for ${genesis} — generation will fail. Disable this section or switch it to a custom asset.`}
                  >
                    no {genesis} asset
                  </span>
                )}
              </button>
              {/* The scene-gated (GEN) enable rules — an always-visible "i" beside
                  the title instead of tooltips hidden on the disabled Switch. A
                  SIBLING of the accordion button (nested buttons are invalid), and
                  the header's row-click handler already ignores buttons. */}
              {enableGated && (
                <InfoPopup label={`${SECTION_LABELS[section]} — more information`} className="-my-1">
                  Enabled automatically when the primary Daz scene contains a Golden Palace /
                  Dicktator geograft. Every scene must contain the same geograft (GP/DK) as the
                  primary scene — the content can still be overridden per scene.
                </InfoPopup>
              )}
              {/* Per-scene section override marker — sits at the END of the section
                  TITLE (right after the label), and is a SIBLING of the accordion
                  button (never nested: a button inside a button is invalid HTML). It
                  goes green whenever the section diverges from the primary scene's ROM
                  — a per-row value edit, an added frame, or a whole-section escalation
                  — and its reset clears every override kind for the section at once,
                  restoring the primary scene's ROM. */}
              {showSectionMark && (
                <OverrideMark
                  overridden={sectionOverridden}
                  resetTitle="Reset this section to the primary scene's ROM"
                  onReset={() => {
                    if (!overrideData || !onOverrideChange) return
                    // Drop the section's WHOLE rom entry — sparse rows, owned
                    // config and enable overlay all live at that one key now.
                    // JCM also drops the per-scene "Modify frames" rules.
                    const rom = { ...overrideData.rom }
                    delete rom[section]
                    onOverrideChange({
                      ...overrideData,
                      rom,
                      jcm: section === 'JCM' ? undefined : overrideData.jcm,
                    })
                  }}
                />
              )}
              {/* The section summary now floats right on its own (was inside the button)
                  so the override mark can hug the title. ml-auto pushes it + the Switch
                  to the right edge. */}
              <span
                data-accordion-ignore
                className={`ml-auto cursor-default text-xs ${sectionOverridden ? 'text-daz-green' : 'text-muted-foreground'}`}
              >
                {tiedToJcm
                  ? effectiveEnabled
                    ? 'enabled with JCM'
                    : 'disabled with JCM'
                  : sectionSummary(displaySections[section])}
              </span>
              {/* A direct flex child of the items-center row so it centers on the
                  summary text's line. (Wrapped in a bare <span> it blockified as a
                  flex item, and the switch rode that span's text baseline — a hair
                  high.) It stays a SIBLING of the button, never nested — a control
                  inside a button is invalid HTML. */}
              <Switch
                checked={effectiveEnabled}
                // Once the scene flips this section's on/off state, the toggle wears
                // the override green like every other overridden boolean on the form
                // (a green track when on, a light-green knob when off-but-overridden).
                variant={enabledOverridden ? 'green' : 'default'}
                disabled={tiedToJcm || locked || enableGated}
                title={
                  tiedToJcm
                    ? 'The retargeting poses are part of the JCM base ROM — controlled by the JCM section'
                    : // Scene-gated (GEN): the enable rules live in the "i" popup on
                      // the section title now — no tooltip on the disabled Switch.
                      !enableGated && overrideData
                      ? // On a non-primary scene the toggle is a per-scene override —
                        // same hint the other overridable fields' mark carries, not a
                        // verbose per-scene enable/disable line.
                        'Can be overridden per Daz scene'
                      : // Primary scene: the on/off label next to it already says it —
                        // no redundant native tooltip on the switch.
                        undefined
                }
                onCheckedChange={(enabled) => {
                  // Scene-gated sections never toggle by hand (backstop — the
                  // switch is disabled; jsdom/dispatched events still land here).
                  if (enableGated) return
                  // On a non-primary scene the toggle is a per-scene override: flip the
                  // MERGED on/off state (mode/groups stay the base's).
                  if (overrideData) {
                    onSectionEnabledChange(section, enabled)
                    return
                  }
                  // Base (primary) toggle. Enabling picks the sensible mode: no preset
                  // asset for this generation → straight to the custom morph list; preset
                  // available and the section untouched (no custom groups yet) → preset. A
                  // section the user already put groups into keeps its mode — a deliberate
                  // choice, not a default.
                  if (enabled && !presetAvailable && config.mode === 'preset' && modes.includes('custom')) {
                    patchSection(section, { enabled, mode: 'custom' })
                  } else if (
                    enabled &&
                    presetAvailable &&
                    config.mode === 'custom' &&
                    config.groups.length === 0 &&
                    modes.includes('preset')
                  ) {
                    patchSection(section, { enabled, mode: 'preset' })
                  } else {
                    patchSection(section, { enabled })
                  }
                }}
              />
            </div>

            {isOpen && (
              // The BODY dims when the section is off: for a plain disabled section the
              // whole wrapper already dims (above); for a disabled OVERRIDE the wrapper
              // stays full (so the green title / label / toggle read active) and we dim
              // just the content here instead. A disabled section's content is READ-ONLY:
              // the native fieldset disable kills every edit control inside — fields,
              // checkboxes, selects, add/remove buttons — and the cursor reads forbidden
              // throughout. Disabled buttons still RECEIVE pointer events in Chromium
              // (only click/activation is suppressed), so dnd-kit's pose drag handles
              // would happily start a reorder from a disabled section — the explicit
              // `[&_button]:pointer-events-none` closes that hole (the forbidden cursor
              // survives: a pointer-events-none element takes its ancestor's cursor).
              // The enable toggle lives in the HEADER, outside this fieldset, so turning
              // the section back on (where allowed) is always reachable. `locked` (the
              // vestigial unarmed-override gate) behaves the same way.
              <fieldset
                disabled={locked || !effectiveEnabled}
                className={cn(
                  'space-y-3 border-t px-4 py-4',
                  (locked || (!effectiveEnabled && sectionOverridden)) && 'opacity-60',
                  (locked || !effectiveEnabled) &&
                    'cursor-not-allowed [&_*]:cursor-not-allowed [&_button]:pointer-events-none',
                )}
              >
                {modes.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Mode:</span>
                    <Select
                      value={mergedConfig.mode}
                      onValueChange={(value) =>
                        patchSectionForScene(section, { mode: value as SectionMode })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        // Green when this scene overrides the base mode.
                        className={cn(
                          'w-fit min-w-[12rem]',
                          overrideData &&
                            mergedConfig.mode !== config.mode &&
                            'border-daz-green focus:border-daz-green',
                        )}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="preset" disabled={!presetAvailable}>
                          {presetAvailable
                            ? 'Pre-defined DTH assets'
                            : `Pre-defined DTH assets — none for ${genesis}`}
                        </SelectItem>
                        <SelectItem value="custom">
                          {section === 'JCM' ? 'Custom JCM asset' : 'Custom morph list'}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {mergedConfig.mode === 'preset' ? (
                  // On a non-primary scene the preset SETUP is a per-scene override too
                  // (which asset, and GEN art direction): the controls bind to the MERGED
                  // config and edits route through patchSectionForScene, which escalates
                  // the section to an owned config. The green comes from the section-title
                  // handle (owning counts as overridden) + the fields' own green borders.
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {PRESET_DESCRIPTIONS[section] ?? 'Pre-defined DTH assets.'}
                    </p>
                    <PresetAssetPicker
                      section={section}
                      config={mergedConfig}
                      baseConfig={overrideData ? config : undefined}
                      genesis={genesis}
                      gender={gender}
                      skinning={skinning}
                      facEnabled={displaySections.FAC.enabled}
                      catalog={catalog}
                      onChange={(presetAssets) => patchSectionForScene(section, { presetAssets })}
                    />
                    {section === 'GEN' && (
                      <ArtDirectionEditor
                        config={mergedConfig}
                        baseConfig={overrideData ? config : undefined}
                        sections={displaySections}
                        gender={gender}
                        presetFrames={presetFrames}
                        onChange={(artDirection) => patchSectionForScene(section, { artDirection })}
                      />
                    )}
                  </div>
                ) : section === 'JCM' ? (
                  // Custom JCM asset: a user-supplied .duf path used as the base
                  // ROM, just like a pre-defined DTH asset. Overridable per scene too.
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Point to a custom JCM pose preset (.duf). It's loaded as the base ROM exactly
                      like a pre-defined DTH asset.
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Path:</span>
                      <Input
                        className="max-w-xl"
                        value={mergedConfig.customAssetPath}
                        placeholder="C:\…\My Custom JCM.duf"
                        overridden={!!overrideData && mergedConfig.customAssetPath !== config.customAssetPath}
                        onChange={(e) => patchSectionForScene(section, { customAssetPath: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={async () => {
                          const picked = await pickDufPath('Select a custom JCM pose preset (.duf)')
                          if (picked) patchSectionForScene(section, { customAssetPath: picked })
                        }}
                      >
                        <FolderOpen /> Browse
                      </Button>
                    </div>
                  </div>
                ) : !GROUPED_SECTIONS.includes(section) ? (
                  // FBM/MISC are flat lists in the PoseAsset node — exactly
                  // one implicit group, no group management.
                  <div className="space-y-3">
                    <PoseGroupsEditor
                      section={section}
                      groups={editorGroups.length > 0 ? editorGroups : flatGroupFallback(section)}
                      gender={gender}
                      startFrames={startFrames}
                      failedFrames={failedFrames}
                      removable={false}
                      override={editorOverride}
                      locked={locked}
                      onGroupsChange={onSectionGroupsChange}
                    />
                    {/* CSV import — on a non-primary scene it imports into the scene's own
                        section (escalates), same as adding frames. */}
                    <div className="my-4 flex gap-2">
                      <ImportCsvButton onImport={() => setPickerSection(section)} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        disabled={!editorGroups.some((group) => group.poses.length > 0)}
                        onClick={() => setClearRequest({ section })}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <PoseGroupsEditor
                      section={section}
                      groups={editorGroups}
                      gender={gender}
                      startFrames={startFrames}
                      failedFrames={failedFrames}
                      removable
                      override={editorOverride}
                      locked={locked}
                      onGroupsChange={onSectionGroupsChange}
                    />
                    {/* Add group / Import edit whatever the editor owns — the base on the
                        primary, the scene's owned section once it escalates (Add group /
                        an import IS a structural edit, so it escalates). Available on a
                        non-primary scene too, so an outfit can build up its own section. */}
                    <div className="my-4 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onSectionGroupsChange(section, [
                            ...editorGroups,
                            {
                              id: newId(),
                              label: '',
                              suffix: 'centre',
                              method: 'default',
                              calculateFrom: 'default',
                              poses: [],
                            },
                          ])
                        }
                      >
                        <Plus /> Add group
                      </Button>
                      <ImportCsvButton onImport={() => setPickerSection(section)} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        disabled={editorGroups.length === 0}
                        onClick={() => setClearRequest({ section })}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                )}

                {/* Optional bone-rotation morph drives along the JCM ROM — the grid UI
                    over jcmMorphMods (works with a preset OR a custom base ROM; the runtime
                    applies it after either). Overridable per scene: on a non-primary scene
                    it edits the scene's own `jcm` override (armed when it differs from base). */}
                {section === 'JCM' && jcmMorphMods && onJcmMorphModsChange && (
                  <div className="mt-5 border-t pt-5">
                    <JcmModsGrid
                      mods={overrideData?.jcm ?? jcmMorphMods}
                      onChange={overrideData ? onJcmModsForScene : onJcmMorphModsChange}
                      boneIndex={boneIndex}
                      onClear={() => setClearRequest({ section, rules: true })}
                    />
                  </div>
                )}
              </fieldset>
            )}
          </div>
        )
      })}
      {pickerSection && (
        <ScanCsvPickerDialog
          sectionLabel={SECTION_LABELS[pickerSection]}
          onPick={(path) => void loadCsv(pickerSection, path)}
          onBrowse={() => void browseCsv(pickerSection)}
          onClose={() => setPickerSection(null)}
        />
      )}
      {pendingCsv && (
        <CsvImportDialog
          sectionLabel={SECTION_LABELS[pendingCsv.section]}
          frames={pendingCsv.poses.map((pose) => pose.frame)}
          onConfirm={applyCsvImport}
          onClose={() => setPendingCsv(null)}
        />
      )}
      {clearRequest && (
        <Modal
          open
          onClose={() => setClearRequest(null)}
          title={
            clearRequest.rules
              ? 'Clear all rules?'
              : `Clear ${SECTION_LABELS[clearRequest.section]}?`
          }
        >
          <p className="text-sm text-muted-foreground">
            {clearRequest.rules
              ? 'This removes every “Modify JCM frames” rule with all its morph drives.'
              : `This removes the entire custom definition of the ${SECTION_LABELS[clearRequest.section]} section — every group and frame.`}{' '}
            Nothing is saved until you save the character.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="mr-auto" onClick={() => setClearRequest(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onClearConfirmed}>
              Clear
            </Button>
          </div>
        </Modal>
      )}
    </div>
    </FigureNodeContext.Provider>
    </MorphIndexProvider>
  )
})
