import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  FolderOpen,
  Loader2,
  RefreshCw,
  Route,
  Trash2,
  Undo2,
  Wand2,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  Button,
  InfoPopup,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SidePanel,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@dth/ui'
import {
  MATERIAL_SECTIONS,
  SKELETON_SECTIONS,
  prefillHoudiniNetwork,
  repairHoudiniDefaults,
  repathHoudiniReferences,
  discardHoudiniBackups,
  restoreHoudiniBackup,
  fetchCachedHoudiniScans,
  scanCharacterHoudiniProjects,
  scanHoudiniMaterials,
  transferHoudiniMaterials,
} from '#/lib/rom/api.ts'
import { defaultsRowsFor, planRepath, projectsNeedingRepair } from '#/lib/rom/houdini-defaults.ts'
import type {
  CharacterWithProject,
  MaterialNodeInfo,
  MaterialScanProject,
  MaterialSection,
  MaterialSlotInfo,
  MaterialUtilReport,
  NodeKind,
  ProjectPrefillInfo,
  SkeletonSection,
} from '#/lib/rom/api.ts'
import { fetchAllCharacters, listAssets } from '#/lib/rom/api.ts'
import {
  isFigureMismatch,
  mergeTouchCount,
  planSurfaceMerge,
  surfaceLabel,
} from '#/lib/rom/houdini-material-merge.ts'
import type { SurfaceMergePlan } from '#/lib/rom/houdini-material-merge.ts'
import type { DazAsset } from '#/lib/rom/storage.ts'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { pickHipPath } from '#/lib/desktop.ts'
import { displayPath, normalizePath, parentDir } from '#/lib/path.ts'
import type { Character } from '@dth/rom'

/**
 * The Houdini card's "Utils" drawer — per-project tools that need Houdini itself
 * to answer, so each one runs hython behind `lib/rom/api/houdini-material.ts`.
 *
 * Tab 1 ("Copy from") is the texture-baker transfer: pick ONE source material
 * node (from another character's project, or any `.hip` on disk) and copy its
 * bakers onto one or more of THIS character's material nodes. The tab shape is
 * deliberate — the same drawer is where the next material utility lands.
 *
 * Why a transfer is worth a feature: a skin setup measured on a real project is
 * 4 bakers of 30 layers, each layer naming a texture, a group, a blend mode and
 * seven adjustments. Reproducing that by hand for every character is the tedium
 * this replaces.
 */

/** Label + rationale for each transferable part of a skeleton setup. The
 *  sections are the node's own tabs, so they read the same here as in Houdini. */
