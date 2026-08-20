/**
 * The Houdini utils drawer's shared vocabulary: the per-section labels, the
 * per-kind tab metadata, and the small helpers and types that both the drawer
 * itself (`houdini-utils-panel.tsx`) and its presentational parts
 * (`parts.tsx`) speak.
 *
 * Split out of the panel so that editing one report no longer means opening the
 * whole drawer — nothing here changed in the move.
 */
import { toast } from 'sonner'

import {
  GROOM_OCCLUSION_SECTIONS,
  OCCLUSION_SECTIONS,
  SKELETON_SECTIONS,
} from '#/lib/rom/api.ts'
import type {
  GroomOcclusionSection,
  MaterialNodeInfo,
  MaterialScanProject,
  MaterialSection,
  MaterialSlotInfo,
  MaterialUtilReport,
  NodeKind,
  OcclusionSection,
  SkeletonSection,
} from '#/lib/rom/api.ts'
import { normalizePath, normalizePathLower } from '#/lib/path.ts'

/** Label + rationale for each transferable part of a skeleton setup. The
 *  sections are the node's own tabs, so they read the same here as in Houdini. */
export const SKELETON_LABELS: Record<SkeletonSection, { label: string; hint: string }> = {
  general: {
    label: 'General',
    hint: 'Source/target skeleton, reference frame and the root/neck/twist options.',
  },
  skeleton: {
    label: 'Skeleton',
    hint: 'Bone simplification, procedural physics bones, and the manual rename / reparent / delete rules.',
  },
  skinWeights: {
    label: 'Skin Weights',
    hint: 'The skin-weight operations and their settings.',
  },
}

/** Label + rationale for each transferable part of a material setup. */
export const SECTION_LABELS: Record<MaterialSection, { label: string; hint: string }> = {
  materials: {
    label: 'Material slots',
    hint: 'Which Daz surfaces merge into each material — the list a baker names.',
  },
  uvChannels: {
    label: 'UV channels',
    hint: 'The channels baker layers read (uv_original, uv_geoshell) and their operations.',
  },
  bakers: { label: 'Texture bakers', hint: 'The bakers themselves and all their layers.' },
}

export const OCCLUSION_LABELS: Record<OcclusionSection, { label: string; hint: string }> = {
  visualise: {
    label: 'Visualise',
    hint: "The node's own viewport display — what it draws while you work, not what it exports.",
  },
  culling: {
    label: 'Occlusion Culling',
    hint: 'The substance: the manual occlusion attributes and the Auto-Occlusion operation list.',
  },
}

export const GROOM_OCCLUSION_LABELS: Record<GroomOcclusionSection, { label: string; hint: string }> = {
  visualise: {
    label: 'Visualise',
    hint: "The node's own viewport display — what it draws while you work, not what it exports.",
  },
  options: { label: 'Options', hint: 'The groom-occlusion options block.' },
  skin: { label: 'Skin', hint: 'Which skin the groom is occluded against.' },
  occlusionMask: { label: 'Occlusion Mask', hint: 'The mask that decides what the groom hides.' },
  textureStamp: { label: 'Texture Stamp', hint: 'The texture-stamp settings.' },
}

/**
 * The kinds whose sections are whole FOLDERS, copied as subtrees — everything
 * except `material`, whose sections are lists that merge by name and which
 * carries its own picker, replace mode and interdependency warnings.
 *
 * One registry so the tab, the checkbox list, the confirm summary and the
 * report all read the same place: adding the next DTH node of this shape is an
 * entry here plus its twin in material_utils.py's FOLDER_KINDS.
 */
export type FolderKind = Exclude<NodeKind, 'material'>

export const FOLDER_KIND_UI: Record<
  FolderKind,
  {
    /** Tab label. */
    tab: string
    sections: ReadonlyArray<string>
    labels: Record<string, { label: string; hint: string }>
    /** Sentence subject for the wholesale note, ARTICLE INCLUDED — English
     *  needs "An occlusion" and "A skeleton", which no template gets right. */
    sectionPhrase: string
    /** The tab's own one-paragraph "what this does". The material node's blurb
     *  used to be printed on every transfer tab. */
    blurb: string
  }
