import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Blocks,
  FolderOpen,
  Loader2,
  RefreshCw,
  Route,
  Trash2,
  Wand2,
  Wrench,
  X,
} from 'lucide-react'

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
  GROOM_OCCLUSION_SECTIONS,
  MATERIAL_SECTIONS,
  OCCLUSION_SECTIONS,
  SKELETON_SECTIONS,
  prefillHoudiniNetwork,
  refreshHoudiniAssets,
  repairHoudiniDefaults,
  repathHoudiniReferences,
  discardHoudiniBackups,
  restoreHoudiniBackup,
  fetchCachedHoudiniScans,
  fetchHoudiniSourceRecents,
  forgetHoudiniSource,
  rememberHoudiniSource,
  scanCharacterHoudiniProjects,
  scanHoudiniMaterials,
  transferHoudiniMaterials,
} from '#/lib/rom/api.ts'
import {
  DTH_FPS,
  planRepath,
  projectsNeedingRepair,
  sameFolder,
} from '#/lib/rom/houdini-defaults.ts'
import type {
  CharacterWithProject,
  MaterialNodeInfo,
  MaterialScanProject,
  MaterialSection,
  MaterialUtilReport,
  NodeKind,
} from '#/lib/rom/api.ts'
import { fetchAllCharacters, listAssets } from '#/lib/rom/api.ts'
import {
  isFigureMismatch,
  planSurfaceMerge,
  surfaceLabel,
} from '#/lib/rom/houdini-material-merge.ts'
import type { SurfaceMergePlan } from '#/lib/rom/houdini-material-merge.ts'
import type { DazAsset, HoudiniSourceRecent } from '#/lib/rom/storage.ts'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { pickHipPath } from '#/lib/desktop.ts'
import { displayPath, normalizePath, parentDir } from '#/lib/path.ts'
import type { Character } from '@dth/rom'

import {
  EMPTY_SCAN,
  FLAT_SOURCE_LIMIT,
  FOLDER_KIND_UI,
  FOLDER_KINDS,
  SECTION_LABELS,
  TRANSIENT_TOAST_MS,
  backupsIn,
  fileName,
  hipStem,
  isFolderKind,
  nodeKey,
  nodeLabel,
  pickedSlots,
  sectionCountOf,
  sourceCharacterCandidates,
  utilsToast,
} from './houdini-utils/shared.ts'
import type {
  ActionReport,
  DrawerTab,
  FolderKind,
  RestoreProps,
  ScanState,
} from './houdini-utils/shared.ts'
import {
  DefaultsReport,
  GeneralTab,
  MergePreview,
  NodePicker,
  PrefillReport,
  RefreshReport,
  RepathReport,
  TransferReport,
} from './houdini-utils/parts.tsx'

/** One repair the repath dialog offers, as a verb plus what it acts on. */
interface RepathClause {
  key: string
  /** Lower case — `joinClauses` capitalizes whichever clause leads. */
  verb: string
  rest: ReactNode
}

/**
 * `[a, b, c]` → `A, b, and c`, dropping the clauses that have no work in them
 * and sentence-casing whichever survives first.
 *
 * The repath dialog lists three independent repairs and any SUBSET of them can
 * be the whole run — a moved library arms the button on `rehomable` alone, an
 * export folder that moved arms it on `broken` alone. A fixed sentence
 * therefore opened with "Rewrite 0 references" on the first of those; an `and`
 * pinned to a fixed clause lost the conjunction whenever that clause was the
 * absent one; and a leading clause that is only ever written lower case starts
 * the sentence mid-word. All three are decided from the surviving list here,
 * which is the only spelling that stays right as a fourth repair arrives.
 */
function joinClauses(clauses: Array<RepathClause | false>): ReactNode[] {
  const kept = clauses.filter((clause): clause is RepathClause => clause !== false)
  return kept.flatMap(({ key, verb, rest }, i) => {
    const clause = (
      <Fragment key={key}>
        {i === 0 ? verb.charAt(0).toUpperCase() + verb.slice(1) : verb} {rest}
      </Fragment>
    )
    return i === 0
      ? [clause]
      : [i === kept.length - 1 ? (kept.length === 2 ? ' and ' : ', and ') : ', ', clause]
  })
}

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


