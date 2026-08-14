/**
 * The DTH Export side panel itself: the three stacked legs (Daz scenes, Houdini
 * projects, Unreal projects), their selection state and the Start gate.
 *
 * Split out of `dth-export.tsx` — the button and its run lifecycle stayed
 * there, this is only what the drawer shows. Nothing here changed in the move.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'

import {
  Button,
  InfoPopup,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SidePanel,
} from '@dth/ui'
import dthLogo from '#/assets/dth-logo.webp'
import { RunnerGateNotice } from '#/components/runner-gate-notice.tsx'
import {
  executeCharacterJobs,
  fetchCachedHoudiniScans,
  fetchExecuteScenes,
  fetchExportRunnerGate,
  fetchSceneDthPaths,
  fetchUnrealSendPlan,
  fileExists,
} from '#/lib/rom/api.ts'
import {
  hipsForSelectedScenes,
  normalizeSceneKey,
  preCheckedScenes,
  scenesMissingExport,
  scenesMissingRomAnimation,
} from '#/lib/rom/execute-jobs.ts'
import type { ExecuteSceneStatus, RunnerGate, UnrealSendPlan } from '#/lib/rom/api.ts'
import type {
  ExportMode,
  HoudiniProjectImports,
  HoudiniRunMode,
  RunChoice,
} from '#/lib/rom/execute-jobs.ts'
import type { Character } from '@dth/rom'

import { EMPTY_SELECTION } from './progress.tsx'
import {
  DAZ_MODE_OPTIONS,
  HOUDINI_MODE_OPTIONS,
  HipRow,
  SceneRow,
  UnrealRow,
} from './rows.tsx'

export function DthExportPanel({
  projectId,
  character,
  unrealProjects,
  onClose,
  onExported,
  onHoudiniQueue,
  onUnrealOnly,
}: {
  projectId: string
  character: Character
  /** The project's linked `.uproject`s — the run's third leg. */
  unrealProjects: ReadonlyArray<string>
  onClose: () => void
  /** A handoff was written — the header button flips to Abort. Carries the
   *  run's selection (run order) for the header's task cards; `houdiniProjects`
   *  is empty when the Houdini leg won't run exports (open-only, rom-only),
   *  `houdiniScenes` = the scene scope that leg will export (its networks). */
  onExported: (run: {
    scenes: Array<string>
    houdiniProjects: Array<string>
    houdiniScenes: Array<string>
    /** The Unreal projects the run finishes into ([] = none picked). */
    unrealProjects: Array<string>
    /** The export sets to hand over — the user's own tick list. */
    unrealSets: Array<string>
    /** Which of those sets each project ALREADY holds (the send plan's probe) —
     *  what lets the run's Unreal rows say "Re-import" instead of guessing.
     *  undefined when the probe never landed: the rows then claim a plain
     *  "Import" and the send decides (it re-probes for real). */
    unrealLocated: Record<string, Record<string, string>> | undefined
    /** What the batch does to each scene — the Daz rows' subtitle. */
    mode: ExportMode
    /** The handoff started Daz itself (vs. handing to a running one). */
    dazLaunched: boolean
    /** Daz was ALREADY up, so it owes the batch a claim — the run watch waits
     *  for it and falls back to the wait-for-close modal. Never waited on here:
     *  that is what kept Start on "Starting..." for ten seconds. */
    dazWasRunning: boolean
  }) => void
  /** A skip-Daz run handed its selection straight to Houdini (no Daz batch) —
   *  the caller starts the sequential project queue on these scenes. */
  onHoudiniQueue: (
    projects: Array<string>,
    scenes: Array<string>,
    unrealProjects: Array<string>,
    unrealSets: Array<string>,
    unrealLocated: Record<string, Record<string, string>> | undefined,
  ) => void
  /** Neither Daz nor Houdini runs — the whole run is the Unreal send, off the
   *  exports already on disk. */
  onUnrealOnly: (
    unrealProjects: Array<string>,
    unrealSets: Array<string>,
    unrealLocated: Record<string, Record<string, string>> | undefined,
  ) => void
}) {
  // Rows render immediately from the linked scenes; the affected-detection
  // (one stat + signature per scene) fills in and pre-checks the changed ones.
  const [status, setStatus] = useState<Array<ExecuteSceneStatus> | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  /**
   * The user has picked their own scenes, so stop re-seeding them.
   *
   * Each Daz mode has its own "outstanding work" rule, and switching mode used
   * to re-run it over the whole list — which quietly threw away a hand-made
   * selection: picking one scene and then switching to "Skip Daz" re-checked
   * every scene that has an export, and the Houdini list (which follows the
   * scenes) came with it. Seeding is a courtesy for a list nobody has touched;
   * after that it is the user's list.
   */
  const [scenesTouched, setScenesTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  // The Daz Mode dropdown. The ref mirrors it for the scene probe (kicked off
  // at mount), which seeds the pre-selection whenever it lands.
  const [mode, setMode] = useState<RunChoice>('rom-export')
  const modeRef = useRef<RunChoice>('rom-export')
  // The Houdini list's selection + its Mode dropdown. `export-selected` is the
  // default the moment a project joins the run; `skip` runs no Houdini at all
  // and is offered only when the project has a linked `.uproject` to send to.
  const [checkedHips, setCheckedHips] = useState<ReadonlySet<string>>(new Set())
  const [houdiniMode, setHoudiniMode] = useState<HoudiniRunMode>('export-selected')
  // Projects whose `.hip` is gone from disk — their rows are refused up front
  // (startHoudiniExport would throw, but only after the run was armed). The
  // ref twins the state for the scene probe's auto-selection, which may run
  // before OR after this probe lands.
  const [hipMissing, setHipMissing] = useState<ReadonlySet<string>>(new Set())
  const hipMissingRef = useRef<ReadonlySet<string>>(new Set())
  // What each linked project's networks IMPORT, from the stored scan (no
  // hython here — a `.hip` costs tens of seconds to open). Drives the
  // scene→project auto-selection; a project the sweep hasn't reached yet
  // simply isn't in this list and is never un-ticked on that ignorance.
  const [hipImports, setHipImports] = useState<Array<HoudiniProjectImports>>([])
  // Each linked scene's expected `.dth`, resolved in the api layer (it needs
  // the project's scenes root — see fetchSceneDthPaths). Keyed by
  // normalizeSceneKey, the same spelling the scene checkboxes carry.
  const [sceneDth, setSceneDth] = useState<Record<string, string>>({})
  // null = still checking (Start stays off for the moment the probe takes).
  const [runner, setRunner] = useState<RunnerGate | null>(null)
  // The Unreal list's selection, and which projects already hold this
  // character (the pre-selection, the Unreal twin of "changed since the last
  // export" and "imports a selected scene").
  const [checkedUnreal, setCheckedUnreal] = useState<ReadonlySet<string>>(new Set())
  // The character's export sets + which of them each linked project holds.
  // null = the probe hasn't landed.
  const [sendPlan, setSendPlan] = useState<UnrealSendPlan | null>(null)

  /**
   * Every export set any linked Houdini project declares it writes — a superset
   * of what any selection of them can put in play.
   *
   * The send plan probes THESE as well as the export folder's own, because the
   * panel states where each set lands and a set this run CREATES is not on
   * disk to be found. Probed only for the folder's contents, `located` answered
   * "not in that project" about names it had never looked for, and the row said
   * `new — /Game/DazToHue/<Set>` as a fact — while `startUnrealImport` re-probes
   * for real at handover and would refresh it wherever the project actually
   * keeps it. A stated destination the send then ignores is the one thing this
   * section may not do.
   */
  const scannedSets = [...new Set(hipImports.flatMap((scan) => scan.exportSets ?? []))].sort()
  /** Deps for the probe below: the names themselves, not the array identity
   *  `hipImports` rebuilds on every fetch. Serialized rather than joined on a
   *  separator: an export set is an HDA `character_name` and may contain
   *  anything, so `['Lara Classic']` and `['Lara', 'Classic']` must not collide
   *  into one key. */
  const scannedSetsKey = JSON.stringify(scannedSets)

  useEffect(() => {
    if (unrealProjects.length === 0) return
    let active = true
    void fetchUnrealSendPlan({ data: { projectId, id: character.id, extraSets: scannedSets } })
      .then((plan) => {
        if (active) setSendPlan(plan)
      })
      .catch(() => {
        // Leave it UNSET. A failed probe is "the studio cannot say", and the
        // rest of the panel already reads null that way: the rows stay
        // tickable, nothing pre-ticks, and the send falls back to the whole
        // export folder. Answering `{sets: [], located: {}}` here instead made
        // the failure indistinguishable from an empty export folder — which
        // now disables the rows and states "nothing exported yet", i.e. blocks
        // the send on something the studio never learned.
      })
    return () => {
      active = false
    }
    // Twice at most: once at mount (the export folder alone, so `skip` has its
    // answer immediately) and again when the stored scans land and name the
    // sets a run could create. `scannedSets` IS `scannedSetsKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedSetsKey])

  useEffect(() => {
    let active = true
    void Promise.all(
      character.houdiniProjects.map(async (hip) => ({
        hip,
        // A throwing probe must not mark a real project missing — only a
        // definite "not there" refuses the row.
        exists: await fileExists({ data: { path: hip } }).catch(() => true),
      })),
    ).then((probed) => {
      if (!active) return
      const missing = new Set(probed.filter((p) => !p.exists).map((p) => p.hip))
      hipMissingRef.current = missing
      setHipMissing(missing)
      // Strip missing projects out of whatever is already selected (the
      // auto-selection may have landed first and taken everything).
      if (missing.size > 0) {
        setCheckedHips((prev) => new Set([...prev].filter((hip) => !missing.has(hip))))
      }
    })
    return () => {
      active = false
    }
    // Mount-only, for the scene probe's reason (below): a refetch mid-pick
    // would rebuild `hipMissing` under the user's selection. NOT because the
    // drawer is modal — it isn't, see there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([
      fetchCachedHoudiniScans({ data: { projectId, id: character.id } }),
      fetchSceneDthPaths({ data: { projectId, id: character.id } }),
    ])
      .then(([scans, dthPaths]) => {
        if (!active) return
        setSceneDth(dthPaths)
        setHipImports(
          scans.map((scan) => ({
            hipPath: scan.hipPath,
            imports: scan.imports,
            // The sets this project WRITES — what the Unreal pre-selection
            // asks about. Dropping it here is what made every run read as
            // "cannot tell" no matter how fresh the scan was.
            exportSets: scan.exportSets,
          })),
        )
      })
      .catch(() => {
        // Read-only convenience: no scan, no auto-adjust — the list simply
        // keeps whatever the user picked.
      })
    return () => {
      active = false
    }
    // Mount-only, like the probes above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let active = true
    // A failed probe must not brick exporting — only a definite missing/
    // outdated verdict blocks (the gate itself already treats unreadable
    // runner states as unblocked).
    fetchExportRunnerGate()
      .then((gate) => {
        if (active) setRunner(gate)
      })
      .catch(() => {
        if (active) setRunner({ blocked: false })
      })
    return () => {
      active = false
    }
  }, [])

  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const rows: Array<ExecuteSceneStatus> =
    status ??
    linked.map((scenePath, index) => ({
      scenePath,
      primary: index === 0,
      affected: false,
      missing: false,
      romExists: false,
      romUnexported: false,
      exportExists: false,
    }))

  /**
   * The "Export only" Start gate: SELECTED scenes with no saved ROM animation
   * ({@link scenesMissingRomAnimation} — the same rule the pre-handoff re-check
   * in `onExport` applies). With a landed, CURRENT status the row controls keep
   * such scenes out of the selection, so this stays empty; it fires when the
   * status under the selection has gone STALE — the re-check writes its fresh
   * probe back via `setStatus`, and this then disables Start, shows the notice
   * naming the scenes, and marks the refused rows. A CHECKED refused row can
   * still be unchecked (see the checkbox in {@link SceneRow}), so the notice's
   * "unselect it" advice is real. While the probe is still in flight nothing is
   * known — the gate stays empty and Start waits as "Checking scenes…" instead
   * (`checking` below).
   */
  const noRomChecked = scenesMissingRomAnimation(mode, status, checked)
  /** The skip-Daz Start gate, {@link noRomChecked}'s sibling: selected scenes
   *  whose last Daz export is not on disk — nothing to rely on. Moot under
   *  "Skip Houdini", which runs no export and therefore consumes none: it
   *  hands over what is already in the character's export folder. */
  const noExportChecked =
    houdiniMode === 'skip' ? [] : scenesMissingExport(mode, status, checked)
  // The probe (one stat per scene) is sub-second; holding Start for it closes
  // the window where a row checked mid-flight could start with unknown state.
  // Both artifact-gated modes wait it out the same way.
  const checking = (mode === 'export-only' || mode === 'houdini-only') && status === null
  /**
   * Whether this run has something to hand over: a Houdini project that
   * EXPORTS, or the deliberate `skip` that sends the exports already on disk.
   *
   * **ROM only is excluded even though it forces `skip`.** That mode stops
   * before Houdini, so its send could only hand over the PREVIOUS export while
   * the run reads as "the new ROM reached Unreal" — the misleading success this
   * studio exists to avoid, and the same reasoning that makes `executeJobs`
   * refuse a rom-only run with Houdini projects attached. `skip` is a CHOICE
   * ("use last exports") when the user picks it; under rom-only it is merely
   * what `pickMode` was left with, and inheriting a send from it would be a
   * choice nobody made.
   */
  const unrealSendable = mode !== 'rom-only' && (houdiniMode === 'skip' || checkedHips.size > 0)

  /**
   * The export sets THIS RUN will produce, or null when the studio cannot say.
   *
   * Each checked Houdini project declares the sets it writes (its export
   * nodes' `character_name`, read in the project scan). A project the scan has
   * never reached declares nothing — and "not known" is not "writes nothing",
   * so one unscanned project makes the whole answer null.
   *
   * **Null pre-ticks NOTHING**, rather than falling back to "does this project
   * hold this character at all". That fallback is what the report was about:
   * picking the THICK project ticked an Unreal project because it held a
   * DIFFERENT variant, and the run then imported one nobody asked for. An
   * un-ticked row the user can tick costs a click; a ticked one they did not
   * mean costs a stray character in their project.
   *
   * Under `skip` the run produces nothing new: the sets in play are whatever is
   * on disk, so the question does not arise and presence alone decides.
   */
  const runSets =
    houdiniMode === 'skip'
      ? null
      : (() => {
          const chosen = character.houdiniProjects.filter((hip) => checkedHips.has(hip))
          if (chosen.length === 0) return null
          const known = chosen.map((hip) => hipImports.find((scan) => scan.hipPath === hip))
          if (known.some((scan) => scan === undefined || scan.exportSets === undefined)) return null
          return new Set(known.flatMap((scan) => scan?.exportSets ?? []))
        })()

  /**
   * WHAT the send hands over: the export sets this run puts in play, or null
   * when the studio cannot name them (→ every set in the export folder, which
   * is what an empty `sets` means to `startUnrealImport`).
   *
   * **There is no per-set tick list.** There was one, and it was drawn from the
   * export folder — i.e. from what a PREVIOUS run had written — which made it
   * an answer to the wrong question. Reported on the run it was built for: a
   * THICK variant whose Houdini project writes `LaraClassic_THICK` and
   * `LaraNaked_THICK` offered `LaraClassic` and `LaraNaked` to tick, because
   * those are what happened to be on disk. The sets the run was ABOUT to make
   * were not in the list at all, and since a ticked project with no ticked set
   * held Start, the one thing the picker made impossible was the thing it was
   * for: putting a new character into an Unreal project. A choice that can only
   * re-pick the past is not a choice.
   *
   * So the run names its own sets, and nothing is asked. Under `skip` ("use
   * last exports") those ARE the folder's contents, which is not a prediction;
   * under an export run they are what the checked Houdini projects declare they
   * write (the stored scan), and an unscanned project makes the answer null
   * rather than a guess. Nothing renders them — which of the character's sets
   * this run makes, and whether each is a re-import, is the studio's own answer
   * and the run's task cards say it per set once Start is pressed.
   */
  const sendSets: Array<string> | null =
    houdiniMode === 'skip'
      ? (sendPlan?.sets ?? null)
      : runSets === null
        ? null
        : [...runSets].sort()

  /** Does this project already hold something this run is sending it? The
   *  pre-tick and the row's own subtitle ask exactly that — "has this
   *  character" is not "has what this run makes". */
  function holdsSendSet(uproject: string): boolean {
    const located = sendPlan?.located[uproject] ?? {}
    if (sendSets === null) return Object.keys(located).length > 0
    return sendSets.some((name) => located[name] !== undefined)
  }

  /**
   * The studio knows what this run puts in play, and it is NOTHING — an empty
   * export folder under `Skip Houdini`, or checked Houdini projects whose scan
   * found no export node at all. Nothing to send, so nothing to tick.
   *
   * Distinct from `sendSets === null` ("cannot say"), and the distinction has
   * teeth: an empty list would otherwise travel as `[]`, which the send reads
   * as "every set in the export folder" — the studio would hand over a stale
   * export while believing this run writes none.
   */
  const nothingToSend = sendSets !== null && sendSets.length === 0

  /** Why this section can't do anything — '' when it can, which is when it says
   *  nothing at all. */
  const unrealNote = !unrealSendable
    ? mode === 'rom-only'
      ? // Naming the Houdini pick here would be advice the user cannot take:
        //  rom-only cleared that list and runs no Houdini at all.
        'ROM only writes no export — nothing to send. Run “ROM + Export”, or send the last export with “Skip Daz”.'
      : 'Needs somewhere to send from: tick a Houdini project, or pick “Skip Houdini”.'
    : nothingToSend
      ? houdiniMode === 'skip'
        ? // "Use last exports" with no last export: the mode hands over what is
          //  on disk, and the export folder is empty.
          'Nothing in the export folder yet — there is no last export to send. Run the Houdini export instead.'
        : 'These Houdini projects write no export set, so this run produces nothing to send.'
      : ''

  /**
   * The Unreal selection FOLLOWS the Houdini one, the same way the Houdini list
   * follows the Daz scenes: untick the projects that would export and the send
   * has nothing to hand over, so it leaves the run with them — and comes back
   * when they do. Also the reason the probe above only sets `unrealHas`: it
   * lands after this has run at least once, and a selection seeded there would
   * survive a run that can no longer send.
   *
   * A hand-picked selection is reset by that round trip, exactly as a
   * hand-picked Houdini project is when its scene goes and returns. The default
   * IS the answer to "which projects is this export for".
   */
  useEffect(() => {
    if (!unrealSendable || sendPlan === null) {
      setCheckedUnreal(EMPTY_SELECTION)
      return
    }
    setCheckedUnreal(
      sendSets === null && houdiniMode !== 'skip'
        ? EMPTY_SELECTION
        : new Set(unrealProjects.filter(holdsSendSet)),
    )
    // `unrealProjects` is the prop array, stable per render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `sendSets`/`holdsSendSet` are derived from the state this effect already
    // depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unrealSendable, sendPlan, houdiniMode, checkedHips, hipImports])

  useEffect(() => {
    let active = true
    fetchExecuteScenes({ data: { projectId, id: character.id } })
      .then((scenes) => {
        if (!active) return
        setStatus(scenes)
        // Seed the checks for whichever mode is current when the probe lands.
        const pre = preCheckedScenes(modeRef.current, scenes)
        setChecked(pre)
        // Scenes with outstanding work → their Houdini projects join the run
        // too, so a plain Start does the WHOLE round trip. WHICH projects is
        // settled by the effect below (it also re-runs on every later change
        // of the scene selection); this only seeds the untouched case with
        // every linked project, which the effect then narrows the moment the
        // stored scans say what each one imports. Never under rom-only: that
        // run writes no fresh export, so a Houdini continuation could only
        // re-consume the PREVIOUS one while the report reads as the new ROM's
        // round trip (`executeCharacterJobs` refuses that combination outright).
        if (pre.size > 0 && modeRef.current !== 'rom-only' && character.houdiniProjects.length > 0) {
          setCheckedHips((prev) =>
            prev.size > 0
              ? prev
              : new Set(character.houdiniProjects.filter((hip) => !hipMissingRef.current.has(hip))),
          )
        }
      })
      .catch((error: unknown) => {
        if (!active) return
        // Detection failing must not block a manual choice — the rows settle
        // unchecked (no scene reads as "changed") and the export stays possible.
        setStatus(
          [character.scenePath, ...character.extraScenes]
            .filter(Boolean)
            .map((scenePath, index) => ({
              scenePath,
              primary: index === 0,
              affected: false,
              missing: false,
              // Unknown, not "absent": leaving rows selectable keeps a manual
              // export-only (or Houdini-only) pick possible when the probe
              // failed — the pre-handoff re-probe still gates the real run.
              romExists: true,
              romUnexported: false,
              exportExists: true,
            })),
        )
        toast.error(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
    // Mount-only ON PURPOSE: re-running on a draft-identity change (the
    // focus-driven avatar sync patches the draft when tabbing back from Daz)
    // would refetch and wipe the user's checkbox choices mid-pick. THAT is the
    // whole reason — the drawer being "modal" is not, and used to be claimed
    // here: a SidePanel deliberately leaves the page behind it hit-testable
    // (see its own doc comment, and `.ai/gotchas.md`), so a file dropped on the
    // dimmed editor CAN link a scene while this list sits open. The list then
    // lags by one scene until the panel is reopened, which is the accepted
    // trade — a refetch that discards a half-made selection is worse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, character.id])

  // The scene selection DECIDES which Houdini projects belong in the run: a
  // project joins when one of its networks imports a selected scene's `.dth`
  // — the key 456.py matches on at export time — so ticking a scene off takes
  // its project with it. Runs on every change of the scene selection (whatever
  // changed it: a toggle, Solo, All, a mode re-seed), and again when the stored
  // scans land. A project is only DROPPED on a positive match against a
  // deselected scene, which is why the unticked scenes' `.dth` paths are handed
  // over too (see `hipsForSelectedScenes` — nothing is ever dropped on
  // ignorance). Missing `.hip`s stay out. Not under rom-only — that list is a
  // manual OPEN pick.
  useEffect(() => {
    if (mode === 'rom-only' || hipImports.length === 0) return
    const dthFor = (scene: string): string => sceneDth[normalizeSceneKey(scene)] ?? ''
    const scenesDth = [...checked].map(dthFor).filter((dth) => dth !== '')
    // The other side of the same coin: every LINKED scene that is not ticked.
    // Read off the scene list rather than "everything in sceneDth minus the
    // selection", so a scene the resolver could not place is simply absent from
    // both sets — unknown, not deselected.
    const deselectedDth = [character.scenePath, ...character.extraScenes]
      .filter((scene) => scene && !checked.has(scene))
      .map(dthFor)
      .filter((dth) => dth !== '')
    // EVERY linked project is judged — a project the scan never reached is
    // absent from the store, and leaving it out of the list here would drop it
    // by omission, which is the very guess the rule refuses to make.
    const byPath = new Map(hipImports.map((entry) => [entry.hipPath, entry.imports]))
    const judged = character.houdiniProjects.map((hipPath) => ({
      hipPath,
      imports: byPath.get(hipPath) ?? [],
    }))
    setCheckedHips((prev) => {
      const next = hipsForSelectedScenes(judged, scenesDth, prev, deselectedDth)
      for (const hip of hipMissing) next.delete(hip)
      // Same members → same object, so the Houdini list doesn't re-render on
      // every unrelated poll (and the Unreal effects, which key on this set,
      // don't re-seed a selection the user has since made their own).
      if (next.size === prev.size && [...next].every((hip) => prev.has(hip))) return prev
      return next
    })
  }, [checked, hipImports, hipMissing, mode, character, sceneDth])

  function toggle(scene: string) {
    setScenesTouched(true)
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(scene)) next.delete(scene)
      else next.add(scene)
      return next
    })
  }

  /** Step 1 → step 2: the pick decides which scenes start checked (each mode
   *  has its own "outstanding work" rule), so re-picking re-seeds them. */
  /** The Daz Mode dropdown: each mode has its own "outstanding work" rule, so
   *  changing it re-seeds which scenes start checked. */
  function pickMode(next: RunChoice) {
    modeRef.current = next
    setMode(next)
    // Only seed a list the user has not made their own — see `scenesTouched`.
    if (status && !scenesTouched) setChecked(preCheckedScenes(next, status))
    // ROM only writes no fresh export, so a Houdini continuation has nothing
    // of THIS run's to consume — whatever the list had armed (auto-selection
    // included) doesn't carry over, and the one thing it can still do is OPEN
    // a project the user re-picks deliberately.
    if (next === 'rom-only') {
      setCheckedHips(new Set())
      setHoudiniMode('skip')
    }
  }

  /** The Houdini list's toggle — a plain multi-select now that both
   *  single-project modes are gone: every remaining mode runs any number of
   *  projects, so there is no combination to steer the user out of. */
  function toggleHip(hip: string) {
    const next = new Set(checkedHips)
    if (next.has(hip)) next.delete(hip)
    else next.add(hip)
    setCheckedHips(next)
  }

  async function onExport() {
    setBusy(true)
    try {
      const chosenScenes = rows.filter((r) => checked.has(r.scenePath)).map((r) => r.scenePath)
      const chosenHips = character.houdiniProjects.filter((hip) => checkedHips.has(hip))
      // Only when this run actually exports — see `unrealSendable`.
      const chosenUnreal = unrealSendable
        ? unrealProjects.filter((path) => checkedUnreal.has(path))
        : []
      // WHICH sets go: the ones this run puts in play. `[]` travels as "every
      // set in the export folder" — the send's own default, and the honest
      // answer when the studio cannot name them (see {@link sendSets}). The
      // ticked projects alone decide whether anything is sent at all.
      const chosenSets = sendSets ?? []
      // …and never on a run the studio knows produces nothing: `[]` would then
      // travel as "send the whole export folder" (see {@link nothingToSend}).
      // The rows are inert in that state; this is the backstop for a selection
      // made before the mode changed under it.
      const unrealTargets = nothingToSend ? [] : chosenUnreal
      // The probe behind the pre-selection, handed up so the run's Unreal rows
      // can say "Re-import" — or drop a set the project never held — per
      // project ({@link UnrealSendPlan}). undefined when the probe never
      // landed (still in flight, or failed — the rows stay tickable then):
      // coercing to `{}` here would read as "probed and found NOTHING", which
      // under re-import-only dropped every Unreal row from the run display.
      // Nobody looked, so the rows claim a plain "Import" and the send
      // decides — it re-probes for real.
      const located = sendPlan?.located
      // Skip Daz: the Houdini selection IS the run — the same machinery the
      // after-batch continuation drives, minus the batch.
      if (mode === 'houdini-only') {
        // Nothing to run in Daz OR Houdini: this IS the "just re-import in
        // Unreal" case, and it is one file write away.
        if (houdiniMode === 'skip') {
          onUnrealOnly(unrealTargets, chosenSets, located)
          onClose()
          return
        }
        // Belt and braces, the export-only re-probe's sibling: the panel's
        // status is a snapshot, and an export folder can be cleared while it
        // sits open — a vanished `.dth` must land back in the panel, not in
        // a Houdini session with nothing to import. ("Export all" scopes by
        // every linked scene instead, and the Houdini side skips gracefully.)
        if (houdiniMode === 'export-selected') {
          const fresh = await fetchExecuteScenes({ data: { projectId, id: character.id } })
          const missing = scenesMissingExport('houdini-only', fresh, checked)
          if (missing.length > 0) {
            setStatus(fresh)
            const names = missing.map((s) =>
              (s.scenePath.split(/[\\/]/).pop() ?? s.scenePath).replace(/\.[^./\\]+$/, ''),
            )
            toast.error(
              `No Daz export on disk for ${names.join(', ')} — run ROM + Export first, or unselect ${missing.length === 1 ? 'it' : 'them'}.`,
            )
            return
          }
        }
        onHoudiniQueue(chosenHips, chosenScenes, unrealTargets, chosenSets, located)
        onClose()
        return
      }
      // Belt and braces for "Export only": the panel's scene status is a
      // snapshot from when it opened, and the selection can outlive it — a ROM
      // animation deleted since then (in Daz, by hand) would ride the stale
      // go-ahead into the handoff. Re-probe at the decision point; a refusal
      // lands the fresh status in the panel (the gate's notice + disabled
      // Start + the rows' real state) instead of a failure after the fact.
      if (mode === 'export-only') {
        const fresh = await fetchExecuteScenes({ data: { projectId, id: character.id } })
        const missing = scenesMissingRomAnimation('export-only', fresh, checked)
        if (missing.length > 0) {
          setStatus(fresh)
          const names = missing.map((s) =>
            (s.scenePath.split(/[\\/]/).pop() ?? s.scenePath).replace(/\.[^./\\]+$/, ''),
          )
          toast.error(
            `No saved ROM animation for ${names.join(', ')} — run a ROM build first, or unselect ${missing.length === 1 ? 'it' : 'them'}.`,
          )
          return
        }
      }
      const result = await executeCharacterJobs({
        // Preserve row order — the jobs run top to bottom.
        data: {
          projectId,
          id: character.id,
          scenes: chosenScenes,
          mode,
          // Skipping means no Houdini leg: the record must not name one, or
          // a reloaded window would restore a continuation nobody asked for.
          houdiniProjects: houdiniMode === 'skip' ? [] : chosenHips,
          houdiniMode,
          unrealProjects: unrealTargets,
          unrealSets: chosenSets,
        },
      })
      onExported({
        scenes: chosenScenes,
        houdiniProjects: mode === 'rom-only' || houdiniMode === 'skip' ? [] : chosenHips,
        // The scene scope the Houdini leg will export (→ the networks its
        // task cards name) — the continuation recomputes the same set.
        houdiniScenes: chosenScenes,
        unrealProjects: unrealTargets,
        unrealSets: chosenSets,
        unrealLocated: located,
        mode,
        // Whether the handoff STARTED Daz — the status line's opening word
        // says "opening Daz Studio" only when that is what is happening.
        dazLaunched: result.dazLaunched,
        // A Daz that was already up owes us a claim; the run watch waits for it
        // (see the action's onExported). The panel does NOT — waiting here is
        // what made Start sit on "Starting…" for ten seconds before closing.
        dazWasRunning: result.dazWasRunning,
      })
      onClose()
      const count = `${result.scenes.length} scene${result.scenes.length === 1 ? '' : 's'}`
      const what = mode === 'rom-only' ? 'queued for a ROM build' : 'queued for export'
      toast.success(
        result.dazWasRunning
          ? // The plugin polls for the job file, so a running Daz picks it up.
            `Jobs handed to the running Daz Studio — ${count} ${what}.`
          : `Started Daz Studio — ${count} ${what}.`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SidePanel
      // Always `open`: the caller mounts this component only while the drawer
      // is up (the scene probe, the Runner gate and the send plan all fire on
      // mount and must not run just because the header rendered), so it slides
      // in on mount and closing unmounts it — the same shape as the Houdini
      // utils drawer.
      open
      // While the handoff is being written, Escape / the backdrop / the ✕ are
      // all refused, and the panel goes away when `onExport` says so. The prop
      // (not a no-op `onClose`) because it also greys the ✕ out — the handoff
      // waits ~10s for the Runner to claim the job file, which is a long time
      // to offer a button that does nothing.
      dismissible={!busy}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          {/* Same shape as the Houdini utils drawer's title: the mark first,
              so the drawer says WHOSE pipeline it drives before it says what. */}
          <img src={dthLogo} alt="" aria-hidden className="size-5 shrink-0 object-contain" />
          <span className="flex items-center gap-1.5">
            DTH Export
            <InfoPopup label="DTH Export — more information">
              Pick the Daz scenes and what their run does, then the Houdini projects that carry
              on with the results. Scenes with outstanding work come pre-selected — and so do
              the Houdini projects when they have. The wand picks a single scene, a
              double-click selects all.
            </InfoPopup>
          </span>
        </span>
      }
      // The run's one action, pinned to the drawer's bottom edge instead of
      // riding the end of the scroll: the three leg lists can outgrow a
      // full-height panel, and Start scrolling out of reach is exactly what
      // the old 85vh modal never had to worry about.
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              checking ||
              (mode === 'houdini-only' && houdiniMode === 'skip'
                ? // Neither app runs: the whole run is the send, so the Unreal
                  // pick is the only thing that can gate it.
                  checkedUnreal.size === 0
                : // No scenes = nothing to start from, whatever the modes say.
                  checked.size === 0 ||
                  (mode === 'houdini-only'
                    ? checkedHips.size === 0 || noExportChecked.length > 0
                    : !runner || runner.blocked || noRomChecked.length > 0))
            }
            title={
              mode !== 'houdini-only' && runner?.blocked
                ? 'The Runner plugin needs attention in Settings first'
                : checking
                  ? mode === 'houdini-only'
                    ? 'Checking each scene for a Daz export on disk — a moment'
                    : 'Checking each scene for a saved ROM animation — a moment'
                  : mode === 'houdini-only' && houdiniMode === 'skip'
                    ? // The send-only run's single requirement — the Daz-scene
                      // wording below would name a selection it never reads.
                      checkedUnreal.size === 0
                      ? 'Select the Unreal project to send to'
                      : undefined
                    : checked.size === 0
                      ? 'Select at least one Daz scene'
                      : mode === 'houdini-only'
                        ? checkedHips.size === 0
                          ? 'Select at least one Houdini project'
                          : noExportChecked.length > 0
                            ? 'Every selected scene needs a Daz export on disk to skip Daz — see above'
                            : undefined
                        : noRomChecked.length > 0
                          ? 'Every selected scene needs a saved ROM animation for an export-only run — see above'
                          : undefined
            }
            onClick={() => void onExport()}
          >
            {checking ? <Loader2 className="animate-spin" /> : <Play />}{' '}
            {busy ? 'Starting…' : checking ? 'Checking scenes…' : 'Start'}
          </Button>
        </div>
      }
    >
      {/* The drawer body has no rhythm of its own (the Modal card supplied
          `space-y-4`) — the run's three legs stack on this one. */}
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {mode === 'houdini-only'
            ? 'Skips Daz entirely — the selected Houdini projects run their DazToHue exports off each scene’s last Daz export.'
            : mode === 'export-only'
              ? 'Exports each selected scene’s saved ROM animation as it stands — no rebuild, so this is the quick one.'
              : 'Heads up: this takes a long time — Daz Studio plays through the full ROM for every selected scene.'}
        </p>
        <div>
          <Label className="mb-1.5">Daz scenes</Label>
          <div className="space-y-2">
            {rows.map((row) => (
              <SceneRow
                key={normalizeSceneKey(row.scenePath)}
                status={row}
                mode={mode}
                checked={checked.has(row.scenePath)}
                loading={status === null}
                onToggle={() => toggle(row.scenePath)}
                onSolo={() => {
                  setScenesTouched(true)
                  setChecked(new Set([row.scenePath]))
                }}
                onSelectAll={() => {
                  setScenesTouched(true)
                  setChecked(
                    new Set(
                      rows
                        .filter((r) =>
                          mode === 'houdini-only'
                            ? r.exportExists
                            : !r.missing && (mode !== 'export-only' || r.romExists),
                        )
                        .map((r) => r.scenePath),
                    ),
                  )
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Label className="shrink-0" htmlFor="daz-mode">
              Mode
            </Label>
            <Select value={mode} onValueChange={(value) => pickMode(value as RunChoice)}>
              <SelectTrigger id="daz-mode" className="w-80">
                {/* Explicit children: SelectValue would otherwise mirror the whole
                    two-line item (title + blurb) into the closed trigger. */}
                <SelectValue>{DAZ_MODE_OPTIONS.find((o) => o.mode === mode)?.title}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DAZ_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.mode} value={option.mode}>
                    <span className="block">
                      {option.title}
                      <span className="block text-xs text-muted-foreground">{option.blurb}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {character.houdiniProjects.length > 0 && (
          <div>
            <Label className="mb-1.5">Houdini projects</Label>
            <div className="space-y-2">
              {character.houdiniProjects.map((hip) => (
                <HipRow
                  key={hip}
                  hip={hip}
                  checked={checkedHips.has(hip)}
                  missing={hipMissing.has(hip)}
                  onToggle={() => toggleHip(hip)}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Label className="shrink-0" htmlFor="houdini-mode">
                Mode
              </Label>
              <Select
                value={houdiniMode}
                onValueChange={(value) => setHoudiniMode(value as HoudiniRunMode)}
                // Inert without a selected project — and without a checked Daz
                // scene, when the whole run has nothing to start from. NOT when
                // the project has a linked Unreal project: `skip` is precisely
                // the choice for a run with no Houdini in it, so requiring a
                // ticked Houdini project to reach it locks the user out of the
                // one mode that says "don't run Houdini".
                disabled={
                  unrealProjects.length === 0 && (checkedHips.size === 0 || checked.size === 0)
                }
              >
                <SelectTrigger id="houdini-mode" className="w-80">
                  {/* Title only — see the Daz trigger above. */}
                  <SelectValue>
                    {HOUDINI_MODE_OPTIONS.find((o) => o.mode === houdiniMode)?.title}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HOUDINI_MODE_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.mode}
                      value={option.mode}
                      // The EXPORT mode is dead under ROM only: that run writes
                      // no fresh export, so it could only re-consume the previous
                      // one while reading as this run's output.
                      // `skip` needs somewhere to send to; the export mode needs
                      // a run that produces an export.
                      disabled={
                        option.mode === 'skip'
                          ? unrealProjects.length === 0
                          : mode === 'rom-only'
                      }
                    >
                      <span className="block">
                        {option.title}
                        <span className="block text-xs text-muted-foreground">{option.blurb}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        {/* The third leg. Only when the run can actually produce an export —
            a send needs something exported, and the Houdini list is what
            produces it. */}
        {unrealProjects.length > 0 && character.houdiniProjects.length > 0 && (
          <div>
            <Label className="mb-1.5">Unreal projects</Label>
            <div className="space-y-2">
              {unrealProjects.map((uproject) => {
                const has = sendPlan === null ? null : holdsSendSet(uproject)
                return (
                  <UnrealRow
                    key={uproject}
                    uproject={uproject}
                    checked={checkedUnreal.has(uproject)}
                    has={has}
                    // `has === false` is a landed probe saying there is nothing
                    // of this run's in there — and the send is RE-import only,
                    // so the row can do nothing. A null probe stays tickable:
                    // ignorance must not refuse (the send re-probes for real).
                    disabled={!unrealSendable || nothingToSend || has === false}
                    onToggle={() =>
                      setCheckedUnreal((current) => {
                        const next = new Set(current)
                        if (next.has(uproject)) next.delete(uproject)
                        else next.add(uproject)
                        return next
                      })
                    }
                  />
                )
              })}
            </div>
            {/* Nothing under the rows. WHICH export sets go is the studio's own
                answer (see `sendSets`) and WHERE each lands is the project's —
                both worked out from disk, neither a question for the user, and
                the run's task cards name every set with the project it goes into
                once it starts. The tick list that used to sit here could only
                re-pick what a PREVIOUS run had written; a read-only version of
                the same list is the same clutter without the lie. */}
            {unrealSendable && sendSets === null && houdiniMode !== 'skip' && (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-500">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  The studio doesn&apos;t know yet which export sets these Houdini projects write,
                  so nothing is pre-selected and <strong>everything</strong> in the export folder
                  that a ticked project already holds would be re-imported. <strong>Rescan</strong>{' '}
                  them (Utils drawer) and it will send only what this run makes.
                </span>
              </p>
            )}
            {/* Only ever a REASON the send can't happen. The line that used to sit
                here in the normal case ("Queued for import when the whole export
                finishes…") described the feature to somebody who had just ticked
                a box to use it — permanent text, read once. */}
            {unrealNote !== '' && (
              <p className="mt-1.5 text-xs text-muted-foreground">{unrealNote}</p>
            )}
          </div>
        )}
        {/* The Runner gate is the DAZ plugin's — a skip-Daz run never goes
            through it, so it must not block one. */}
        {mode !== 'houdini-only' && runner?.blocked && <RunnerGateNotice gate={runner} />}
        {noRomChecked.length > 0 && (
          <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
            <p>
              <strong>Export only</strong> exports the saved ROM animation of each scene, and{' '}
              {noRomChecked.length === 1 ? 'one selected scene has none' : `${noRomChecked.length} selected scenes have none`}{' '}
              yet:
            </p>
            <ul className="list-inside list-disc text-muted-foreground">
              {noRomChecked.map((row) => (
                <li key={normalizeSceneKey(row.scenePath)}>
                  {(row.scenePath.split(/[\\/]/).pop() ?? row.scenePath).replace(/\.[^./\\]+$/, '')}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Run <strong>ROM + Export</strong> or <strong>ROM only</strong> for{' '}
              {noRomChecked.length === 1 ? 'it' : 'them'} first, or unselect{' '}
              {noRomChecked.length === 1 ? 'it' : 'them'}.
            </p>
          </div>
        )}
        {noExportChecked.length > 0 && (
          <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
            <p>
              <strong>Skip Daz</strong> relies on each scene&apos;s last Daz export, and{' '}
              {noExportChecked.length === 1 ? 'one selected scene has none' : `${noExportChecked.length} selected scenes have none`}{' '}
              on disk:
            </p>
            <ul className="list-inside list-disc text-muted-foreground">
              {noExportChecked.map((row) => (
                <li key={normalizeSceneKey(row.scenePath)}>
                  {(row.scenePath.split(/[\\/]/).pop() ?? row.scenePath).replace(/\.[^./\\]+$/, '')}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Run <strong>ROM + Export</strong> for {noExportChecked.length === 1 ? 'it' : 'them'}{' '}
              first, or unselect {noExportChecked.length === 1 ? 'it' : 'them'}.
            </p>
          </div>
        )}
      </div>
    </SidePanel>
  )
}