> = {
  skeleton: {
    tab: 'Skeleton',
    sections: SKELETON_SECTIONS,
    labels: SKELETON_LABELS,
    // The article rides along: "A occlusion section" was the alternative.
    sectionPhrase: 'A skeleton section',
    blurb:
      "Copy a skeleton node's setup — bone renames, reparents, physics bones and skin weights — onto this character's skeleton nodes. Daz bone names are fixed per generation, so the block transfers between characters of that generation.",
  },
  occlusion: {
    tab: 'Occlusion',
    sections: OCCLUSION_SECTIONS,
    labels: OCCLUSION_LABELS,
    sectionPhrase: 'An occlusion section',
    blurb:
      "Copy an occlusion node's setup onto this character's occlusion nodes — the manual occlusion attributes and the Auto-Occlusion operation list. The dry run lists exactly what would change before anything is written.",
  },
  groomOcclusion: {
    tab: 'Groom occlusion',
    sections: GROOM_OCCLUSION_SECTIONS,
    labels: GROOM_OCCLUSION_LABELS,
    sectionPhrase: 'A groom-occlusion section',
    blurb:
      "Copy a groom-occlusion node's setup onto this character's groom-occlusion nodes — its options, skin, occlusion mask and texture stamp. The dry run lists exactly what would change before anything is written.",
  },
}

export const FOLDER_KINDS = Object.keys(FOLDER_KIND_UI) as ReadonlyArray<FolderKind>

export function isFolderKind(kind: NodeKind): kind is FolderKind {
  return kind !== 'material'
}

/** A section's label wherever it comes from — the report mixes kinds. */
export function sectionLabel(key: string): string {
  for (const labels of [
    SECTION_LABELS as Record<string, { label: string }>,
    SKELETON_LABELS as Record<string, { label: string }>,
    OCCLUSION_LABELS as Record<string, { label: string }>,
    GROOM_OCCLUSION_LABELS as Record<string, { label: string }>,
  ]) {
    if (labels[key]) return labels[key].label
  }
  return key
}

/**
 * Every outcome this drawer reports STAYS until it is dismissed.
 *
 * These are not "saved ✓" confirmations: each one is the result of a run that
 * took hython tens of seconds and wrote to the user's projects — which is
 * exactly the stretch during which nobody is watching this window. A toast that
 * times out while the user is in Houdini, or making coffee, loses the only
 * summary of what a transfer/repair/repath actually did. (The panel keeps a
 * fuller report behind it, but only for the action just run, and only while the
 * drawer stays open.)
 *
 * Same treatment for errors: a failure that scrolls past unseen is worse than a
 * success that does.
 *
 * A caller can pass its own `duration` to opt out, and one does: the backup
 * cleanup on drawer close, which reports pure housekeeping rather than the
 * result of a run.
 */
export const utilsToast = {
  success: (message: string, options?: Parameters<typeof toast.success>[1]) =>
    toast.success(message, { duration: Infinity, ...options }),
  error: (message: string, options?: Parameters<typeof toast.error>[1]) =>
    toast.error(message, { duration: Infinity, ...options }),
}

/**
 * How long the one opted-out drawer toast lives.
 *
 * The value is sonner's own default, stated here rather than borrowed: the
 * exception belongs next to the rule it opts out of, and a house-wide default
 * on `<Toaster>` would otherwise move every toast in the app EXCEPT this one.
 */
export const TRANSIENT_TOAST_MS = 4000