export function HoudiniUtilsPanel({
  open,
  onClose,
  character,
  /** The ONE project this drawer acts on — the card its Utils button was
   *  pressed on. Required, because that is the whole scope of the drawer: every
   *  check, every repair and every transfer target below belongs to this `.hip`
   *  and no other. */
  targetHip,
  /** The owning project — used to offer its Houdini template attachments. */
  projectId,
  /** The character's own folder — what `$JOB` should be (v0.64). */
  charFolder = '',
}: {
  open: boolean
  onClose: () => void
  character: Character
  targetHip: string
  projectId?: string
  charFolder?: string
}) {
  // --- target side: the ONE project this drawer was opened for ---------------
  //
  // Not `character.houdiniProjects`. Houdini project utils are PER PROJECT —
  // that is why the button lives on the project card and not on the section
  // header — so listing the character's other projects here offered repairs and
  // transfer targets the user never asked about, three clicks away from the
  // card they actually pressed. Everything downstream reads `targetScan`, so
  // narrowing the input scopes the whole drawer: one project's checks, one
  // project's nodes, one project's repairs.
  //
  // The SOURCE side is deliberately still cross-project — copying a setup means
  // copying it FROM somewhere else, which is the one thing here that legitimately
  // names another project.
  //
  // Kept as an ARRAY because everything below it — the scan call, the cache
  // filter, the coverage check — speaks in file lists, and because a `''` path
  // must resolve to "nothing to scan" rather than to a scan of the empty
  // string: the caller only mounts this with a real card path, and the guards
  // that read `targets.length` are what keep that from being an assumption.
  const targets = targetHip ? [targetHip] : []
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
   *  and has no node list; every other tab picks a NODE KIND to transfer. */
  const [tab, setTab] = useState<DrawerTab>('general')
  const kind: NodeKind = tab === 'general' ? 'material' : tab
  /** The folder kinds' selections, per kind — they are structurally identical
   *  (whole subtrees, no picker, no append), so one map beats one state each.
   *  Everything starts fully ticked, like the material tab. */
  const [folderSections, setFolderSections] = useState<
    Record<FolderKind, ReadonlySet<string>>
  >(() => ({
    skeleton: new Set<string>(SKELETON_SECTIONS),
    occlusion: new Set<string>(OCCLUSION_SECTIONS),
    groomOcclusion: new Set<string>(GROOM_OCCLUSION_SECTIONS),
  }))
  /** Toggle one section of one folder kind. */
  function toggleFolderSection(folderKind: FolderKind, key: string) {
    setFolderSections((prev) => {
      const next = new Set(prev[folderKind])
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { ...prev, [folderKind]: next }
    })
  }
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
  const [refreshOpen, setRefreshOpen] = useState(false)
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

  /** The store scope for TARGET scans — the character's own store, so what the
   *  drawer earns (the fallback scan, every post-repair rescan) lands where the
   *  card badge and the next open read it. Source scans stay unscoped and go to
   *  the shared source store. */
  const targetScope = projectId ? { projectId, characterId: character.id } : undefined

  async function runScan(
    hipPaths: Array<string>,
    set: (next: ScanState) => void,
    scope?: { projectId: string; characterId: string },
    /** A user-driven Rescan: bypass the cache and SAY what came back. */
    force = false,
  ): Promise<Array<MaterialScanProject>> {
    if (hipPaths.length === 0) {
      set(EMPTY_SCAN)
      return []
    }
    set({ loading: true, error: '', projects: [] })
    try {
      const projects = await scanHoudiniMaterials({ data: { hipPaths, ...scope, force } })
      set({ loading: false, error: '', projects })
      // A forced rescan usually ends where it started — the checks pass, the
      // list is identical — and an unchanged screen is indistinguishable from a
      // button that did nothing. Which is exactly how this read before it could
      // force at all: the cache answered in ten milliseconds and the spinner
      // never became visible. Say it ran.
      if (force) utilsToast.success('Rescanned the Houdini project')
      return projects
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({ loading: false, error: message, projects: [] })
      if (force) utilsToast.error(message)
      return []
    }
  }

  /** Every scan of the character's own projects goes through this, so they all
   *  persist under the character's store. `force` is the Rescan button — every
   *  other caller follows an operation that SAVED the `.hip`, so its new mtime
   *  misses the cache on its own merits. */
  function scanTargets(force = false): Promise<Array<MaterialScanProject>> {
    return runScan(targets, setTargetScan, targetScope, force)
  }

  /**
   * The character's own projects: the store first, a scan only for what it
   * doesn't cover.
   *
   * The background sweep (`scanCharacterHoudiniProjects`) fills the store for
   * character-folder projects, so the common open is instant. What the store
   * cannot answer — a project linked from outside the character folder (never
   * swept, by design) or a `.hip` saved since the last sweep — is scanned HERE
   * and merged: a partial cache must not hide a linked project from the node
   * lists and the repairs. It never WAITS on the sweep either, because a sweep
   * is not guaranteed to deliver (no Houdini configured, external project).
   */
  async function loadCachedTargets(): Promise<Array<MaterialScanProject>> {
    if (targets.length === 0) {
      setTargetScan(EMPTY_SCAN)
      return []
    }
    if (!projectId) return scanTargets()
    setTargetScan({ loading: true, error: '', projects: [] })
    // Nudge the sweep in case this drawer was reached without the page mounting
    // one (it coalesces, so an already-running sweep is joined, not doubled).
    void scanCharacterHoudiniProjects({ data: { projectId, id: character.id } })
    const allCached = await fetchCachedHoudiniScans({ data: { projectId, id: character.id } })
    // The store answers for every project of the character, so it has to be
    // narrowed to THIS one before anything is shown — otherwise scoping the scan
    // would still leave the character's other projects on screen, served from
    // the cache, which is the exact thing this drawer stopped doing.
    const wanted = new Set(targets.map((t) => normalizePath(t).toLowerCase()))
    const cached = allCached.filter((p) => wanted.has(normalizePath(p.hipPath).toLowerCase()))
    const covered = new Set(cached.map((p) => normalizePath(p.hipPath).toLowerCase()))
    const uncovered = targets.filter((t) => !covered.has(normalizePath(t).toLowerCase()))
    if (uncovered.length === 0) {
      setTargetScan({ loading: false, error: '', projects: cached })
      return cached
    }
    try {
      const fresh = await scanHoudiniMaterials({
        data: { hipPaths: uncovered, projectId, characterId: character.id },
      })
      // Present in linked order, the way a full scan would.
      const byPath = new Map(
        [...cached, ...fresh].map((p) => [normalizePath(p.hipPath).toLowerCase(), p]),
      )
      const projects = targets
        .map((t) => byPath.get(normalizePath(t).toLowerCase()))
        .filter((p): p is MaterialScanProject => p !== undefined)
      setTargetScan({ loading: false, error: '', projects })
      return projects
    } catch (error) {
      // The cached half is still good — show it next to the error rather than
      // trading known projects for a message.
      const message = error instanceof Error ? error.message : String(error)
      setTargetScan({ loading: false, error: message, projects: cached })
      return cached
    }
  }

  // Read the project when the drawer opens. Opening a `.hip` costs real seconds,
  // so this deliberately does NOT re-run on every render — only on open, on an
  // explicit rescan, and if the target changes.
  //
  // It does NOT preselect the target's nodes, and the drawer is careful to
  // promise that nowhere. It used to: opening from a card ticked that project's
  // nodes, back when the drawer opened straight onto Material (#690). Two
  // changes since then made that unobservable — every tab switch clears the
  // selection, because it is per node KIND (#691), and the drawer now lands on
  // General, which shows no node list at all (#706). So the only tick a
  // transfer tab can ever show is one the USER made, which is also the right
  // default for something that writes to a `.hip`: the run's targets are chosen,
  // not inherited.
  useEffect(() => {
    if (!open) return
    void loadCachedTargets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetsKey])

  // Candidate source characters: sourceCharacterCandidates — this character's
  // OTHER projects included, minus the drawer's own target.
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
      .then((all) => setOthers(sourceCharacterCandidates(all, character.id, targetHip)))
      .catch(() => setOthers([]))
  }, [open, character.id, targetHip])

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
  // Few enough studio projects and the picker goes FLAT — one entry per
  // project, no character hop. Past the limit the flat list scrolls past
  // usefulness and the two-level character → project layout takes over.
  const flatSourceChoices =
    others.reduce((n, c) => n + c.houdiniProjects.length, 0) <= FLAT_SOURCE_LIMIT
  const activeSourceHip = sourceMode === 'browse' ? browsedHip : sourceHip

  // Scanning the chosen source project is a separate (and equally slow) trip —
  // only ever for the ONE file the user picked.
  // Slot names belong to a node, so a new source starts with none picked.
  useEffect(() => {
    setPickedMaterials(new Set())
  }, [selectedSource])

  /** The shortcut row under the picker — read on open, and again after each
   *  choice so the order the user just changed is the order they see. */
  const [sourceRecents, setSourceRecents] = useState<Array<HoudiniSourceRecent>>([])
  const loadSourceRecents = useCallback(async () => {
    setSourceRecents(await fetchHoudiniSourceRecents().catch(() => []))
  }, [])
  useEffect(() => {
    if (open) void loadSourceRecents()
  }, [open, loadSourceRecents])

  /**
   * Record a source as just used, then re-read the row so the order the user
   * just changed is the order they see.
   *
   * Called at the points where a file is BROWSED FOR — the picker, the drop
   * zone, and re-picking a chip — never from the effect that reacts to
   * `activeSourceHip`. Watching that would sweep up the two kinds of source the
   * row is not for: a project template (already a chip, one row up) and another
   * character's project (already in the Select), each of which would then appear
   * twice, in two rows, both highlighted. What this list is for is the file the
   * studio was never told about, and the only way one arrives is by being found
   * on disk.
   *
   * Remembered on CHOICE, not on a completed transfer: the expensive thing this
   * saves is the re-browsing, and that cost is paid the moment a file is picked
   * — whether or not the copy that follows is the one the user ultimately wants.
   */
  const rememberSource = useCallback(
    (hipPath: string) => {
      void rememberHoudiniSource({ data: { hipPath } })
        .then(loadSourceRecents)
        .catch(() => {})
    },
    [loadSourceRecents],
  )

  /** Drop a shortcut the user is done with. Unlike remembering, this one is
   *  ASKED for, so a failure is reported rather than swallowed. */
  const forgetSource = useCallback(
    async (hipPath: string) => {
      try {
        await forgetHoudiniSource({ data: { hipPath } })
        await loadSourceRecents()
      } catch (e) {
        utilsToast.error(e instanceof Error ? e.message : String(e))
      }
    },
    [loadSourceRecents],
  )

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
      rememberSource(picked)
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
  //
  // Filtered to the ACTIVE KIND. The selection USED to be preseeded with every
  // node of the card the drawer was opened from — all kinds at once — and a
  // project typically holds a material, a skeleton and an occlusion node, so an
  // occlusion run was being pointed at all three ("3 target nodes selected"
  // under a single ticked box). The Python refuses a node of the wrong type per
  // target, so nothing was ever written to one; the count and the report were
  // the lie. The node LIST is filtered by kind already — this makes the run
  // agree with what the user can actually see and tick. The preseed is gone now
  // (see the open effect), so the filter is a belt to that brace rather than the
  // only thing holding the count honest: keep it, because it is what guarantees
  // the count can never outgrow the visible list again.
  const targetRefs = useMemo(() => {
    const refs: Array<{ hipPath: string; nodePath: string }> = []
    for (const project of targetScan.projects) {
      for (const node of project.nodes) {
        if (node.nodeType !== kind) continue
        const key = nodeKey(project.hipPath, node.path)
        if (!selectedTargets.has(key)) continue
        if (key === selectedSource) continue
        refs.push({ hipPath: project.hipPath, nodePath: node.path })
      }
    }
    return refs
  }, [kind, targetScan, selectedTargets, selectedSource])

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
  const activeSections: Array<string> = isFolderKind(kind)
    ? FOLDER_KIND_UI[kind].sections.filter((key) => folderSections[kind].has(key))
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
          // Material-only knobs; every FOLDER kind copies wholesale (hence the
          // fixed `true`) and has no texture paths of its own to make portable.
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
          utilsToast.error(
            `${failed.length} of ${result.targets.length} target${result.targets.length === 1 ? '' : 's'} failed — see the report.`,
          )
        } else {
          // Report what actually travelled, not just the bakers — the run may
          // have carried material slots and UV channels too, and a toast that
          // names one part reads as "only that part was copied".
          // A folder kind has no slot/channel/baker counts to report — asking
          // for them yields "0 slots, 0 channels, 0 bakers" after a run that
          // copied an occlusion setup perfectly well. It names its sections.
          const moved = !sourceNode
            ? ''
            : isFolderKind(kind)
              ? activeSections.map((key) => FOLDER_KIND_UI[kind].labels[key]?.label ?? key).join(', ')
              : MATERIAL_SECTIONS.filter((key) => sections.has(key))
                  .map((key) => sectionCountOf(sourceNode.node, key, pickedMaterials))
                  .join(', ')
          const warnings = result.targets.reduce(
            (n, t) => n + t.missingMaterials.length + t.missingUvSources.length,
            0,
          )
          utilsToast.success(
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
        void scanTargets()
      }
    } catch (error) {
      utilsToast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  /** Projects whose `$JOB` differs from the character folder, whose timeline
   *  is not the pipeline's 30 fps, or whose playbar range differs from what
   *  their own Alembic file says — what a repair would actually write. A
   *  project the scan couldn't read is never queued: those values are unknown,
   *  not wrong. */
  const staleSettingProjects = useMemo(
    () => projectsNeedingRepair(targetScan.projects, charFolder),
    [targetScan, charFolder],
  )

  /** What a repath would do, and whether it may run yet (see `planRepath`). */
  const repath = useMemo(
    () => planRepath(targetScan.projects, charFolder),
    [targetScan, charFolder],
  )

  /** Projects with at least one blank parm the studio can fill. A parm this
   *  DazToHue version lacks is NOT work — it is reported in the row instead.
   *
   *  GATED on `$JOB` being correct, for the same reason the repath is: the
   *  values written are variable-anchored, so filling a project whose `$JOB`
   *  still points somewhere else would store paths that resolve into the wrong
   *  folder — and they would look right in the parameter field. Runtime v66
   *  narrowed the exposure without removing it: the import/CSV paths anchor on
   *  `$HIP` now, which cannot be wrong, but the final export directory is still
   *  `$JOB/<exportSubdir>` (nothing else can reach a folder BESIDE the houdini
   *  one), so a wrong `$JOB` still misplaces Houdini's own output. Repair the
   *  project settings first; the row above says so. */
  const prefillTargets = useMemo(
    () =>
      targetScan.projects
        .filter(
          (p) =>
            p.ok &&
            p.prefill.fillable.length > 0 &&
            p.job.trim() !== '' &&
            sameFolder(p.job, charFolder),
        )
        .map((p) => p.hipPath),
    [targetScan, charFolder],
  )

  /** Projects held back from Fill network by their `$JOB` — the reason the
   *  button's tooltip gives, so a disabled action is never a dead end.
   *
   *  UNKNOWN counts as blocked, not as "nothing to fill": a project that
   *  reports no `$JOB` at all (never Set Project'd) has work waiting and is
   *  refused for the same reason as a wrong one — there is nothing to anchor
   *  the written values on. Leaving it out of both sets is what made the
   *  button say "nothing blank the studio has an answer for" while holding a
   *  fillable project back. */
  const prefillBlockedByJob = useMemo(
    () =>
      targetScan.projects.filter(
        (p) =>
          p.ok &&
          p.prefill.fillable.length > 0 &&
          (p.job.trim() === '' || !sameFolder(p.job, charFolder)),
      ).length,
    [targetScan, charFolder],
  )

  /** Every project the scan could open — what a refresh would be run against.
   *
   *  No condition to filter on, unlike the three fixes above: a `.hip` carries
   *  no record of which DazToHue release its assets came from, so "needs
   *  refreshing" is not something the studio can detect. Every readable project
   *  is therefore a candidate and the user decides. */
  const refreshTargets = useMemo(
    () => targetScan.projects.filter((p) => p.ok).map((p) => p.hipPath),
    [targetScan],
  )

  /** How many of the tab's three CHECKS have a fix waiting — the footer's
   *  one-line verdict for the whole tab. Refresh assets is not among them: it
   *  answers to no check, so counting it would put a number on the tab that
   *  never reaches zero. */
  const fixesAvailable = [
    staleSettingProjects.length > 0,
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
      utilsToast.success(`${fileName(hipPath)} is back to the state it was in before the run.`)
      void scanTargets()
    } catch (error) {
      utilsToast.error(error instanceof Error ? error.message : String(error))
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
      const all = removed === paths.length
      utilsToast.success(
        all
          ? `${removed} backup${removed === 1 ? '' : 's'} removed.`
          : `${removed} of ${paths.length} backups removed — the rest are in use and stay.`,
        // The one drawer toast that does NOT stick around (see `utilsToast`):
        // a clean sweep is housekeeping the user just asked for and watched
        // happen, with nothing left to act on. The partial form keeps the
        // drawer's sticky default — it names copies still sitting on disk, and
        // the drawer closing behind it makes this their only mention.
        all ? { duration: TRANSIENT_TOAST_MS } : undefined,
      )
    } catch (error) {
      utilsToast.error(error instanceof Error ? error.message : String(error))
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
          utilsToast.error(`${failed.length} of ${result.prefill.length} projects failed — see below.`)
        } else {
          const filled = result.prefill.reduce((n, r) => n + r.filled.length, 0)
          utilsToast.success(
            `Filled ${filled} parameter${filled === 1 ? '' : 's'} the studio already knew.`,
          )
          setPrefillOpen(false)
        }
        void scanTargets()
      }
    } catch (error) {
      utilsToast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  /**
   * Run the DazToHue shelf's "Refresh Assets" on every readable project.
   *
   * Reported by what happened, never by a promise: the studio executes the
   * shelf tool's own script and cannot know what it did, so the toast counts
   * the projects the SCENE reported as modified and says nothing about the
   * rest. A dry run loads and runs but never saves — see `refreshHoudiniAssets`
   * for why that is a weaker guarantee than the other dry runs.
   */
  async function runRefresh(dryRun: boolean) {
    if (refreshTargets.length === 0) return
    setRunning(dryRun ? 'dry' : 'run')
    setActionReport(null)
    try {
      const result = await refreshHoudiniAssets({
        data: { hipPaths: refreshTargets, dryRun },
      })
      setActionReport({ kind: 'refresh', report: result })
      if (!dryRun) {
        noteBackups(result)
        const failed = result.refresh.filter((r) => !r.ok)
        if (failed.length > 0) {
          utilsToast.error(`${failed.length} of ${result.refresh.length} projects failed — see below.`)
        } else {
          const changed = result.refresh.filter((r) => r.changed).length
          utilsToast.success(
            changed === 0
              ? 'Refreshed — no project reported a change, so nothing was re-saved.'
              : `${changed} project${changed === 1 ? '' : 's'} refreshed and saved.`,
          )
          setRefreshOpen(false)
        }
        void scanTargets()
      }
    } catch (error) {
      utilsToast.error(error instanceof Error ? error.message : String(error))
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
          // The scope, not the export root itself: the api derives that (and the
          // SCAN derives it the same way, so the dry run and the card can never
          // disagree about which folder a broken import is rebuilt against).
          projectId,
          characterId: character.id,
          dryRun,
        },
      })
      setActionReport({ kind: 'repath', report: result })
      if (!dryRun) {
        noteBackups(result)
        const failed = result.repath.filter((r) => !r.ok)
        if (failed.length > 0) {
          utilsToast.error(`${failed.length} of ${result.repath.length} projects failed — see below.`)
        } else {
          const collapsed = result.repath.reduce((n, r) => n + r.collapsed, 0)
          const repaired = result.repath.reduce((n, r) => n + r.repaired.length, 0)
          const rehomed = result.repath.reduce((n, r) => n + r.rehomed.length, 0)
          utilsToast.success(
            `${collapsed} reference${collapsed === 1 ? '' : 's'} made portable` +
              (repaired > 0 ? `, ${repaired} broken one${repaired === 1 ? '' : 's'} repaired` : '') +
              // `reference(s)` spelled out: the confirm dialog promised a
              // count of FILES (`rehomable` is de-duplicated paths, so the
              // General tab can intersect it with `missingTextures`) while the
              // run reports the PARMS it rewrote — one moved product is named
              // by many layers, so this number is legitimately the larger one.
              // Naming the unit is what keeps the pair from reading as a
              // contradiction.
              (rehomed > 0
                ? `, ${rehomed} reference${rehomed === 1 ? '' : 's'} rehomed onto $DAZ3D_LIB`
                : '') +
              '.',
          )
          setRepathOpen(false)
        }
        void scanTargets()
      }
    } catch (error) {
      utilsToast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  async function runDefaults(dryRun: boolean) {
    if (staleSettingProjects.length === 0) return
    setRunning(dryRun ? 'dry' : 'run')
    setActionReport(null)
    try {
      const result = await repairHoudiniDefaults({
        data: {
          targets: staleSettingProjects.map((hipPath) => ({ hipPath, jobDir: charFolder })),
          dryRun,
        },
      })
      setActionReport({ kind: 'defaults', report: result })
      if (!dryRun) {
        noteBackups(result)
        const failed = result.defaults.filter((d) => !d.ok)
        const changed = result.defaults.filter((d) => d.ok && d.changed).length
        if (failed.length > 0) {
          utilsToast.error(`${failed.length} of ${result.defaults.length} projects failed — see below.`)
        } else {
          // Named by what the run actually rewrote: a project can need only the
          // timeline, and "$JOB repaired" on that one would be a claim about
          // something nobody touched.
          const jobs = result.defaults.filter((d) => d.ok && d.changedJob).length
          const fpsFixed = result.defaults.filter((d) => d.ok && d.changedFps).length
          const rangeFixed = result.defaults.filter((d) => d.ok && d.changedRange).length
          const parts = [
            jobs > 0 ? `$JOB on ${jobs} project${jobs === 1 ? '' : 's'}` : '',
            fpsFixed > 0
              ? `the timeline on ${fpsFixed} project${fpsFixed === 1 ? '' : 's'}`
              : '',
            rangeFixed > 0
              ? `the frame range on ${rangeFixed} project${rangeFixed === 1 ? '' : 's'}`
              : '',
          ].filter(Boolean)
          utilsToast.success(
            parts.length > 0
              ? `Repaired ${parts.join(' and ')}.`
              : `Nothing needed changing on ${changed === 1 ? 'the project' : 'these projects'}.`,
          )
          setDefaultsOpen(false)
        }
        // The files changed on disk — their scanned $JOB, FPS and range are now stale.
        void scanTargets()
      }
    } catch (error) {
      utilsToast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setRunning('')
    }
  }

  return (
    <>
      <SidePanel
        open={open}
        // A util mid-run holds the drawer: Escape / the backdrop / the ✕ are
        // refused (and the ✕ greys out) until it lands.
        dismissible={!busy}
        // Not `onClose` directly: a session that wrote backups is asked about
        // them on the way out (see `requestClose`).
        onClose={requestClose}
        // Names the KIND of thing being worked on, not just the character: the
        // drawer acts on Houdini projects, and "Utils — Ita" gave no clue which
        // of the character's many facets it touches.
        title={
          <span className="flex items-center gap-2">
            <img src={houdiniLogo} alt="" aria-hidden className="size-5 shrink-0 object-contain" />
            <span className="truncate">
              Houdini project utils
              {/* The PROJECT is the subject, not the character — the drawer acts
                  on this one `.hip` and nothing else, so its name belongs in the
                  title rather than as an "opened from" aside next to a character
                  who may own several. */}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {fileName(targetHip)} · {character.name}
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
            {FOLDER_KINDS.map((folderKind) => (
              <TabsTrigger key={folderKind} value={folderKind}>
                {FOLDER_KIND_UI[folderKind].tab}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            <GeneralTab
              scan={targetScan}
              charFolder={charFolder}
              result={actionReport}
              repathReason={repath.reason}
              restore={restore}
              onRescan={() => void scanTargets(true)}
            />
          </TabsContent>

          {/* One body for both transfer tabs: the flow is identical and only the
              section list and the material picker differ, so `value={kind}`
              keeps the single content mounted for whichever is active. */}
          <TabsContent value={kind} className="space-y-6">
            {/* Per KIND: the material node's baker/UV story was being printed
                on the Skeleton tab, and then on both occlusion tabs — a
                paragraph about texture bakers above a list of bone rules. */}
            <p className="text-xs text-muted-foreground">
              {isFolderKind(kind) ? (
                FOLDER_KIND_UI[kind].blurb
              ) : (
                <>
                  Copy the texture-baker setup of one material node onto this character&apos;s
                  material nodes. Bakers name their material and geometry groups as text, so a
                  target that doesn&apos;t define those names takes the bakers and bakes nothing —
                  the dry run lists exactly that before anything is written.
                </>
              )}
            </p>

            {/* ---------------------------------------------------------- target */}
            <section>
              {/* Title + Rescan on one line, the shape the General tab's own
                  heading has. The file name is deliberately NOT printed here:
                  the drawer title carries it, and the project card immediately
                  below prints it again as its heading — three copies of one
                  name inside 200px, where the line used to carry a COUNT of
                  the character's projects and so said something the cards
                  didn't. */}
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Label className="flex w-fit items-center gap-1 text-base font-semibold">
                  Target
                  <InfoPopup label="Target — more information">
                    The DazToHue material nodes in <strong>this</strong> project. Select every node
                    that should receive the copied bakers. Utils act on the one project you opened
                    them from — to work on another, open its own card&apos;s Utils.
                  </InfoPopup>
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={targetScan.loading || targets.length === 0}
                  onClick={() => void scanTargets(true)}
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
                // Not "no projects linked": this one IS linked — it is the card
                // the drawer was opened on. An empty list here means the scan
                // came back without it.
                empty="The scan returned nothing for this project — try Rescan."
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
                {flatSourceChoices ? (
                  <Select
                    value={sourceMode === 'studio' ? sourceHip : ''}
                    onValueChange={(value) => {
                      setSourceMode('studio')
                      setSourceHip(value)
                    }}
                  >
                    <SelectTrigger className="w-80">
                      <SelectValue placeholder="Houdini project from the studio…" />
                    </SelectTrigger>
                    <SelectContent>
                      {others.flatMap((c) =>
                        c.houdiniProjects.map((hip) => (
                          <SelectItem key={`${c.projectId}|${c.id}|${hip}`} value={hip}>
                            {hipStem(hip)} — {c.projectName}
                          </SelectItem>
                        )),
                      )}
                    </SelectContent>
                  </Select>
                ) : (
                  <>
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
                  </>
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
                    // A drop is a browse that skipped the dialog — same file
                    // found the same way, so it earns the same shortcut.
                    rememberSource(dropped)
                  }}
                >
                  <Button variant="outline" size="sm" onClick={() => void onBrowse()}>
                    <FolderOpen /> Browse…
                  </Button>
                </FileDropZone>
              </div>

              {/* The shortcut row: the last few sources, newest first. Same
                  affordance as the templates above (a chip that IS the pick),
                  because it answers the same question — "the file I keep coming
                  back to" — for the ones the studio was never told about. Files
                  that have since disappeared are already filtered out, so every
                  chip here opens. */}
              {sourceRecents.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1 text-xs text-muted-foreground">Recently used</p>
                  <div className="flex flex-wrap gap-2">
                    {sourceRecents.map((recent) => {
                      const active =
                        normalizePath(activeSourceHip).toLowerCase() ===
                        normalizePath(recent.path).toLowerCase()
                      return (
                        // The chip is a two-control group, not one button: a
                        // ✕ nested inside a <button> is invalid HTML and the
                        // click would belong to the outer one either way.
                        <span
                          key={recent.path}
                          className={`group flex max-w-full items-center rounded-md border text-sm ${
                            active
                              ? 'border-houdini-orange bg-houdini-orange/15 font-medium'
                              : 'text-muted-foreground'
                          }`}
                        >
                          <button
                            type="button"
                            // The full path, because the chip shows only the
                            // file name and two templates called `Base.hiplc`
                            // in different folders are otherwise
                            // indistinguishable.
                            title={displayPath(recent.path)}
                            onClick={() => {
                              setSourceMode('browse')
                              setBrowsedHip(recent.path)
                              // Re-picking floats it back to the top — the file
                              // you keep coming back to stays where you look.
                              rememberSource(recent.path)
                            }}
                            className="flex min-w-0 items-center gap-2 rounded-l-md py-1.5 pr-1.5 pl-2.5 hover:bg-accent/50"
                          >
                            <img
                              src={houdiniLogo}
                              alt=""
                              aria-hidden
                              className="size-4 shrink-0 object-contain"
                            />
                            <span className="truncate">{fileName(recent.path)}</span>
                          </button>
                          {/* Removing a shortcut is not removing a file, so it
                              needs no confirmation — but it stays quiet until
                              the chip is hovered/focused so the row still reads
                              as a list of files rather than a row of ✕. */}
                          <button
                            type="button"
                            aria-label={`Remove ${fileName(recent.path)} from recently used`}
                            title="Remove from Recently used (the .hip is not touched)"
                            onClick={() => void forgetSource(recent.path)}
                            className="shrink-0 rounded-r-md py-1.5 pr-1.5 pl-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                          >
                            <X className="size-3.5" />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

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
                  {isFolderKind(kind) ? (
                    <>
                      Each of these is one of the node&apos;s own folders, copied as a whole:
                      its settings and any lists inside it replace the target&apos;s. They are
                      independent of each other — tick only what you want to reuse. The
                      node&apos;s <strong>Linking</strong> folder is deliberately not offered:
                      it holds parameter references, and DTH node names are identical in every
                      project, so a copied reference would rebind to the target&apos;s own node.
                    </>
                  ) : (
                    <>
                      These are one setup, not three: a texture baker names its material
                      (<code>MI_Skin</code>) and its layers name UV channels
                      (<code>uv_original</code>, <code>uv_geoshell</code>) as plain text. Copying
                      the bakers alone leaves those names pointing at nothing, and they bake
                      nothing — which is why all three are on by default.
                    </>
                  )}
                </InfoPopup>
              </Label>
              <div className="space-y-1">
                {isFolderKind(kind)
                  ? FOLDER_KIND_UI[kind].sections.map((key) => {
                      const count = sourceNode?.node.sectionCounts.find((s) => s.key === key)?.count
                      const meta = FOLDER_KIND_UI[kind].labels[key]
                      return (
                        <label key={key} className="flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={folderSections[kind].has(key)}
                            onChange={() => toggleFolderSection(kind, key)}
                          />
                          <span>
                            <span className="font-medium">{meta.label}</span>
                            {count !== undefined && (
                              <span className="ml-1 text-muted-foreground">
                                ({count} setting{count === 1 ? '' : 's'})
                              </span>
                            )}
                            <br />
                            <span className="text-xs text-muted-foreground">{meta.hint}</span>
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
              {isFolderKind(kind) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {FOLDER_KIND_UI[kind].sectionPhrase} is copied <strong>wholesale</strong> — its
                  settings and its lists replace the target&apos;s. Appending one list onto another
                  (22 bone renames onto 22 existing ones) would make 44 rules, not a merged setup.
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
            {/* One summary for the tab's three CHECKS: the old line described
                only the $JOB repair, which read as the whole tab's verdict.
                Refresh assets is counted nowhere here — it answers to no check
                — and each button still carries its own reason in its tooltip. */}
            <span className="mr-auto text-xs text-muted-foreground">
              {targetScan.loading
                ? 'Reading the project…'
                : fixesAvailable === 0
                  ? 'Nothing to fix — every check already passes.'
                  : `${fixesAvailable} of 3 checks need fixing`}
            </span>
            {/* First, because it can change WHICH parameters a project has: an
                asset refresh replaces the stored DazToHue definitions with the
                installed ones, and the rescan afterwards is what lets "Fill
                network" see a parameter a newer release added. (Reasoned from
                what an HDA refresh is, not measured here.) */}
            <Button
              variant="outline"
              disabled={busy || refreshTargets.length === 0}
              title={
                refreshTargets.length === 0
                  ? 'The project could not be read'
                  : 'Run the DazToHue shelf’s own Refresh Assets on this project'
              }
              onClick={() => {
                setActionReport(null)
                setRefreshOpen(true)
              }}
            >
              <Blocks /> Refresh assets
            </Button>
            {/* Ordered the way they must be RUN: repathing collapses against
                whatever $JOB the scene carries, so the repair comes first. */}
            <Button
              variant="outline"
              disabled={busy || staleSettingProjects.length === 0 || !charFolder}
              title={
                !charFolder
                  ? 'The character folder could not be resolved'
                  : staleSettingProjects.length === 0
                    ? 'Nothing differs — this project already points $JOB at the character folder, runs at 30 fps and plays the Alembic’s own frame range'
                    : undefined
              }
              onClick={() => {
                setActionReport(null)
                setDefaultsOpen(true)
              }}
            >
              <Wrench /> Repair project settings
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
                prefillBlockedByJob > 0
                  ? 'Repair the project settings first — the values are anchored on $JOB, so this project would get paths anchored on the wrong folder, or on none.'
                  : prefillTargets.length === 0
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
          title="Repair the project settings?"
        >
          <div className="space-y-2 text-sm">
            <p>
              Put <code>$JOB</code> on <strong>{displayPath(charFolder)}</strong>, the timeline
              on <strong>{DTH_FPS} fps</strong> and the playbar on the{' '}
              <strong>Alembic file&apos;s own frame range</strong> in{' '}
              <strong>{staleSettingProjects.length}</strong> project
              {staleSettingProjects.length === 1 ? '' : 's'} — whichever of the three actually
              differs there.
            </p>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
              {staleSettingProjects.map((hip) => (
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
            The <code>$JOB</code> half fixes paths you pick <strong>from now on</strong>:
            Houdini will collapse an export you choose to <code>$HIP/…</code> (or{' '}
            <code>$JOB/…</code> when it sits outside the project&apos;s own folder) instead of
            writing it absolute. Paths already stored absolute stay exactly as they are —
            repointing <code>$JOB</code> does not rewrite existing references.
          </p>

          {/* Named because it is the one thing here that can touch existing
              WORK rather than metadata, and the studio has not measured what
              Houdini does to keyframes at that moment. The backup is the
              answer, so it is mentioned in the same breath. */}
          <p className="rounded-md border p-3 text-xs text-muted-foreground">
            The timeline is changed with Houdini&apos;s own <code>setFps</code>. On a scene that
            already holds animation, how it treats those keys is Houdini&apos;s behaviour and
            not something this studio has measured — the run backs each project up first, and
            a failed one can be put straight back from the report.
          </p>

          {/* The range half is the vendor's own logic, named so the user knows
              nothing bespoke touches their scene — and the no-Alembic case is
              stated because "left alone" is the surprising outcome. */}
          <p className="rounded-md border p-3 text-xs text-muted-foreground">
            The playbar range is read off the project&apos;s own exported Alembic file and
            applied the way DazToHue&apos;s Import node does it — set the range, re-cook the
            import, back to frame 0. A project whose Daz export hasn&apos;t produced that file
            yet has nothing to read and is left alone.
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

      {refreshOpen && (
        <Modal
          open
          onClose={() => setRefreshOpen(false)}
          dismissible={!busy}
          title="Refresh the DazToHue assets?"
        >
          <div className="space-y-2 text-sm">
            <p>
              Run the DazToHue shelf&apos;s own <strong>Refresh Assets</strong> tool on{' '}
              <strong>{refreshTargets.length}</strong> project
              {refreshTargets.length === 1 ? '' : 's'} — the same tool you would press inside
              Houdini after switching DazToHue release.
            </p>
            <ul className="max-h-32 list-inside list-disc overflow-y-auto text-xs text-muted-foreground">
              {refreshTargets.map((hip) => (
                <li key={hip}>
                  <code>{fileName(hip)}</code>
                </li>
              ))}
            </ul>
          </div>

          {/* The honest limits, stated where the decision is made. This action
              runs code the studio did not write and cannot inspect, so it
              promises what it can observe and nothing more. */}
          <p className="rounded-md border p-3 text-xs text-muted-foreground">
            The studio runs DazToHue&apos;s own tool rather than doing the refresh itself, so it
            can&apos;t tell you in advance what will change — and no check anywhere says a project
            needs this. A project is only saved if the scene reports itself modified afterwards.
          </p>

          <p className="text-xs text-muted-foreground">
            A real run saves each changed project. Close them in Houdini first — Houdini writes the
            whole scene on save and would overwrite this. A <strong>dry run</strong> still opens
            each project and runs the tool; it just never saves the file.
          </p>

          {actionReport?.kind === 'refresh' && (
            <RefreshReport report={actionReport.report} restore={restore} />
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setRefreshOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void runRefresh(true)}>
              {running === 'dry' ? <Loader2 className="animate-spin" /> : null} Dry run
            </Button>
            <Button disabled={busy} onClick={() => void runRefresh(false)}>
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
            skipped and named in the report, so this stays useful on an older DazToHue and
            starts filling the newer parameters by itself once you install one that has them.
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
            {/* Only the clauses with work in them — `joinClauses` picks the
                lead, the casing and the `and`. All three matter now that a
                project can arm this button on `rehomable` ALONE (a moved
                library, nothing to collapse): the old fixed sentence opened
                with "Rewrite 0 references" there, and its `and` was hard-coded
                onto the rehome clause, so the far commoner broken-only run
                lost the conjunction. */}
            <p>
              {joinClauses([
                repath.collapsible > 0 && {
                  key: 'collapse',
                  verb: 'rewrite',
                  rest: (
                    <>
                      <strong>{repath.collapsible}</strong> reference
                      {repath.collapsible === 1 ? '' : 's'} to sit under <code>$HIP</code>,{' '}
                      <code>$JOB</code> or <code>$DAZ3D_LIB</code>
                    </>
                  ),
                },
                repath.broken > 0 && {
                  key: 'broken',
                  verb: 'rebuild',
                  rest: (
                    <>
                      <strong>{repath.broken}</strong> broken DazToHue import reference
                      {repath.broken === 1 ? '' : 's'}
                    </>
                  ),
                },
                repath.rehomable > 0 && {
                  key: 'rehome',
                  verb: 'repoint',
                  rest: (
                    <>
                      <strong>{repath.rehomable}</strong> file
                      {repath.rehomable === 1 ? '' : 's'} from another library root at your
                      Daz library (<code>$DAZ3D_LIB</code>)
                    </>
                  ),
                },
              ])}{' '}
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
          title={
            isFolderKind(kind)
              ? `Copy ${FOLDER_KIND_UI[kind].tab.toLowerCase()} setup?`
              : 'Copy material setup?'
          }
        >
          <div className="space-y-2 text-sm">
            <p>
              Copy{' '}
              <strong>
                {isFolderKind(kind)
                  ? FOLDER_KIND_UI[kind].sections
                      .filter((key) => folderSections[kind].has(key))
                      .map((key) => FOLDER_KIND_UI[kind].labels[key].label)
                      .join(', ')
                  : MATERIAL_SECTIONS.filter((key) => sections.has(key))
                      .map((key) => sectionCountOf(sourceNode.node, key, pickedMaterials))
                      .join(', ')}
              </strong>{' '}
              from <strong>{labelFor(sourceNode.project.hipPath, sourceNode.node.path)}</strong> in{' '}
              <code>{fileName(sourceNode.project.hipPath)}</code> to{' '}
              <strong>{targetRefs.length}</strong> {isFolderKind(kind) ? 'target' : 'material'} node
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

          {/* EVERY folder kind, not just the skeleton one: the replace switch
              governs material UV channels and bakers, and `op_transfer_folders`
              does not read `replace` at all — a folder section is always
              copied wholesale. Left on `=== 'skeleton'`, both occlusion tabs
              offered a switch that could not do anything, above a line about
              material slots merging by surface that no occlusion run has. */}
          {isFolderKind(kind) ? (
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