const SKELETON_LABELS: Record<SkeletonSection, { label: string; hint: string }> = {
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
const SECTION_LABELS: Record<MaterialSection, { label: string; hint: string }> = {
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

/** A material node identified across files — the selection key everywhere here. */
function nodeKey(hipPath: string, nodePath: string): string {
  return `${normalizePath(hipPath).toLowerCase()}|${nodePath}`
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** The source slots a run will actually install — every one when none is picked. */
function pickedSlots(
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
function sectionCountOf(
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
function nodeLabel(node: MaterialNodeInfo): { primary: string; secondary: string } {
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
type DrawerTab = NodeKind | 'general'

/** The three file-level actions of the General tab. One report slot is shared
 *  between them — see {@link ActionReport}. */
type GeneralAction = 'defaults' | 'repath' | 'prefill'

/**
 * The result of the last General-tab action, and which one produced it.
 *
 * ONE slot, not one per action: three reports stacked below the project cards
 * was the tab's worst noise — each repeating the same file names, two of them
 * describing runs the user had already read and moved on from.
 */
interface ActionReport {
  kind: GeneralAction
  report: MaterialUtilReport
}

/** One project a run backed up, and whether that run left it in a good state. */
interface RunBackup {
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
function backupsIn(report: MaterialUtilReport): Array<RunBackup> {
  const rows: Array<RunBackup> = [
    ...report.targets,
    ...report.defaults,
    ...report.repath,
    ...report.prefill,
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
interface RestoreProps {
  /** The `.hip` being restored right now, '' when idle. */
  busy: string
  /** Files already put back this session — the offer becomes a confirmation. */
  done: ReadonlySet<string>
  onRestore: (hipPath: string, backupPath: string) => void
}

/** A scan result plus the request that produced it, so a stale list is never
 *  shown against a changed selection. */
interface ScanState {
  loading: boolean
  error: string
  projects: Array<MaterialScanProject>
}

const EMPTY_SCAN: ScanState = { loading: false, error: '', projects: [] }


export function HoudiniUtilsPanel({
  open,
  onClose,
  character,
  /** The card the panel was opened from — its nodes start selected. */
  initialHipPath,
  /** The owning project — used to offer its Houdini template attachments. */
  projectId,
  /** The character's own folder — what `$JOB` should be (v0.64). */
  charFolder = '',
}: {
  open: boolean
  onClose: () => void
  character: Character
  initialHipPath?: string
  projectId?: string
  charFolder?: string
}) {
  // --- target side: this character's own projects ---------------------------
  const targets = character.houdiniProjects
  const [targetScan, setTargetScan] = useState<ScanState>(EMPTY_SCAN)
  const [selectedTargets, setSelectedTargets] = useState<ReadonlySet<string>>(new Set())

  // --- source side ---------------------------------------------------------
  const [sourceMode, setSourceMode] = useState<'studio' | 'browse'>('studio')
  /** The project's Houdini TEMPLATE attachments — the whole point of keeping
   *  them: "copy from G9 Skin Base" instead of locating a file. */
  const [templates, setTemplates] = useState<Array<DazAsset>>([])
  const [others, setOthers] = useState<Array<CharacterWithProject>>([])
  const [sourceCharacterId, setSourceCharacterId] = useState('')
  const [sourceHip, setSourceHip] = useState('')
  const [browsedHip, setBrowsedHip] = useState('')
  const [sourceScan, setSourceScan] = useState<ScanState>(EMPTY_SCAN)
  const [selectedSource, setSelectedSource] = useState('')

  // --- what to copy --------------------------------------------------------
  // All three by default: the parts are one setup, and bakers alone reference
  // material and UV-channel names that would not exist at the target.
  const [sections, setSections] = useState<ReadonlySet<MaterialSection>>(
    new Set(MATERIAL_SECTIONS),
  )
  /** Which drawer tab is open. `general` acts on the project FILES themselves
   *  and has no node list; the other two pick a NODE KIND to transfer. */
  const [tab, setTab] = useState<DrawerTab>('general')
  const kind: NodeKind = tab === 'skeleton' ? 'skeleton' : 'material'
  const [skelSections, setSkelSections] = useState<ReadonlySet<SkeletonSection>>(
    new Set(SKELETON_SECTIONS),
  )
  // Which of the source's material slots to copy. Empty = all; reset whenever
  // the source node changes, since slot names belong to that node.
  const [pickedMaterials, setPickedMaterials] = useState<ReadonlySet<string>>(new Set())

  // --- the confirm modal ---------------------------------------------------
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [replace, setReplace] = useState(false)
  // ON by default: texture layers store absolute paths into the Daz library, and
  // a copy that keeps them pinned breaks the moment the library moves or the
  // project opens on another machine. Off reproduces the source verbatim.
  const [useLibVar, setUseLibVar] = useState(true)
  // WHICH action is running, not merely that one is: with a shared flag both
  // buttons spin, so a dry run looks exactly like the destructive one.
  const [running, setRunning] = useState<'' | 'dry' | 'run'>('')
  const busy = running !== ''
  const [report, setReport] = useState<MaterialUtilReport | null>(null)

  // --- the General tab -----------------------------------------------------
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [repathOpen, setRepathOpen] = useState(false)
  const [prefillOpen, setPrefillOpen] = useState(false)
  /** The last file-level action's result — one slot for all three (see
   *  {@link ActionReport}), so a fresh run replaces the previous answer instead
   *  of stacking another panel below it. */
  const [actionReport, setActionReport] = useState<ActionReport | null>(null)

  // --- reverting a failed run ----------------------------------------------
  /** The `.hip` currently being restored, '' when idle. */
  const [restoring, setRestoring] = useState('')
  /** Files already put back — a second click would restore the same bytes
   *  again, so the offer turns into a statement instead. */
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set())

  // --- the session's backups -----------------------------------------------
  /**
   * What this sitting left on disk: `hipPath` → its backup file.
   *
   * A backup is an undo buffer for the drawer, not an archive — one full copy
   * of the project per file a run touched, ~8 MB each, and nothing else in the
   * app collects them. Keyed by project because `_backup` is rolling: a second
   * run replaces the first, so remembering both would offer to delete a path
   * that is no longer there.
   */
  const [sessionBackups, setSessionBackups] = useState<ReadonlyMap<string, string>>(new Map())
  /** Projects whose last run FAILED and has not been undone — the only case
   *  where a backup is still worth something on the way out. */
  const [unresolved, setUnresolved] = useState<ReadonlySet<string>>(new Set())
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)

  const targetsKey = targets.join('|')

  async function runScan(
    hipPaths: Array<string>,
    set: (next: ScanState) => void,
  ): Promise<Array<MaterialScanProject>> {
    if (hipPaths.length === 0) {
      set(EMPTY_SCAN)
      return []
    }
    set({ loading: true, error: '', projects: [] })
    try {
      const projects = await scanHoudiniMaterials({ data: { hipPaths } })
      set({ loading: false, error: '', projects })
      return projects
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ loading: false, error: message, projects: [] })
      return []
    }
  }

  /**
   * The character's own projects, READ from the store rather than scanned.
   *
   * The background sweep (`scanCharacterHoudiniProjects`) is the only thing that
   * scans them now, so the drawer opens instantly on whatever that left and
   * POLLS while it is still working — a sweep is always running by the time
   * anyone can click Utils, because the character page starts one on mount.
   * Polling stops as soon as anything arrives, or after the cap: a project the
   * sweep cannot scan (no Houdini configured) must not spin forever.
   */
  async function loadCachedTargets(): Promise<Array<MaterialScanProject>> {
    if (targets.length === 0) {
      setTargetScan(EMPTY_SCAN)
      return []
    }
    if (!projectId) return runScan(targets, setTargetScan)
    setTargetScan({ loading: true, error: '', projects: [] })
    // Nudge the sweep in case this drawer was reached without the page mounting
    // one (it coalesces, so an already-running sweep is joined, not doubled).
    void scanCharacterHoudiniProjects({ data: { projectId, id: character.id } })
    const cached = await fetchCachedHoudiniScans({ data: { projectId, id: character.id } })
    if (cached.length > 0) {
      setTargetScan({ loading: false, error: '', projects: cached })
      return cached
    }
    // Nothing stored yet. Scan HERE rather than waiting on the sweep: waiting is
    // only safe if a sweep is guaranteed to deliver, and it isn't — a project
    // outside the character folder is never swept, and a machine with no Houdini
    // configured never produces anything. The sweep still warms the store, so
    // the next open is the instant one.
    return runScan(targets, setTargetScan)
  }

  // Read the character's projects when the drawer opens. Opening a `.hip` costs
  // real seconds, so this deliberately does NOT re-run on every render — only on
  // open, on an explicit rescan, and when the linked set changes.
  useEffect(() => {
    if (!open) return
    void (async () => {
      const projects = await loadCachedTargets()
      // Preselect the card's own nodes — the panel was opened FROM that project.
      const from = initialHipPath
      if (!from) return
      const match = projects.find(
        (p) => normalizePath(p.hipPath).toLowerCase() === normalizePath(from).toLowerCase(),
      )
      if (match) {
        setSelectedTargets(new Set(match.nodes.map((n) => nodeKey(match.hipPath, n.path))))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetsKey, initialHipPath])

  // Candidate source characters: everything the studio can reach that actually
  // HAS a Houdini project, minus this character (copying onto itself is refused
  // by the api anyway, and offering it invites the mistake).
  // Templates are per project and only exist when attachments are enabled — an
  // empty list simply means the picker doesn't offer that route.
  useEffect(() => {
    if (!open || !projectId) return
    void listAssets({ data: { projectId } })
      .then((all) => setTemplates(all.filter((a) => a.kind === 'houdini-project')))
      .catch(() => setTemplates([]))
  }, [open, projectId])

  useEffect(() => {
    if (!open) return
    void fetchAllCharacters()
      .then((all) =>
        setOthers(all.filter((c) => c.id !== character.id && c.houdiniProjects.length > 0)),
      )
      .catch(() => setOthers([]))
  }, [open, character.id])

  // Reset everything when the drawer closes, so the next open starts clean.
  useEffect(() => {
    if (open) return
    setSelectedTargets(new Set())
    setSelectedSource('')
    setSourceHip('')
    setBrowsedHip('')
    setSourceScan(EMPTY_SCAN)
    setReport(null)
    setActionReport(null)
    setRestored(new Set())
    setSessionBackups(new Map())
    setUnresolved(new Set())
    setReplace(false)
  }, [open])

  const sourceCharacter = others.find((c) => c.id === sourceCharacterId)
  const activeSourceHip = sourceMode === 'browse' ? browsedHip : sourceHip

  // Scanning the chosen source project is a separate (and equally slow) trip —
  // only ever for the ONE file the user picked.
  // Slot names belong to a node, so a new source starts with none picked.
  useEffect(() => {
    setPickedMaterials(new Set())
  }, [selectedSource])

  useEffect(() => {
    setSelectedSource('')
    if (!open || !activeSourceHip) {
      setSourceScan(EMPTY_SCAN)
      return
    }
    void runScan([activeSourceHip], setSourceScan)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeSourceHip])

  async function onBrowse() {
    const picked = await pickHipPath(
      'Select a Houdini project (.hip) to copy from',
      parentDir(activeSourceHip || targets[0] || ''),
    )
    if (picked) {
      setSourceMode('browse')
      setBrowsedHip(picked)
    }
  }

  function toggleTarget(hipPath: string, nodePath: string) {
    const key = nodeKey(hipPath, nodePath)
    setSelectedTargets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // The selected source node, resolved back to its scan entry.
  const sourceNode = useMemo(() => {
    for (const project of sourceScan.projects) {
      for (const node of project.nodes) {
        if (nodeKey(project.hipPath, node.path) === selectedSource) {
          return { project, node }
        }
      }
    }
    return null
  }, [sourceScan, selectedSource])

  // Target refs for the transfer, minus the source node itself.
  const targetRefs = useMemo(() => {
    const refs: Array<{ hipPath: string; nodePath: string }> = []
    for (const project of targetScan.projects) {
      for (const node of project.nodes) {
        const key = nodeKey(project.hipPath, node.path)
        if (!selectedTargets.has(key)) continue
        if (key === selectedSource) continue
        refs.push({ hipPath: project.hipPath, nodePath: node.path })
      }
    }
    return refs
  }, [targetScan, selectedTargets, selectedSource])

  // Friendly name for any node the panel has scanned — the confirm dialog and
  // the report both name nodes, and a bare `/obj/DazToHue/DazToHueMaterial1`
  // reads as noise next to "KiraYoga".
  const labelFor = useMemo(() => {
    const byKey = new Map<string, MaterialNodeInfo>()
    for (const scan of [targetScan, sourceScan]) {
      for (const project of scan.projects) {
        for (const node of project.nodes) byKey.set(nodeKey(project.hipPath, node.path), node)
      }
    }
    return (hipPath: string, nodePath: string): string => {
      const node = byKey.get(nodeKey(hipPath, nodePath))
      if (!node) return nodePath
      const { primary, secondary } = nodeLabel(node)
      return secondary ? `${primary} (${secondary})` : primary
    }
  }, [targetScan, sourceScan])

  /** The sections the active tab will actually send. */
  const activeSections: Array<string> =
    kind === 'skeleton'
      ? SKELETON_SECTIONS.filter((key) => skelSections.has(key))
      : MATERIAL_SECTIONS.filter((key) => sections.has(key))

  /**
   * Materials whose bakers read a UV that only a UV CHANNEL produces
   * (`uv_geoshell`), while the channels are NOT being copied.
   *
   * This combination cannot work: those bakers would land pointing at a UV name
   * nothing at the target creates. It was previously an advisory note, which
   * let the user run a transfer already known to be broken — so it now blocks
   * the run instead. Only when bakers travel: without them there is no UV
   * dependency to satisfy.
   */
  const uvStarvedMaterials =
    kind === 'material' && sections.has('bakers') && !sections.has('uvChannels') && sourceNode
      ? sourceNode.node.slots.filter(
          (slot) =>
            slot.channelUvs.length > 0 &&
            (pickedMaterials.size === 0 || pickedMaterials.has(slot.name)),
        )
      : []

  /**
   * What installing the picked materials does to each target's OWN slots.
   *
   * Shown in the confirm dialog, before anything runs. A material slot is a
   * claim on Daz surfaces and a surface belongs to exactly one slot, so
   * installing `Skin` necessarily takes back the target's `Body`, `Head`,
   * `Legs`… — that is correct, and it is also the single most surprising thing
   * this tool does. The rule itself lives in `houdini-material-merge.ts`, the
   * twin of the Python that performs it, so this preview cannot drift from what
   * the run will actually write.
   */
  const mergePreview = useMemo((): Array<{
    hipPath: string
    nodePath: string
    plan: SurfaceMergePlan
  }> => {
    if (kind !== 'material' || !sections.has('materials') || !sourceNode) return []
    const incoming = pickedSlots(sourceNode.node, pickedMaterials)
    if (incoming.length === 0) return []
    const byKey = new Map<string, MaterialNodeInfo>()
    for (const project of targetScan.projects) {
      for (const node of project.nodes) byKey.set(nodeKey(project.hipPath, node.path), node)
    }
    return targetRefs.map((ref) => ({
      ...ref,
      plan: planSurfaceMerge(byKey.get(nodeKey(ref.hipPath, ref.nodePath))?.slots ?? [], incoming),
    }))
  }, [kind, sections, sourceNode, pickedMaterials, targetRefs, targetScan])

  /** Whether the replace switch has anything left to act on — it no longer
   *  governs material slots, so with only those selected it would be a control
   *  that does nothing. */
  const replaceApplies = sections.has('uvChannels') || sections.has('bakers')

  /**
   * Targets that describe a DIFFERENT FIGURE from the source.
   *
   * A material transfer only makes sense within one Genesis version, and this
   * is how that is checked without any generation knowledge: nothing the
   * selected materials claim exists at that target. Copying a Genesis 9 skin
   * onto a node built from another figure evicts nothing, installs slots naming
   * surfaces that aren't there, and leaves every baker baking nothing.
   *
   * Blocking rather than warning, for the same reason the UV-channel
   * dependency above blocks: an advisory let the user run a transfer already
   * known to be broken.
   */
  const mismatchedTargets = useMemo(() => {
    if (kind !== 'material' || !sourceNode) return []
    const incoming = pickedSlots(sourceNode.node, pickedMaterials)
    if (incoming.length === 0) return []
    const byKey = new Map<string, MaterialNodeInfo>()
    for (const project of targetScan.projects) {
      for (const node of project.nodes) byKey.set(nodeKey(project.hipPath, node.path), node)
    }
    return targetRefs.filter((ref) =>
      isFigureMismatch(byKey.get(nodeKey(ref.hipPath, ref.nodePath))?.slots ?? [], incoming),
    )
  }, [kind, sourceNode, pickedMaterials, targetRefs, targetScan])

  const canTransfer =
    sourceNode !== null &&
    targetRefs.length > 0 &&
    activeSections.length > 0 &&
    uvStarvedMaterials.length === 0 &&
    mismatchedTargets.length === 0 &&
    !busy
  const sourceHasBakers = (sourceNode?.node.bakers ?? 0) > 0

  async function run(dryRun: boolean) {
    if (!sourceNode) return
    setRunning(dryRun ? 'dry' : 'run')
    setReport(null)
    try {
      const result = await transferHoudiniMaterials({
        data: {
          nodeType: kind,
          source: { hipPath: sourceNode.project.hipPath, nodePath: sourceNode.node.path },
          targets: targetRefs,
          sections: activeSections,
          // Material-only knobs; the skeleton transfer copies wholesale and has
          // no texture paths of its own to make portable.
          materials: kind === 'material' ? [...pickedMaterials] : [],
          useLibVar: kind === 'material' ? useLibVar : false,
          replace: kind === 'material' ? replace : true,
          dryRun,
        },
      })
      setReport(result)
      if (!dryRun) {
        noteBackups(result)
        const failed = result.targets.filter((t) => !t.ok)
        if (failed.length > 0) {
          toast.error(
            `${failed.length} of ${result.targets.length} target${result.targets.length === 1 ? '' : 's'} failed — see the report.`,
          )
        } else {
          // Report what actually travelled, not just the bakers — the run may
          // have carried material slots and UV channels too, and a toast that
          // names one part reads as "only that part was copied".
          const moved = sourceNode
            ? MATERIAL_SECTIONS.filter((key) => sections.has(key))
                .map((key) => sectionCountOf(sourceNode.node, key, pickedMaterials))
                .join(', ')
            : ''
          const warnings = result.targets.reduce(
            (n, t) => n + t.missingMaterials.length + t.missingUvSources.length,
            0,
          )
          toast.success(
            `Copied ${moved} to ${result.targets.length} node${result.targets.length === 1 ? '' : 's'}.` +
              // The modal closes below, so anything the user still has to act on
              // must be said here — the report stays in the panel, but a toast
              // that omitted this would read as "nothing to do".
              (warnings > 0 ? ' See the report — some names still need setting up.' : ''),
          )
          // The work is done and the confirm dialog has nothing left to confirm;
          // its report lives on in the panel behind it, so nothing is lost by
          // closing. Only on a clean run — a failure keeps the dialog up with
          // its error, where the user is already looking.
          setConfirmOpen(false)
        }
        // The targets changed on disk — their counts are now stale.
        void runScan(targets, setTargetScan)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  /** Projects whose `$JOB` differs from the character folder — what a repair
   *  would actually write. A project the scan couldn't read is never queued:
   *  its `$JOB` is unknown, not wrong. */
  const staleJobProjects = useMemo(
    () => projectsNeedingRepair(targetScan.projects, charFolder),
    [targetScan, charFolder],
  )

  /** What a repath would do, and whether it may run yet (see `planRepath`). */
  const repath = useMemo(
    () => planRepath(targetScan.projects, charFolder),
    [targetScan, charFolder],
  )

  /** Projects with at least one blank parm the studio can fill. A parm this
   *  DazToHue version lacks is NOT work — it is reported in the row instead. */
  const prefillTargets = useMemo(
    () =>
      targetScan.projects
        .filter((p) => p.ok && p.prefill.fillable.length > 0)
        .map((p) => p.hipPath),
    [targetScan],
  )

  /** How many of the tab's three actions have work waiting — the footer's
   *  one-line verdict for the whole tab. */
  const fixesAvailable = [
    staleJobProjects.length > 0,
    repath.targets.length > 0,
    prefillTargets.length > 0,
  ].filter(Boolean).length

  /**
   * Remember what a real run just backed up, and whether it is still needed.
   *
   * A file whose run FAILED goes on the unresolved list — that backup is the
   * only way back, and the close prompt says so. A later run that succeeds on
   * the same file takes it off again: its backup is now the state before THAT
   * run, and there is nothing left to undo.
   */
  function noteBackups(result: MaterialUtilReport) {
    const rows = backupsIn(result)
    if (rows.length === 0) return
    setSessionBackups((prev) => {
      const next = new Map(prev)
      for (const row of rows) next.set(row.hipPath, row.backupPath)
      return next
    })
    // Per FILE, not per row: a transfer reports one entry per node, and one
    // failed node means the file was left in a state the user may want back.
    const failed = new Set(rows.filter((row) => !row.ok).map((row) => row.hipPath))
    setUnresolved((prev) => {
      const next = new Set(prev)
      for (const row of rows) {
        if (failed.has(row.hipPath)) next.add(row.hipPath)
        else next.delete(row.hipPath)
      }
      return next
    })
  }

  /**
   * Put one project back the way it was before the run that failed on it.
   *
   * Offered only from a failed entry (see {@link RestoreOffer}). The scan cache
   * keys on mtime, so the rescan afterwards re-reads exactly this file and
   * leaves its neighbours alone.
   */
  async function restoreBackup(hipPath: string, backupPath: string) {
    setRestoring(hipPath)
    try {
      await restoreHoudiniBackup({ data: { hipPath, backupPath } })
      setRestored((prev) => new Set(prev).add(hipPath))
      // Undone, so the copy has served its purpose — the close prompt no longer
      // needs to argue for keeping it.
      setUnresolved((prev) => {
        const next = new Set(prev)
        next.delete(hipPath)
        return next
      })
      toast.success(`${fileName(hipPath)} is back to the state it was in before the run.`)
      void runScan(targets, setTargetScan)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRestoring('')
    }
  }

  const restore: RestoreProps = {
    busy: restoring,
    done: restored,
    onRestore: (hipPath, backupPath) => void restoreBackup(hipPath, backupPath),
  }

  /**
   * Closing the drawer is where a session's backups get collected.
   *
   * They exist to undo a run that went wrong, and that question is only live
   * while the drawer is open — once it closes, nothing in the app would ever
   * mention them again and they would sit beside the projects forever. So the
   * drawer asks on the way out. It ASKS rather than deleting: the one case
   * where a copy is still worth 8 MB is a failed run the user hasn't undone.
   */
  function requestClose() {
    if (sessionBackups.size === 0) {
      onClose()
      return
    }
    setCleanupOpen(true)
  }

  async function closeAndDiscard() {
    const paths = [...sessionBackups.values()]
    setDiscarding(true)
    try {
      const removed = await discardHoudiniBackups({ data: { paths } })
      // Counted, not assumed: Houdini holding a file open is the ordinary way
      // one survives, and "removed" would be a lie about the disk.
      toast.success(
        removed === paths.length
          ? `${removed} backup${removed === 1 ? '' : 's'} removed.`
          : `${removed} of ${paths.length} backups removed — the rest are in use and stay.`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setDiscarding(false)
      setCleanupOpen(false)
      onClose()
    }
  }

  async function runPrefill(dryRun: boolean) {
    if (prefillTargets.length === 0 || !projectId) return
    setRunning(dryRun ? 'dry' : 'run')
    setActionReport(null)
    try {
      const result = await prefillHoudiniNetwork({
        data: { projectId, id: character.id, hipPaths: prefillTargets, dryRun },
      })
      setActionReport({ kind: 'prefill', report: result })
      if (!dryRun) {
        noteBackups(result)
        const failed = result.prefill.filter((r) => !r.ok)
        if (failed.length > 0) {
          toast.error(`${failed.length} of ${result.prefill.length} projects failed — see below.`)
        } else {
          const filled = result.prefill.reduce((n, r) => n + r.filled.length, 0)
          toast.success(
            `Filled ${filled} parameter${filled === 1 ? '' : 's'} the studio already knew.`,
          )
          setPrefillOpen(false)
        }
        void runScan(targets, setTargetScan)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  async function runRepath(dryRun: boolean) {
    if (repath.targets.length === 0) return
    setRunning(dryRun ? 'dry' : 'run')
    setActionReport(null)
    try {
      const result = await repathHoudiniReferences({
        data: {
          targets: repath.targets.map((hipPath) => ({ hipPath, jobDir: charFolder })),
          dryRun,
        },
      })
      setActionReport({ kind: 'repath', report: result })
      if (!dryRun) {
        noteBackups(result)
        const failed = result.repath.filter((r) => !r.ok)
        if (failed.length > 0) {
          toast.error(`${failed.length} of ${result.repath.length} projects failed — see below.`)
        } else {
          const collapsed = result.repath.reduce((n, r) => n + r.collapsed, 0)
          const repaired = result.repath.reduce((n, r) => n + r.repaired.length, 0)
          toast.success(
            `${collapsed} reference${collapsed === 1 ? '' : 's'} made portable` +
              (repaired > 0 ? `, ${repaired} broken one${repaired === 1 ? '' : 's'} repaired` : '') +
              '.',
          )
          setRepathOpen(false)
        }
        void runScan(targets, setTargetScan)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  async function runDefaults(dryRun: boolean) {
    if (staleJobProjects.length === 0) return
    setRunning(dryRun ? 'dry' : 'run')
    setActionReport(null)
    try {
      const result = await repairHoudiniDefaults({
        data: {
          targets: staleJobProjects.map((hipPath) => ({ hipPath, jobDir: charFolder })),
          dryRun,
        },
      })
      setActionReport({ kind: 'defaults', report: result })
      if (!dryRun) {
        noteBackups(result)
        const failed = result.defaults.filter((d) => !d.ok)
        const changed = result.defaults.filter((d) => d.ok && d.changed).length
        if (failed.length > 0) {
          toast.error(`${failed.length} of ${result.defaults.length} projects failed — see below.`)
        } else {
          toast.success(
            `$JOB repaired on ${changed} project${changed === 1 ? '' : 's'}. Paths you pick from now on stay relative.`,
          )
          setDefaultsOpen(false)
        }
        // The files changed on disk — their scanned $JOB is now stale.
        void runScan(targets, setTargetScan)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  return (
    <>
      <SidePanel
        open={open}
        // Not `onClose` directly: a session that wrote backups is asked about
        // them on the way out (see `requestClose`).
        onClose={busy ? () => {} : requestClose}
        // Names the KIND of thing being worked on, not just the character: the
        // drawer acts on Houdini projects, and "Utils — Ita" gave no clue which
        // of the character's many facets it touches.
        title={
          <span className="flex items-center gap-2">
            <img src={houdiniLogo} alt="" aria-hidden className="size-5 shrink-0 object-contain" />
            <span className="truncate">
              Houdini project utils
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {character.name}
                {initialHipPath ? ` · opened from ${fileName(initialHipPath)}` : ''}
              </span>
            </span>
          </span>
        }
      >
        <Tabs
          value={tab}
          onValueChange={(next) => {
            // Node lists, sections and selections are all per-kind — carrying a
            // material selection into the skeleton tab would offer a target the
            // run can't use.
            setTab(next as DrawerTab)
            setSelectedTargets(new Set())
            setSelectedSource('')
            setReport(null)
            setActionReport(null)
          }}
        >
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="material">Material</TabsTrigger>
            <TabsTrigger value="skeleton">Skeleton</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            <GeneralTab
              scan={targetScan}
              charFolder={charFolder}
              result={actionReport}
              repathReason={repath.reason}
              restore={restore}
              onRescan={() => void runScan(targets, setTargetScan)}
            />
          </TabsContent>

          {/* One body for both transfer tabs: the flow is identical and only the
              section list and the material picker differ, so `value={kind}`
              keeps the single content mounted for whichever is active. */}
          <TabsContent value={kind} className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Copy the texture-baker setup of one material node onto this character&apos;s
              material nodes. Bakers name their material and geometry groups as text, so a
              target that doesn&apos;t define those names takes the bakers and bakes nothing —
              the dry run lists exactly that before anything is written.
            </p>

            {/* ---------------------------------------------------------- target */}
            <section>
              <Label className="mb-1 flex w-fit items-center gap-1 text-base font-semibold">
                Target
                <InfoPopup label="Target — more information">
                  This character&apos;s linked Houdini projects and the DazToHue material nodes
                  found in each. Select every node that should receive the copied bakers.
                </InfoPopup>
              </Label>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {targets.length === 0
                    ? 'No Houdini projects linked to this character.'
                    : `${targets.length} linked project${targets.length === 1 ? '' : 's'}`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={targetScan.loading || targets.length === 0}
                  onClick={() => void runScan(targets, setTargetScan)}
                >
                  <RefreshCw className={targetScan.loading ? 'animate-spin' : ''} /> Rescan
                </Button>
              </div>
              <NodePicker
                scan={targetScan}
                kind={kind}
                mode="multi"
                selected={selectedTargets}
                disabledKey={selectedSource}
                onToggle={toggleTarget}
              />
            </section>

            {/* ---------------------------------------------------------- source */}
            <section>
              <Label className="mb-1 flex w-fit items-center gap-1 text-base font-semibold">
                Source
                <InfoPopup label="Source — more information">
                  The node to copy FROM — another character&apos;s project, or any Houdini
                  project on disk. Exactly one material node can be the source.
                </InfoPopup>
              </Label>

              {templates.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1 text-xs text-muted-foreground">
                    Templates in this project
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {templates.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        title={template.description || template.scenePath}
                        onClick={() => {
                          setSourceMode('browse')
                          setBrowsedHip(template.scenePath)
                        }}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${
                          normalizePath(activeSourceHip).toLowerCase() ===
                          normalizePath(template.scenePath).toLowerCase()
                            ? 'border-houdini-orange bg-houdini-orange/15 font-medium'
                            : 'text-muted-foreground hover:bg-accent/50'
                        }`}
                      >
                        <img
                          src={houdiniLogo}
                          alt=""
                          aria-hidden
                          className="size-4 shrink-0 object-contain"
                        />
                        {template.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Select
                  value={sourceCharacterId}
                  onValueChange={(value) => {
                    setSourceMode('studio')
                    setSourceCharacterId(value)
                    const next = others.find((c) => c.id === value)
                    setSourceHip(next?.houdiniProjects[0] ?? '')
                  }}
                >
                  <SelectTrigger className="w-64">
                    <SelectValue placeholder="Character from the studio…" />
                  </SelectTrigger>
                  <SelectContent>
                    {others.map((c) => (
                      <SelectItem key={`${c.projectId}|${c.id}`} value={c.id}>
                        {c.name} — {c.projectName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {sourceCharacter && sourceCharacter.houdiniProjects.length > 1 && (
                  <Select
                    value={sourceMode === 'studio' ? sourceHip : ''}
                    onValueChange={(value) => {
                      setSourceMode('studio')
                      setSourceHip(value)
                    }}
                  >
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder="Project…" />
                    </SelectTrigger>
                    <SelectContent>
                      {sourceCharacter.houdiniProjects.map((hip) => (
                        <SelectItem key={hip} value={hip}>
                          {fileName(hip)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Same action as the picker: drag a `.hip` out of Explorer
                    straight onto the button. */}
                <FileDropZone
                  accept={['hip', 'hipnc', 'hiplc']}
                  label="Drop a Houdini project"
                  onDrop={(paths) => {
                    const dropped = paths[0]
                    if (!dropped) return
                    setSourceMode('browse')
                    setBrowsedHip(dropped)
                  }}
                >
                  <Button variant="outline" size="sm" onClick={() => void onBrowse()}>
                    <FolderOpen /> Browse…
                  </Button>
                </FileDropZone>
              </div>

              {activeSourceHip && (
                <p className="mb-2 truncate text-xs text-muted-foreground" title={activeSourceHip}>
                  {displayPath(activeSourceHip)}
                </p>
              )}

              <NodePicker
                scan={sourceScan}
                kind={kind}
                mode="single"
                selected={new Set(selectedSource ? [selectedSource] : [])}
                onToggle={(hipPath, nodePath) => setSelectedSource(nodeKey(hipPath, nodePath))}
                empty={
                  activeSourceHip
                    ? undefined
                    : 'Pick a character or browse for a Houdini project to copy from.'
                }
              />
            </section>

            {/* --------------------------------------------------------- materials */}
            {kind === 'material' && sourceNode && sourceNode.node.slots.length > 0 && (
              <section>
                <Label className="mb-1 flex w-fit items-center gap-1 text-base font-semibold">
                  Materials
                  <InfoPopup label="Materials — more information">
                    The unit you actually reuse. A material slot is the list of Daz surfaces
                    merged into one material — for a Genesis 9 skin that list is the same on
                    every character of that generation, so it transfers as-is. Clothing only
                    matches when the target wears the same asset. Each slot&apos;s texture
                    bakers travel with it.
                  </InfoPopup>
                </Label>
                <p className="mb-2 text-xs text-muted-foreground">
                  {pickedMaterials.size === 0
                    ? 'Nothing picked — every material is copied. Tick one to copy just that.'
                    : `${pickedMaterials.size} of ${sourceNode.node.slots.length} materials`}
                </p>
                <ul className="space-y-1">
                  {sourceNode.node.slots.map((slot) => {
                    const needsUv = slot.channelUvs.length > 0
                    return (
                      <li key={slot.name}>
                        <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent/50">
                          <input
                            type="checkbox"
                            checked={pickedMaterials.has(slot.name)}
                            onChange={() =>
                              setPickedMaterials((prev) => {
                                const next = new Set(prev)
                                if (next.has(slot.name)) next.delete(slot.name)
                                else next.add(slot.name)
                                return next
                              })
                            }
                          />
                          <span className="font-medium">{slot.displayName}</span>
                          <span
                            className="text-muted-foreground"
                            title={slot.surfaces.map(surfaceLabel).join(', ')}
                          >
                            {slot.surfaces.length} surface
                            {slot.surfaces.length === 1 ? '' : 's'} · {slot.bakers} baker
                            {slot.bakers === 1 ? '' : 's'} · {slot.layers} layer
                            {slot.layers === 1 ? '' : 's'}
                          </span>
                          {needsUv && (
                            <span
                              className="text-amber-500"
                              title={`These bakers read ${slot.channelUvs.join(', ')}, which only a UV channel produces — include UV channels below.`}
                            >
                              needs UV channels
                            </span>
                          )}
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            {/* ------------------------------------------------------ what to copy */}
            <section>
              <Label className="mb-1 flex w-fit items-center gap-1 text-base font-semibold">
                What to copy
                <InfoPopup label="What to copy — more information">
                  These are one setup, not three: a texture baker names its material
                  (<code>MI_Skin</code>) and its layers name UV channels
                  (<code>uv_original</code>, <code>uv_geoshell</code>) as plain text. Copying
                  the bakers alone leaves those names pointing at nothing, and they bake
                  nothing — which is why all three are on by default.
                </InfoPopup>
              </Label>
              <div className="space-y-1">
                {kind === 'skeleton'
                  ? SKELETON_SECTIONS.map((key) => {
                      const count = sourceNode?.node.sectionCounts.find((s) => s.key === key)?.count
                      return (
                        <label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={skelSections.has(key)}
                            onChange={() =>
                              setSkelSections((prev) => {
                                const next = new Set(prev)
                                if (next.has(key)) next.delete(key)
                                else next.add(key)
                                return next
                              })
                            }
                          />
                          <span>
                            <span className="font-medium">{SKELETON_LABELS[key].label}</span>
                            {count !== undefined && (
                              <span className="ml-1 text-muted-foreground">
                                ({count} setting{count === 1 ? '' : 's'})
                              </span>
                            )}
                            <br />
                            <span className="text-xs text-muted-foreground">
                              {SKELETON_LABELS[key].hint}
                            </span>
                          </span>
                        </label>
                      )
                    })
                  : MATERIAL_SECTIONS.map((key) => (
                      <label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={sections.has(key)}
                          onChange={() =>
                            setSections((prev) => {
                              const next = new Set(prev)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return next
                            })
                          }
                        />
                        <span>
                          <span className="font-medium">{SECTION_LABELS[key].label}</span>
                          {sourceNode && (
                            <span className="ml-1 text-muted-foreground">
                              ({sectionCountOf(sourceNode.node, key, pickedMaterials)})
                            </span>
                          )}
                          <br />
                          <span className="text-xs text-muted-foreground">
                            {SECTION_LABELS[key].hint}
                          </span>
                        </span>
                      </label>
                    ))}
              </div>
              {kind === 'skeleton' && (
                <p className="mt-2 text-xs text-muted-foreground">
                  A skeleton section is copied <strong>wholesale</strong> — its settings and its
                  lists replace the target&apos;s. Appending 22 bone renames onto 22 existing ones
                  would make 44 rules, not a merged setup.
                </p>
              )}
              {/* The blocking reason, stated where the checkbox that causes it
                  lives — a disabled button whose cause is only in a tooltip is
                  a dead end. */}
              {uvStarvedMaterials.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <strong>
                      {uvStarvedMaterials.map((s) => s.displayName).join(', ')}
                    </strong>{' '}
                    {uvStarvedMaterials.length === 1 ? 'reads' : 'read'}{' '}
                    {[...new Set(uvStarvedMaterials.flatMap((s) => s.channelUvs))].join(', ')},
                    which only a UV channel produces. Without <strong>UV channels</strong> those
                    bakers would land pointing at a UV nothing at the target creates — tick it, or
                    deselect the material. Transfer stays disabled until then.
                  </span>
                </p>
              )}
              {/* Stated where the target list is, since deselecting a target is
                  one of the two ways out. */}
              {mismatchedTargets.length > 0 && (
                <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    <strong>
                      {mismatchedTargets
                        .map((t) => labelFor(t.hipPath, t.nodePath))
                        .join(', ')}
                    </strong>{' '}
                    {mismatchedTargets.length === 1 ? 'has' : 'have'} none of the Daz surfaces
                    these materials claim — the two nodes describe different figures, and a
                    material setup only transfers within one Genesis version. The copied slots
                    would name surfaces that aren&apos;t there and every baker would bake
                    nothing. Deselect {mismatchedTargets.length === 1 ? 'it' : 'them'}, or pick a
                    source built from the same figure. Transfer stays disabled until then.
                  </span>
                </p>
              )}
              {kind === 'material' && !sections.has('materials') && sections.has('bakers') && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-500">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Without the material slots, the copied bakers only bake if the target
                    already defines the same material names. The dry run lists any that are
                    missing.
                  </span>
                </p>
              )}
            </section>

            {report && <TransferReport report={report} labelFor={labelFor} restore={restore} />}
          </TabsContent>
        </Tabs>

        {/* The panel's own footer action — the modal owns the actual run. */}
        {tab === 'general' ? (
          <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            {/* One summary for THREE actions: the old line described only the
                $JOB repair, which read as the whole tab's verdict. Each button
                still carries its own reason in its tooltip and disabled state. */}
            <span className="mr-auto text-xs text-muted-foreground">
              {targetScan.loading
                ? 'Reading the projects…'
                : fixesAvailable === 0
                  ? 'Nothing to fix — every check already passes.'
                  : `${fixesAvailable} of 3 fixes available`}
            </span>
            {/* Ordered the way they must be RUN: repathing collapses against
                whatever $JOB the scene carries, so the repair comes first. */}
            <Button
              variant="outline"
              disabled={busy || staleJobProjects.length === 0 || !charFolder}
              title={
                !charFolder
                  ? 'The character folder could not be resolved'
                  : staleJobProjects.length === 0
                    ? 'Nothing differs — every project already points $JOB at the character folder'
                    : undefined
              }
              onClick={() => {
                setActionReport(null)
                setDefaultsOpen(true)
              }}
            >
              <Wrench /> Repair $JOB
            </Button>
            <Button
              variant="outline"
              disabled={busy || repath.targets.length === 0 || !charFolder}
              // The gate's reason is ALSO rendered in the row above; a disabled
              // button whose cause is only in a tooltip is a dead end.
              title={
                !charFolder ? 'The character folder could not be resolved' : repath.reason || undefined
              }
              onClick={() => {
                setActionReport(null)
                setRepathOpen(true)
              }}
            >
              <Route /> Make paths portable
            </Button>
            <Button
              variant="outline"
              disabled={busy || prefillTargets.length === 0 || !projectId}
              title={
                prefillTargets.length === 0
                  ? 'Nothing blank the studio has an answer for'
                  : undefined
              }
              onClick={() => {
                setActionReport(null)
                setPrefillOpen(true)
              }}
            >
              <Wand2 /> Fill network
            </Button>
          </div>
        ) : (
        <div className="mt-6 flex items-center justify-end gap-3 border-t pt-4">
          {sourceNode && !sourceHasBakers && (
            <span className="flex items-center gap-1.5 text-xs text-amber-500">
              <AlertTriangle className="size-3.5" /> The source node has no texture bakers.
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {targetRefs.length} target node{targetRefs.length === 1 ? '' : 's'} selected
          </span>
          <Button
            disabled={!canTransfer}
            title={
              !sourceNode
                ? 'Select a source material node first'
                : targetRefs.length === 0
                  ? 'Select at least one target material node'
                  : activeSections.length === 0
                    ? 'Select at least one thing to copy'
                    : uvStarvedMaterials.length > 0
                      ? `${uvStarvedMaterials.map((s) => s.displayName).join(', ')} needs the UV channels — tick "UV channels", or deselect that material`
                      : mismatchedTargets.length > 0
                        ? `${mismatchedTargets.map((t) => labelFor(t.hipPath, t.nodePath)).join(', ')} has none of the surfaces these materials claim — different figures`
                        : undefined
            }
            onClick={() => {
              setReport(null)
              setConfirmOpen(true)
            }}
          >
            <Wrench /> Transfer
          </Button>
        </div>
        )}
      </SidePanel>

      {/* Asked on the way out, never on the way in: a backup is only ever
          interesting while the drawer that made it is still open. */}
      {cleanupOpen && (
        <Modal
          open
          onClose={() => setCleanupOpen(false)}
          dismissible={!discarding}
          title="Remove this session's backups?"
        >
          <div className="space-y-2 text-sm">
            <p>
              Each run kept a copy of the project it was about to write, so a run that went
              wrong could be undone from its report. Those copies are only useful while this
              drawer is open — <strong>{sessionBackups.size}</strong> {' '}
              {sessionBackups.size === 1 ? 'is' : 'are'} on disk now, one per project, beside
              Houdini&apos;s own backups.
            </p>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
              {[...sessionBackups].map(([hipPath, backupPath]) => (
                <li key={hipPath} className="truncate" title={backupPath}>
                  <code>{fileName(backupPath)}</code>
                  {unresolved.has(hipPath) ? ' — from the run that failed' : ''}
                </li>
              ))}
            </ul>
          </div>

          {/* The one case where a copy is still worth its 8 MB. Stated loudly,
              because removing it is the point of no return for that project. */}
          {unresolved.size > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-500">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <strong>{unresolved.size}</strong> run{unresolved.size === 1 ? '' : 's'} failed
                and {unresolved.size === 1 ? 'has' : 'have'} not been undone. Removing{' '}
                {unresolved.size === 1 ? 'that copy' : 'those copies'} throws away the only way
                back — keep them if you still want the option.
              </span>
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Only the studio&apos;s own <code>_dthbak</code> copies are removed. Houdini&apos;s
            backups in the same folder are never touched, and a file Houdini is holding open
            stays where it is.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={discarding} onClick={() => setCleanupOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={discarding}
              title="Leave the copies on disk — nothing else in the studio will ask about them again"
              onClick={() => {
                setCleanupOpen(false)
                onClose()
              }}
            >
              Keep them
            </Button>
            <Button disabled={discarding} onClick={() => void closeAndDiscard()}>
              {discarding ? <Loader2 className="animate-spin" /> : <Trash2 />} Remove
            </Button>
          </div>
        </Modal>
      )}

      {defaultsOpen && (
        <Modal
          open
          onClose={() => setDefaultsOpen(false)}
          dismissible={!busy}
          title="Repair $JOB on these projects?"
        >
          <div className="space-y-2 text-sm">
            <p>
              Point <code>$JOB</code> at <strong>{displayPath(charFolder)}</strong> in{' '}
              <strong>{staleJobProjects.length}</strong> project
              {staleJobProjects.length === 1 ? '' : 's'}.
            </p>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
              {staleJobProjects.map((hip) => (
                <li key={hip}>
                  <code>{fileName(hip)}</code>
                </li>
              ))}
            </ul>
          </div>

          {/* The honest limit, stated where the decision is made — this makes a
              project CAPABLE of being movable; it does not move anything that
              is already stored absolute. */}
          <p className="rounded-md border p-3 text-xs text-muted-foreground">
            This fixes paths you pick <strong>from now on</strong>: Houdini will collapse an
            export you choose to <code>$JOB/…</code> instead of writing it absolute. Paths already
            stored absolute stay exactly as they are — repointing <code>$JOB</code> does not
            rewrite existing references.
          </p>

          <p className="text-xs text-muted-foreground">
            A real run saves each project. Close them in Houdini first — Houdini writes the whole
            scene on save and would overwrite this.
          </p>

          {actionReport?.kind === 'defaults' && (
            <DefaultsReport report={actionReport.report} restore={restore} />
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setDefaultsOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void runDefaults(true)}>
              {running === 'dry' ? <Loader2 className="animate-spin" /> : null} Dry run
            </Button>
            <Button disabled={busy} onClick={() => void runDefaults(false)}>
              {running === 'run' ? <Loader2 className="animate-spin" /> : null} Run
            </Button>
          </div>
        </Modal>
      )}

      {prefillOpen && (
        <Modal
          open
          onClose={() => setPrefillOpen(false)}
          dismissible={!busy}
          title="Fill the DazToHue network?"
        >
          <div className="space-y-2 text-sm">
            <p>
              Fill the blank DazToHue parameters the studio already knows — the same wiring
              <strong> Generate project</strong> gives a new project — across{' '}
              <strong>{prefillTargets.length}</strong> project
              {prefillTargets.length === 1 ? '' : 's'}.
            </p>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
              {prefillTargets.map((hip) => (
                <li key={hip}>
                  <code>{fileName(hip)}</code>
                </li>
              ))}
            </ul>
          </div>

          {/* The two properties that make this safe to run on a project the
              user has already configured by hand. */}
          <p className="rounded-md border p-3 text-xs text-muted-foreground">
            Only <strong>blank</strong> parameters are written — anything you set yourself is left
            exactly as it is. A parameter your installed DazToHue version doesn&apos;t have is
            skipped and named in the report, so this stays useful before the release that adds
            the PoseAsset CSV path.
          </p>

          <p className="text-xs text-muted-foreground">
            A real run saves each project. Close them in Houdini first — Houdini writes the whole
            scene on save and would overwrite this.
          </p>

          {actionReport?.kind === 'prefill' && (
            <PrefillReport report={actionReport.report} restore={restore} />
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setPrefillOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void runPrefill(true)}>
              {running === 'dry' ? <Loader2 className="animate-spin" /> : null} Dry run
            </Button>
            <Button disabled={busy} onClick={() => void runPrefill(false)}>
              {running === 'run' ? <Loader2 className="animate-spin" /> : null} Run
            </Button>
          </div>
        </Modal>
      )}

      {repathOpen && (
        <Modal
          open
          onClose={() => setRepathOpen(false)}
          dismissible={!busy}
          title="Make stored paths portable?"
        >
          <div className="space-y-2 text-sm">
            <p>
              Rewrite <strong>{repath.collapsible}</strong> reference
              {repath.collapsible === 1 ? '' : 's'} to sit under <code>$HIP</code>,{' '}
              <code>$JOB</code> or <code>$DAZ3D_LIB</code>
              {repath.broken > 0 && (
                <>
                  , and rebuild <strong>{repath.broken}</strong> broken DazToHue import
                  reference{repath.broken === 1 ? '' : 's'}
                </>
              )}{' '}
              across <strong>{repath.targets.length}</strong> project
              {repath.targets.length === 1 ? '' : 's'}.
            </p>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
              {repath.targets.map((hip) => (
                <li key={hip}>
                  <code>{fileName(hip)}</code>
                </li>
              ))}
            </ul>
          </div>

          <p className="rounded-md border p-3 text-xs text-muted-foreground">
            A broken import path is only rebuilt when the file it should point at is{' '}
            <strong>actually there</strong> — derived from the same node&apos;s other export
            files, which sit beside it with the same name. Nothing is guessed.
            {repath.foreign > 0 && (
              <>
                {' '}
                <strong>{repath.foreign}</strong> path
                {repath.foreign === 1 ? '' : 's'} live outside your Daz library and this
                character&apos;s folders — those cannot be made portable and stay exactly as they
                are; the report names them.
              </>
            )}
          </p>

          <p className="text-xs text-muted-foreground">
            A real run saves each project. Close them in Houdini first — Houdini writes the whole
            scene on save and would overwrite this.
          </p>

          {actionReport?.kind === 'repath' && (
            <RepathReport report={actionReport.report} restore={restore} />
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setRepathOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void runRepath(true)}>
              {running === 'dry' ? <Loader2 className="animate-spin" /> : null} Dry run
            </Button>
            <Button disabled={busy} onClick={() => void runRepath(false)}>
              {running === 'run' ? <Loader2 className="animate-spin" /> : null} Run
            </Button>
          </div>
        </Modal>
      )}

      {confirmOpen && sourceNode && (
        <Modal
          open
          onClose={() => setConfirmOpen(false)}
          dismissible={!busy}
          // Not "Copy texture bakers?": the run also carries material slots and
          // UV channels, and a title narrower than what the dialog's own report
          // lists is a title the user has to distrust.
          title={kind === 'skeleton' ? 'Copy skeleton setup?' : 'Copy material setup?'}
        >
          <div className="space-y-2 text-sm">
            <p>
              Copy{' '}
              <strong>
                {kind === 'skeleton'
                  ? SKELETON_SECTIONS.filter((key) => skelSections.has(key))
                      .map((key) => SKELETON_LABELS[key].label)
                      .join(', ')
                  : MATERIAL_SECTIONS.filter((key) => sections.has(key))
                      .map((key) => sectionCountOf(sourceNode.node, key, pickedMaterials))
                      .join(', ')}
              </strong>{' '}
              from <strong>{labelFor(sourceNode.project.hipPath, sourceNode.node.path)}</strong> in{' '}
              <code>{fileName(sourceNode.project.hipPath)}</code> to{' '}
              <strong>{targetRefs.length}</strong> material node
              {targetRefs.length === 1 ? '' : 's'}.
            </p>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
              {targetRefs.map((t) => (
                <li key={nodeKey(t.hipPath, t.nodePath)}>
                  {labelFor(t.hipPath, t.nodePath)} — <code>{fileName(t.hipPath)}</code>
                </li>
              ))}
            </ul>
          </div>

          {kind === 'material' && <MergePreview entries={mergePreview} labelFor={labelFor} />}

          {kind === 'skeleton' ? (
            <p className="rounded-md border p-3 text-xs text-muted-foreground">
              Each selected section replaces the target&apos;s — a configuration block is copied
              wholesale, so there is no append mode here.
            </p>
          ) : (
            replaceApplies && (
              <div className="flex items-start gap-3 rounded-md border p-3">
                <Switch
                  id="replace-at-target"
                  checked={replace}
                  disabled={busy}
                  onCheckedChange={setReplace}
                />
                <div className="text-sm">
                  <Label htmlFor="replace-at-target" className="font-medium">
                    Replace UV channels and bakers
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {replace
                      ? "The targets' existing UV channels and texture bakers are removed first — only the copied ones remain."
                      : 'The copied UV channels and bakers are ADDED to whatever each target already has.'}
                  </p>
                  {/* The switch used to cover material slots too, and that is
                      exactly how a 25-slot node became a 1-slot node. Saying
                      what it no longer touches is cheaper than a user finding
                      out. */}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Material slots are never replaced wholesale — they merge by surface, above.
                  </p>
                </div>
              </div>
            )
          )}

          {kind === 'material' && (
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Switch
              id="use-lib-var"
              checked={useLibVar}
              disabled={busy}
              onCheckedChange={setUseLibVar}
            />
            <div className="text-sm">
              <Label htmlFor="use-lib-var" className="font-medium">
                Portable texture paths (<code>$DAZ3D_LIB</code>)
              </Label>
              <p className="text-xs text-muted-foreground">
                {useLibVar
                  ? 'Texture paths under your Daz library are stored as $DAZ3D_LIB/… — the copy keeps working if the library moves, or on a machine whose library is on another drive. Textures outside the library stay absolute and are listed in the report.'
                  : 'Texture paths are copied exactly as the source stored them — absolute into the Daz library, so they break if it ever moves.'}
              </p>
            </div>
          </div>
          )}

          <p className="text-xs text-muted-foreground">
            A real run saves each target project. Close them in Houdini first — Houdini writes the
            whole scene on save and would overwrite this.
          </p>

          {report && <TransferReport report={report} labelFor={labelFor} restore={restore} />}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void run(true)}>
              {running === 'dry' ? <Loader2 className="animate-spin" /> : null} Dry run
            </Button>
            <Button disabled={busy} onClick={() => void run(false)}>
              {running === 'run' ? <Loader2 className="animate-spin" /> : null} Run
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

/**
 * The General tab: what each linked project carries today, and what the studio
 * can put right — the drawer's first tab, and the only one that is useful
 * without a second project picked.
 *
 * `$JOB` is scene state saved with the `.hip`, so v0.64's fix reached only
 * newly generated projects — every project that already existed still carries
 * `<char>/houdini/houdini-project`, which sits BELOW the exports and can
 * therefore never let Houdini collapse a picked export to a variable. This tab
 * is that migration, plus the two checks that go with it.
 *
 * The values come from the drawer's existing scan, which reads them in the same
 * pass as the nodes — opening a `.hip` costs tens of seconds and switching tab
 * must not pay it again.
 *
 * Presentation rule: every check is ONE row of the same shape — name on the
 * left, verdict on the right, detail beneath. Five rows that each invented
 * their own layout was the whole reason this tab read as noise.
 */
function GeneralTab({
  scan,
  charFolder,
  result,
  repathReason,
  restore,
  onRescan,
}: {
  scan: ScanState
  charFolder: string
  /** The last action's report — one slot for all three (see {@link ActionReport}). */
  result: ActionReport | null
  /** Why the repath action is unavailable, '' when it can run. */
  repathReason: string
  restore: RestoreProps
  onRescan: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Label className="flex w-fit items-center gap-1 text-base font-semibold">
          Project checks
          {/* The full `$JOB` story lives here rather than above the cards: it
              explains WHY the row exists, which is worth one click and not
              worth six lines of prose on every visit. */}
          <InfoPopup label="Project checks — more information">
            <code>$JOB</code> is saved inside each <code>.hip</code>, so a project keeps whatever
            it was created with — projects made before v0.64 still point it at the shared{' '}
            <code>houdini/houdini-project</code> folder, which sits below your exports. Houdini
            only turns a path you pick into a variable when it sits under <code>$HIP</code> or{' '}
            <code>$JOB</code>, so those projects write an absolute path every time you choose an
            export by hand. Repairing <code>$JOB</code> fixes what you pick from now on;{' '}
            <strong>Make paths portable</strong> fixes what is already stored.
          </InfoPopup>
        </Label>
        <span className="text-xs text-muted-foreground">
          {scan.projects.length} project{scan.projects.length === 1 ? '' : 's'} read
        </span>
        <Button variant="ghost" size="sm" disabled={scan.loading} onClick={onRescan}>
          <RefreshCw className={scan.loading ? 'animate-spin' : ''} /> Rescan
        </Button>
      </div>

      {scan.loading ? (
        <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Opening the project in Houdini — this takes a moment per file.
        </p>
      ) : scan.error ? (
        <p className="rounded-md border border-destructive/50 p-3 text-xs text-destructive">
          {scan.error}
        </p>
      ) : scan.projects.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No Houdini projects linked to this character.
        </p>
      ) : (
        <div className="space-y-3">
          {scan.projects.map((project) => (
            <ProjectCard key={project.hipPath} project={project}>
              {!project.ok ? (
                <p className="text-xs text-destructive">{project.error}</p>
              ) : (
                <ul className="space-y-2.5">
                  {defaultsRowsFor(project, charFolder).map((row) => (
                    <CheckRow
                      key={row.key}
                      label={row.label}
                      // `unknown` is NOT a warning: nobody read the value, so
                      // nothing is known to be wrong — and the repair skips it.
                      warn={row.status === 'differs'}
                      verdict={
                        row.status === 'matches'
                          ? 'matches'
                          : row.status === 'unknown'
                            ? 'could not be read'
                            : 'differs'
                      }
                    >
                      {/* Values stay VISIBLE rather than moving into a tooltip:
                          a row the user can't action needs its reason on
                          screen, and a row they can needs to show what a run
                          would replace. A matching row is just the one path. */}
                      {row.status === 'differs' ? (
                        <>
                          <PathLine label="now" value={row.current} />
                          <PathLine label="studio expects" value={row.expected} />
                          {!row.actionable && <p>{row.reason}</p>}
                        </>
                      ) : row.status === 'unknown' ? (
                        <p>The scan could not read this value, so nothing here is repaired.</p>
                      ) : (
                        <PathLine value={row.current} />
                      )}
                    </CheckRow>
                  ))}
                  <RefRows refs={project.refs} reason={repathReason} />
                  <PrefillRow prefill={project.prefill} />
                </ul>
              )}
            </ProjectCard>
          ))}
        </div>
      )}

      {/* ONE report slot for the tab's three actions — see {@link ActionReport}. */}
      {result?.kind === 'defaults' && <DefaultsReport report={result.report} restore={restore} />}
      {result?.kind === 'repath' && <RepathReport report={result.report} restore={restore} />}
      {result?.kind === 'prefill' && <PrefillReport report={result.report} restore={restore} />}
    </div>
  )
}

/**
 * One project check: its name, a right-aligned verdict, and the detail beneath.
 *
 * The aligned verdict column is what makes a card scannable — a status that
 * sits wherever its label happens to end turns five checks into five unrelated
 * sentences, which is exactly how this tab read before.
 */
function CheckRow({
  label,
  warn,
  verdict,
  children,
}: {
  label: string
  /** true = something to fix here (amber + the warning mark). */
  warn: boolean
  verdict: string
  children?: ReactNode
}) {
  return (
    <li className="text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{label}</span>
        {warn ? (
          <span className="flex shrink-0 items-center gap-1 text-amber-500">
            <AlertTriangle className="size-3 shrink-0" />
            {verdict}
          </span>
        ) : (
          <span className="shrink-0 text-muted-foreground">{verdict}</span>
        )}
      </div>
      {children ? <div className="mt-0.5 space-y-0.5 text-muted-foreground">{children}</div> : null}
    </li>
  )
}

/** A folder value inside a check row — one truncated line, full path on hover. */
function PathLine({ label, value }: { label?: string; value: string }) {
  return (
    <p className="truncate" title={value}>
      {label ? `${label}: ` : ''}
      <code>{displayPath(value) || '—'}</code>
    </p>
  )
}

/**
 * The two reference rows: how portable this project's stored paths are, and
 * whether any DazToHue import points at a file that isn't there.
 *
 * Repairing `$JOB` only helps paths picked AFTERWARDS — these are the ones
 * already written down, and fixing them is what turns "capable of being
 * movable" into movable.
 */
function RefRows({
  refs,
  reason,
}: {
  refs: { collapsible: number; foreign: number; broken: ReadonlyArray<string> }
  reason: string
}) {
  const clean = refs.collapsible === 0 && refs.broken.length === 0
  return (
    <>
      <CheckRow
        label="Reference paths"
        warn={refs.collapsible > 0}
        verdict={
          refs.collapsible > 0
            ? `${refs.collapsible} absolute`
            : refs.foreign > 0
              ? 'nothing more to make portable'
              : 'all relative'
        }
      >
        {refs.collapsible > 0 && (
          <p>
            {refs.collapsible} path{refs.collapsible === 1 ? '' : 's'} can be stored relative to{' '}
            <code>$HIP</code>, <code>$JOB</code> or <code>$DAZ3D_LIB</code>.
          </p>
        )}
        {refs.foreign > 0 && (
          <p>
            {refs.foreign} live outside those roots and cannot be made portable — they stay
            absolute.
          </p>
        )}
      </CheckRow>
      <CheckRow
        label="Import references"
        warn={refs.broken.length > 0}
        verdict={refs.broken.length === 0 ? 'all resolve' : `${refs.broken.length} broken`}
      >
        {refs.broken.length > 0 && (
          <p className="truncate" title={refs.broken.join(', ')}>
            {refs.broken.join(', ')} — rebuilt from the same node&apos;s other export files.
          </p>
        )}
      </CheckRow>
      {/* The gate's reason belongs beside the rows it blocks, not only on the
          disabled button. */}
      {!clean && reason !== '' && <li className="text-xs text-amber-500">{reason}</li>}
    </>
  )
}

/**
 * What Generate project would have wired, for a project that already exists.
 *
 * Two separate facts, and conflating them would be the whole trap: `fillable`
 * is work the studio can do now; `missing` is a parameter the INSTALLED
 * DazToHue doesn't have. Naming the second is the point — the PoseAsset CSV
 * path is absent from DazToHue 2.5 (the node ships a button instead), so a user
 * who expected it filled gets a reason rather than a silent gap, and the same
 * action starts filling it the day that release lands.
 */
function PrefillRow({ prefill }: { prefill: ProjectPrefillInfo }) {
  const short = (label: string) => label.split(' ').pop() ?? label
  if (prefill.fillable.length === 0 && prefill.missing.length === 0) return null
  return (
    <CheckRow
      label="DazToHue network"
      warn={prefill.fillable.length > 0}
      verdict={
        prefill.fillable.length === 0
          ? 'nothing left to fill'
          : `${prefill.fillable.length} blank`
      }
    >
      {prefill.fillable.length > 0 && (
        <p className="truncate" title={prefill.fillable.join(', ')}>
          The studio knows these: {prefill.fillable.map(short).join(', ')}.
        </p>
      )}
      {prefill.missing.length > 0 && (
        <p>
          Your DazToHue version has no {prefill.missing.map(short).join(', ')} — it will be filled
          automatically once a release adds it.
        </p>
      )}
    </CheckRow>
  )
}

/**
 * The revert offer, and the only place a backup is ever mentioned.
 *
 * Every real run takes one rolling backup before it saves. Saying so on each
 * successful run — which is what this drawer used to do, four times over —
 * teaches the eye to skip the line, so the backup stays silent until it is
 * worth something: an entry that FAILED, on a file the run had already started
 * writing. Anything that failed earlier carries no `backupPath` and gets no
 * offer, because there is nothing it could undo.
 */
function RestoreOffer({
  hipPath,
  backupPath,
  restore,
}: {
  hipPath: string
  /** '' = nothing was written for this file, so nothing to put back. */
  backupPath: string
  restore: RestoreProps
}) {
  if (!backupPath) return null
  if (restore.done.has(hipPath)) {
    return <p className="mt-1 text-muted-foreground">Restored to the state before this run.</p>
  }
  return (
    <div className="mt-1.5">
      <Button
        variant="outline"
        size="sm"
        disabled={restore.busy !== ''}
        title={`Put ${fileName(hipPath)} back the way it was before this run. Close it in Houdini first — an open copy would save over the restore.`}
        onClick={() => restore.onRestore(hipPath, backupPath)}
      >
        {restore.busy === hipPath ? <Loader2 className="animate-spin" /> : <Undo2 />} Undo this
        run
      </Button>
    </div>
  )
}

/** What a prefill did, or would do, per project. */
function PrefillReport({
  report,
  restore,
}: {
  report: MaterialUtilReport
  restore: RestoreProps
}) {
  const short = (label: string) => label.split(' ').pop() ?? label
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Network filled'}
      </p>
      <ul className="space-y-2 text-xs">
        {report.prefill.map((entry) => (
          <li key={entry.hipPath}>
            <p className="truncate" title={entry.hipPath}>
              <strong>{fileName(entry.hipPath)}</strong>
            </p>
            {entry.ok ? (
              <>
                <p className="text-muted-foreground">
                  {entry.filled.length} parameter{entry.filled.length === 1 ? '' : 's'} filled
                  {entry.skippedSet.length > 0
                    ? ` · ${entry.skippedSet.length} already set, left alone`
                    : ''}
                </p>
                {entry.filled.map((parm) => (
                  <p key={parm.label} className="truncate text-muted-foreground" title={parm.value}>
                    {short(parm.label)} = <code>{parm.value}</code>
                  </p>
                ))}
                {entry.skippedMissing.length > 0 && (
                  <p className="text-muted-foreground">
                    Not in your DazToHue version: {entry.skippedMissing.map(short).join(', ')}.
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-destructive">{entry.error}</p>
                <RestoreOffer
                  hipPath={entry.hipPath}
                  backupPath={entry.backupPath}
                  restore={restore}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What a repath did, or would do, per project. */
function RepathReport({
  report,
  restore,
}: {
  report: MaterialUtilReport
  restore: RestoreProps
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Paths updated'}
      </p>
      <ul className="space-y-2 text-xs">
        {report.repath.map((entry) => (
          <li key={entry.hipPath}>
            <p className="truncate" title={entry.hipPath}>
              <strong>{fileName(entry.hipPath)}</strong>
            </p>
            {entry.ok ? (
              <>
                <p className="text-muted-foreground">
                  {entry.collapsed} reference{entry.collapsed === 1 ? '' : 's'} made portable
                  {entry.repaired.length > 0
                    ? ` · ${entry.repaired.length} broken import${entry.repaired.length === 1 ? '' : 's'} repaired`
                    : ''}
                </p>
                {entry.repaired.map((fix) => (
                  <p key={fix.label} className="truncate text-muted-foreground" title={fix.from}>
                    {fix.label}: <code>{fix.to}</code>
                  </p>
                ))}
                {entry.foreign.length > 0 && (
                  <p className="flex items-start gap-1 text-amber-500">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span>
                      {entry.foreign.length} path{entry.foreign.length === 1 ? '' : 's'} stay
                      absolute — outside your Daz library and this character&apos;s folders:{' '}
                      {entry.foreign.slice(0, 3).join(', ')}
                      {entry.foreign.length > 3 ? ` (+${entry.foreign.length - 3} more)` : ''}
                    </span>
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-destructive">{entry.error}</p>
                <RestoreOffer
                  hipPath={entry.hipPath}
                  backupPath={entry.backupPath}
                  restore={restore}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What a `$JOB` repair did, or would do, per project. */
function DefaultsReport({
  report,
  restore,
}: {
  report: MaterialUtilReport
  restore: RestoreProps
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Repair complete'}
      </p>
      <ul className="space-y-2 text-xs">
        {report.defaults.map((entry) => (
          <li key={entry.hipPath}>
            <p className="truncate" title={entry.hipPath}>
              <strong>{fileName(entry.hipPath)}</strong>
            </p>
            {entry.ok ? (
              <p className="text-muted-foreground">
                {entry.changed ? (
                  <>
                    <code>{displayPath(entry.previousJob) || '—'}</code> →{' '}
                    <code>{displayPath(entry.job)}</code>
                  </>
                ) : (
                  'Already on the right folder — left untouched.'
                )}
              </p>
            ) : (
              <>
                <p className="text-destructive">{entry.error}</p>
                <RestoreOffer
                  hipPath={entry.hipPath}
                  backupPath={entry.backupPath}
                  restore={restore}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * What the merge will do to each target's own material slots, before running.
 *
 * The transfer's one genuinely surprising act: installing a `Skin` that merges
 * fifteen Daz surfaces removes the fifteen slots at the target that claim those
 * same surfaces, because a surface can belong to only one slot. Correct — and
 * previously invisible until the report, which is how it read as data loss.
 *
 * Silent when nothing is affected: a preview that says "0 slots replaced" on
 * every run trains the user to skip the one time it doesn't.
 */
function MergePreview({
  entries,
  labelFor,
}: {
  entries: ReadonlyArray<{ hipPath: string; nodePath: string; plan: SurfaceMergePlan }>
  labelFor: (hipPath: string, nodePath: string) => string
}) {
  const affected = entries.filter(
    (entry) => mergeTouchCount(entry.plan) > 0 || entry.plan.unclaimed.length > 0,
  )
  if (affected.length === 0) return null
  return (
    <div className="rounded-md border p-3 text-xs">
      <p className="mb-1 text-sm font-medium">What this replaces at each target</p>
      <p className="mb-2 text-muted-foreground">
        A Daz surface belongs to exactly one material slot, so installing these materials takes
        back the surfaces they claim. Every other slot is left alone.
      </p>
      <ul className="space-y-1.5">
        {affected.map((entry) => (
          <li key={nodeKey(entry.hipPath, entry.nodePath)}>
            <p className="truncate">
              <strong>{labelFor(entry.hipPath, entry.nodePath)}</strong> —{' '}
              <code>{fileName(entry.hipPath)}</code>
            </p>
            {entry.plan.evicted.length > 0 && (
              <p className="text-muted-foreground">
                {entry.plan.evicted.length} slot{entry.plan.evicted.length === 1 ? '' : 's'}{' '}
                replaced: {entry.plan.evicted.join(', ')}
              </p>
            )}
            {entry.plan.trimmed.length > 0 && (
              <p className="text-muted-foreground">
                {entry.plan.trimmed.length} slot{entry.plan.trimmed.length === 1 ? '' : 's'} keep
                their remaining surfaces: {entry.plan.trimmed.join(', ')}
              </p>
            )}
            {entry.plan.unclaimed.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  {entry.plan.unclaimed.length} surface
                  {entry.plan.unclaimed.length === 1 ? '' : 's'} the copied materials claim exist
                  on no slot here: {entry.plan.unclaimed.map(surfaceLabel).join(', ')}.{' '}
                  {entry.plan.evicted.length === 0 && entry.plan.trimmed.length === 0
                    ? 'Nothing at all matched — check both nodes are the same figure.'
                    : 'Normal if the source wears something this character does not.'}
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The project → material-node list both sides share. */
function NodePicker({
  scan,
  kind,
  mode,
  selected,
  onToggle,
  disabledKey,
  empty,
}: {
  scan: ScanState
  /** Only this kind's nodes are listed — one scan carries both. */
  kind: NodeKind
  mode: 'single' | 'multi'
  selected: ReadonlySet<string>
  onToggle: (hipPath: string, nodePath: string) => void
  /** A node that cannot be picked here (the chosen source, in the target list). */
  disabledKey?: string
  empty?: string
}) {
  if (scan.loading) {
    return (
      <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Opening the project in Houdini — this takes a moment per file.
      </p>
    )
  }
  if (scan.error) {
    return <p className="rounded-md border border-destructive/50 p-3 text-xs text-destructive">{scan.error}</p>
  }
  if (scan.projects.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        {empty ?? 'No Houdini projects to scan.'}
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {scan.projects.map((project) => (
        <ProjectCard key={project.hipPath} project={project}>
          {!project.ok ? (
            <p className="text-xs text-destructive">{project.error}</p>
          ) : project.nodes.filter((n) => n.nodeType === kind).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No DazToHue {kind} nodes in this project.
            </p>
          ) : (
            <ul>
              {project.nodes
                .filter((n) => n.nodeType === kind)
                .map((node) => {
                  const key = nodeKey(project.hipPath, node.path)
                  return (
                    <li key={key}>
                      <MaterialNodeRow
                        node={node}
                        mode={mode}
                        checked={selected.has(key)}
                        disabled={disabledKey === key}
                        onToggle={() => onToggle(project.hipPath, node.path)}
                      />
                    </li>
                  )
                })}
            </ul>
          )}
        </ProjectCard>
      ))}
    </div>
  )
}

/**
 * A scanned Houdini project, wearing the linked-project card look: the
 * `houdini-card` tint/border, the orange left accent bar and the Houdini mark —
 * the same anatomy as the card this drawer was opened from, so a project reads
 * as the same kind of thing here as on the character page.
 *
 * The card is the PROJECT; its material nodes are plain rows inside it. Making
 * each node a card too would have two nested card frames competing for the same
 * "this is one thing" signal, and the node is not a file — it lives in this one.
 */
function ProjectCard({
  project,
  children,
}: {
  project: MaterialScanProject
  children: ReactNode
}) {
  return (
    <div className="relative w-full">
      <div className="houdini-card relative rounded-lg border p-3 pl-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#262626]">
            <img src={houdiniLogo} alt="" aria-hidden className="size-5 object-contain" />
          </span>
          <p className="min-w-0 flex-1 truncate text-base font-medium" title={project.hipPath}>
            {fileName(project.hipPath)}
          </p>
        </div>
        <div className="mt-2">{children}</div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-houdini-orange"
      />
    </div>
  )
}

/**
 * One material node inside a project card — a plain row, not a card of its own.
 *
 * The whole row is the control (a `<label>` wrapping the input), so clicking
 * anywhere on it selects. Selection reads as an orange tint rather than a ring:
 * inside a card that already has an orange border, another border would just
 * add noise. The heading is the network-box title when the node has one, since
 * that is the name the user gave this network.
 */
function MaterialNodeRow({
  node,
  mode,
  checked,
  disabled,
  onToggle,
}: {
  node: MaterialNodeInfo
  /** Multi = a target (checkbox); single = the one source (radio). */
  mode: 'single' | 'multi'
  checked: boolean
  /** Already chosen as the source — shown but refused, so the reason is visible
   *  rather than the row silently vanishing from the target list. */
  disabled: boolean
  onToggle: () => void
}) {
  const { primary, secondary } = nodeLabel(node)
  return (
    <label
      className={`flex items-start gap-3 rounded-md px-2 py-2 ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : `cursor-pointer ${checked ? 'bg-houdini-orange/20' : 'hover:bg-houdini-orange/10'}`
      }`}
    >
      <input
        type={mode === 'multi' ? 'checkbox' : 'radio'}
        name={mode === 'single' ? 'material-source' : undefined}
        className="mt-1 size-4 shrink-0 accent-houdini-orange"
        aria-label={primary}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {primary}
          {secondary && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground/70">{secondary}</span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground" title={node.path}>
          {node.nodeType === 'skeleton'
            ? node.sectionCounts.map((s) => `${s.label} ${s.count}`).join(' · ')
            : `${node.materials} material${node.materials === 1 ? '' : 's'} · ${node.uvChannels} UV channel${
                node.uvChannels === 1 ? '' : 's'
              } · ${node.bakers} baker${node.bakers === 1 ? '' : 's'} · ${node.layers} layer${
                node.layers === 1 ? '' : 's'
              }`}
          {disabled && ' — chosen as the source'}
        </span>
      </span>
    </label>
  )
}

/** What a run (or dry run) did, per target. */
function TransferReport({
  report,
  labelFor,
  restore,
}: {
  report: MaterialUtilReport
  /** Network-box name for a node — falls back to the node path when unscanned. */
  labelFor: (hipPath: string, nodePath: string) => string
  restore: RestoreProps
}) {
  // A failed SAVE marks every target node in that file, and they all share the
  // one rolling backup — so the revert is offered once per FILE, not once per
  // node, or a three-node project would grow three buttons that do the same
  // thing. Keyed on the first failing entry for each path.
  const offerAt = new Map<string, number>()
  report.targets.forEach((target, index) => {
    if (!target.ok && target.backupPath && !offerAt.has(target.hipPath)) {
      offerAt.set(target.hipPath, index)
    }
  })
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-sm font-medium">
        {report.dryRun ? 'Dry run — nothing was written' : 'Transfer complete'}
      </p>
      {report.useLibVar && (
        <p className="mb-2 text-xs text-muted-foreground">
          {report.rewrittenPaths} texture path{report.rewrittenPaths === 1 ? '' : 's'} pointed at{' '}
          <code>$DAZ3D_LIB</code>.
        </p>
      )}
      {report.foreignPaths.length > 0 && (
        <p className="mb-2 flex items-start gap-1 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <span>
            {report.foreignPaths.length} texture
            {report.foreignPaths.length === 1 ? '' : 's'} live outside your Daz library and stay
            absolute — the copy is only as movable as those paths:{' '}
            {report.foreignPaths.slice(0, 3).join(', ')}
            {report.foreignPaths.length > 3 ? ` (+${report.foreignPaths.length - 3} more)` : ''}
          </span>
        </p>
      )}
      <ul className="space-y-2 text-xs">
        {report.targets.map((target, index) => (
          <li key={`${target.hipPath}|${target.nodePath}`}>
            <p className="truncate" title={`${target.hipPath} — ${target.nodePath}`}>
              <strong>{labelFor(target.hipPath, target.nodePath)}</strong> —{' '}
              <code>{fileName(target.hipPath)}</code>
            </p>
            {target.ok ? (
              <>
                <p className="text-muted-foreground">
                  {target.sections
                    .map(
                      (s) =>
                        `${SECTION_LABELS[s.key as MaterialSection]?.label ?? s.key} ${s.before} → ${s.after}`,
                    )
                    .join(' · ')}
                </p>
                {/* Named, not just counted: a slot that vanished without being
                    named reads as data loss even when it was the correct
                    thing to do. */}
                {target.sections
                  .filter((s) => s.evicted.length > 0 || s.trimmed.length > 0)
                  .map((s) => (
                    <p key={s.key} className="text-muted-foreground">
                      {s.evicted.length > 0 &&
                        `Replaced ${s.evicted.length} slot${s.evicted.length === 1 ? '' : 's'} whose surfaces moved into the copied materials: ${s.evicted.join(', ')}. `}
                      {s.trimmed.length > 0 &&
                        `Kept ${s.trimmed.join(', ')} with the surfaces nothing else claims.`}
                    </p>
                  ))}
              </>
            ) : (
              <>
                <p className="text-destructive">{target.error}</p>
                {offerAt.get(target.hipPath) === index && (
                  <RestoreOffer
                    hipPath={target.hipPath}
                    backupPath={target.backupPath}
                    restore={restore}
                  />
                )}
              </>
            )}
            {target.unclaimedSurfaces.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  {target.unclaimedSurfaces.length} surface
                  {target.unclaimedSurfaces.length === 1 ? '' : 's'} the copied materials claim
                  exist on no slot here:{' '}
                  {target.unclaimedSurfaces.map(surfaceLabel).join(', ')} — normal if the source
                  wears something this character does not, but a whole set means the two nodes
                  describe different figures.
                </span>
              </p>
            )}
            {target.missingMaterials.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Set up first: this node still has no material named{' '}
                  {target.missingMaterials.map((m) => `"${m}"`).join(', ')} — add a matching slot
                  in the Materials tab (or include Material slots above), or those bakers produce
                  no texture.
                </span>
              </p>
            )}
            {target.missingUvSources.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>
                  Set up first: these bakers read {target.missingUvSources.join(', ')}, which only
                  a UV channel produces — tick UV channels, or build the same channel at the
                  target.
                </span>
              </p>
            )}
            {target.missingGroups.length > 0 && (
              <p className="flex items-start gap-1 text-amber-500">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                <span>Groups not found on the target geometry: {target.missingGroups.join(', ')}</span>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