/** A material node identified across files — the selection key everywhere here. */
export function nodeKey(hipPath: string, nodePath: string): string {
  return `${normalizePath(hipPath).toLowerCase()}|${nodePath}`
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** The card-title form of a Houdini project path: file name, extension off —
 *  the same reading the project card's heading gives, so the source picker
 *  and the cards name a project identically. */
export function hipStem(path: string): string {
  const name = fileName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Up to this many studio Houdini projects, the source picker lists them FLAT
 *  (one entry per project); above it, the list would scroll past usefulness,
 *  so it switches to the two-level character → project layout. */
export const FLAT_SOURCE_LIMIT = 15

/** The source slots a run will actually install — every one when none is picked. */
export function pickedSlots(
  node: MaterialNodeInfo,
  picked: ReadonlySet<string>,
): Array<MaterialSlotInfo> {
  return picked.size === 0 ? node.slots : node.slots.filter((s) => picked.has(s.name))
}

/**
 * How much a section will actually copy — shown beside each checkbox and in the
 * confirm dialog. Honours the picked materials: with `Skin` ticked this must
 * say "1 slot, 4 bakers", not the node's totals, or the dialog would promise
 * something the run doesn't do. UV channels are node-wide (they are anonymous
 * and positional), so they never narrow.
 */
export function sectionCountOf(
  node: MaterialNodeInfo,
  key: MaterialSection,
  picked: ReadonlySet<string>,
): string {
  const slots = pickedSlots(node, picked)
  const n =
    key === 'materials'
      ? picked.size === 0
        ? node.materials
        : slots.length
      : key === 'uvChannels'
        ? node.uvChannels
        : picked.size === 0
          ? node.bakers
          : slots.reduce((sum, s) => sum + s.bakers, 0)
  const unit = key === 'materials' ? 'slot' : key === 'uvChannels' ? 'channel' : 'baker'
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/**
 * How a material node is labelled in the picker.
 *
 * A project with several DTH networks names them with a NETWORK BOX around each
 * (`KiraDefault`, `KiraYoga`, `KiraNaked`); the nodes inside are only ever
 * `DazToHueMaterial`, `…1`, `…2`, which tells the user nothing about which
 * network they're picking. So the box title leads when there is one, with the
 * node name kept beside it — the node name is still what the report and any
 * Houdini-side lookup use.
 */
export function nodeLabel(node: MaterialNodeInfo): { primary: string; secondary: string } {
  return node.networkBox
    ? { primary: node.networkBox, secondary: node.name }
    : { primary: node.name, secondary: '' }
}

/**
 * The drawer's tabs. `general` acts on the project FILES themselves — the
 * per-project Houdini settings the studio knows the right value for; the other
 * two transfer a NODE KIND between projects.
 *
 * `general` leads and opens first: it is the tab that answers "is this project
 * healthy?", it needs no second project picked to be useful, and every one of
 * its findings comes free with the scan the drawer runs anyway.
 */
export type DrawerTab = NodeKind | 'general'

/** The file-level actions of the General tab. One report slot is shared between
 *  them — see {@link ActionReport}.
 *
 *  The first three are FIXES: each has a check that detected it and goes quiet
 *  once it passes. `refresh` is not — nothing in a scanned project reveals
 *  whether its DazToHue assets are stale, so it is always on offer and never
 *  counted among the fixes. */
export type GeneralAction = 'defaults' | 'repath' | 'prefill' | 'refresh'

/**
 * The result of the last General-tab action, and which one produced it.
 *
 * ONE slot, not one per action: three reports stacked below the project cards
 * was the tab's worst noise — each repeating the same file names, two of them
 * describing runs the user had already read and moved on from.
 */
export interface ActionReport {
  kind: GeneralAction
  report: MaterialUtilReport
}

/** One project a run backed up, and whether that run left it in a good state. */
export interface RunBackup {
  hipPath: string
  backupPath: string
  ok: boolean
}

/**
 * The backups a report says are now on disk, across all four operations.
 *
 * `backupPath` is empty for a dry run and for an entry that changed nothing, so
 * this is exactly "what a real run wrote a copy of". A transfer reports one
 * entry per NODE and several nodes share a file — the caller keys by `hipPath`,
 * which is also what the Python's rolling `_backup` does.
 */
export function backupsIn(report: MaterialUtilReport): Array<RunBackup> {
  const rows: Array<RunBackup> = [
    ...report.targets,
    ...report.defaults,
    ...report.repath,
    ...report.prefill,
    ...report.refresh,
  ].map(({ hipPath, backupPath, ok }) => ({ hipPath, backupPath, ok }))
  return rows.filter((row) => row.backupPath !== '')
}

/**
 * The revert offer the reports share.
 *
 * A backup is taken before every real save and never mentioned while things
 * work. It surfaces exactly once — beside an entry that FAILED — because that
 * is the only moment it is worth anything.
 */
export interface RestoreProps {
  /** The `.hip` being restored right now, '' when idle. */
  busy: string
  /** Files already put back this session — the offer becomes a confirmation. */
  done: ReadonlySet<string>
  onRestore: (hipPath: string, backupPath: string) => void
}

/** A scan result plus the request that produced it, so a stale list is never
 *  shown against a changed selection. */
export interface ScanState {
  loading: boolean
  error: string
  projects: Array<MaterialScanProject>
}

export const EMPTY_SCAN: ScanState = { loading: false, error: '', projects: [] }

/** The "Character from the studio…" source picker's candidate list: every
 *  character that still has a Houdini project to offer — the CURRENT character
 *  included, so a setup can be copied between two of its own projects. What
 *  gets taken out is the drawer's own TARGET project, from every candidate's
 *  list (copying a project onto itself is refused by the api anyway, and
 *  offering it invites the mistake). The current character sorts first: its
 *  other projects are the closest-at-hand source. */
export function sourceCharacterCandidates<
  C extends { id: string; houdiniProjects: Array<string> },
>(all: Array<C>, currentCharacterId: string, targetHip: string): Array<C> {
  const targetKey = normalizePathLower(targetHip)
  return all
    .map((c) => ({
      ...c,
      houdiniProjects: c.houdiniProjects.filter((hip) => normalizePathLower(hip) !== targetKey),
    }))
    .filter((c) => c.houdiniProjects.length > 0)
    .sort((a, b) => Number(b.id === currentCharacterId) - Number(a.id === currentCharacterId))
}
