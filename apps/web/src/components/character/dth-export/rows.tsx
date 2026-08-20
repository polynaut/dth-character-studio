/**
 * The export panel's list rows — one Daz scene, one Houdini project, one Unreal
 * project — plus the run-mode option tables they pick from and the modal that
 * waits for Daz to close.
 *
 * Split out of `dth-export.tsx`; nothing here changed in the move.
 */
import { useEffect, useState } from 'react'
import { Loader2, Wand } from 'lucide-react'

import { Button, Modal } from '@dth/ui'
import houdiniLogo from '#/assets/houdini-logo.svg'
import unrealLogo from '#/assets/unreal-logo.svg'
import { Portrait } from '#/components/portrait.tsx'
import { PrimaryBadge } from '#/components/primary-badge.tsx'
import { launchDazForPendingJobs, pendingExportHandoffState } from '#/lib/rom/api.ts'
import { EXPORT_MODE_LABELS } from '#/lib/rom/execute-jobs.ts'
import type { ExecuteSceneStatus } from '#/lib/rom/api.ts'
import type { HoudiniRunMode, RunChoice } from '#/lib/rom/execute-jobs.ts'

/** One decision per second: the modal's whole loop is `pendingExportHandoffState`
 *  (see `classifyPendingHandoff` for the rule) plus what to do about it. */
const TICK_MS = 1000
/** Ticks to leave a launch alone before launching again. A launched Daz needs a
 *  moment to show up in the process probe, and one that forwarded into a
 *  not-quite-dead single instance needs one to die — relaunching on the very
 *  next tick would only stack processes on top of both. */
const RELAUNCH_AFTER_TICKS = 5
/** Launches to spend before saying so instead. Covers a lingering single
 *  instance several times over (~20 s at `RELAUNCH_AFTER_TICKS`) and stops well
 *  short of a once-a-second spawn loop against a Daz that cannot start at all —
 *  `launchDazForPendingJobs` reports the SPAWN, never that the process lived. */
const MAX_LAUNCH_ATTEMPTS = 5
/** Consecutive unreadable claimed-file reads before the modal gives up on it.
 *  The Runner rewrites the file per row, so a torn read is routine — one that
 *  is still torn ten seconds later is corrupt or foreign, and nothing here can
 *  act on it (an unparsed batch is never reclaimable). The export watch owns
 *  the dead run from there. */
const UNREADABLE_LIMIT = 10
/** Consecutive failing ticks before the modal admits it in words. Below this a
 *  blip is just a tick that gets retried. */
const PROBLEM_AFTER_FAILURES = 3

export function WaitForDazCloseModal({
  onDone,
  onCancel,
}: {
  /** The wait resolved: `started` = this modal started a Daz (or one reappeared)
   *  for the pending batch AND the batch is now being worked; false = nothing
   *  left to start — the handoff disappeared (aborted or already finished) or a
   *  live Daz claimed it and is working it (the export watch's run now). */
  onDone: (started: boolean) => void
  onCancel: () => void
}) {
  // 'waiting' = the closing Daz's process is still up (or a claimed batch is in
  // its ambiguous untouched state); 'starting' = this modal launched a Daz and
  // is holding on until the batch is actually claimed and worked; 'stalled' =
  // it launched all it is willing to and the batch is still unclaimed.
  const [phase, setPhase] = useState<'waiting' | 'starting' | 'stalled'>('waiting')
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let settled = false
    let busy = false
    let launched = false
    let launches = 0
    let ticksSinceLaunch = 0
    let unreadable = 0
    let failures = 0
    const finish = (started: boolean) => {
      settled = true
      onDone(started)
    }
    // `pendingExportHandoffState` reads the handoff's real state and classifies
    // it. Its predecessor here had two failure modes this loop must never
    // regrow: it settled BEFORE awaiting the launch, so one rejected launch
    // hung the modal forever with Daz never started; and it had no terminal
    // state, so a batch that finished (file deleted at 100) left the modal
    // spinning under the finish toast. So: every tick is caught (a failure
    // means "try again next second", said out loud after a few), a launch
    // counts only once the claim actually happens — a launch against a
    // not-fully-dead single instance forwards into it and dies, so 'launch'
    // coming back around simply launches again, up to MAX_LAUNCH_ATTEMPTS —
    // and 'gone'/'working' always close the modal. Every other outcome is
    // bounded too: this modal must always resolve or say why it can't.
    const tick = async () => {
      if (busy || settled) return
      busy = true
      ticksSinceLaunch += 1
      let stage: 'read' | 'launch' = 'read'
      let ok = true
      try {
        const state = await pendingExportHandoffState()
        if (!active || settled) return
        if (state !== 'unreadable') unreadable = 0
        if (state === 'gone') {
          // Aborted, or claimed and already finished — nothing left to start.
          finish(false)
          return
        }
        if (state === 'working') {
          // The batch is being worked; it belongs to the export watch now.
          finish(launched)
          return
        }
        if (state === 'unreadable') {
          unreadable += 1
          // Not a torn write any more: the file cannot be parsed, so it can
          // neither be reclaimed nor waited out. Stand down and leave the dead
          // run to the export watch, which reports it.
          if (unreadable >= UNREADABLE_LIMIT) finish(false)
          return
        }
        if (state === 'launch') {
          if (launches >= MAX_LAUNCH_ATTEMPTS) {
            setPhase('stalled')
            return
          }
          // Give the previous launch its ticks before spending another one.
          if (launches > 0 && ticksSinceLaunch < RELAUNCH_AFTER_TICKS) return
          stage = 'launch'
          const started = await launchDazForPendingJobs()
          if (!active || settled) return
          if (!started) {
            // The handoff vanished between the read and the launch.
            finish(false)
            return
          }
          launched = true
          launches += 1
          ticksSinceLaunch = 0
          setPhase('starting')
        }
        // 'waiting': nothing to do this tick.
      } catch (error) {
        ok = false
        failures += 1
        const detail = error instanceof Error ? error.message : String(error)
        if (failures >= PROBLEM_AFTER_FAILURES && active && !settled) {
          // Which call failed is the whole of what the user can act on — a
          // launch Daz refuses is a different problem from a job file that
          // cannot be read, and claiming the first for the second is a lie.
          setProblem(
            stage === 'launch'
              ? `Starting Daz Studio failed — still retrying: ${detail}`
              : `Checking on the export failed — still retrying: ${detail}`,
          )
        }
      } finally {
        // A tick that got through is the only thing that clears a reported
        // problem: counting failures CONSECUTIVELY is what keeps three
        // unrelated blips minutes apart from reading as a broken launch.
        if (ok && active && !settled) {
          failures = 0
          setProblem(null)
        }
        busy = false
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), TICK_MS)
    return () => {
      active = false
      window.clearInterval(id)
    }
    // Mount-only: the callbacks are stable enough for this modal's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Modal
      open
      onClose={onCancel}
      title={
        phase === 'stalled'
          ? 'Daz Studio isn’t picking the export up'
          : phase === 'starting'
            ? 'Starting Daz Studio…'
            : 'Waiting for Daz Studio to close…'
      }
      dismissible
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        {phase !== 'stalled' && <Loader2 className="size-4 shrink-0 animate-spin" />}
        <span>
          {phase === 'stalled'
            ? 'Daz Studio was started several times and keeps exiting before it picks the export up. Starting it by hand should run the batch — its Runner claims the queued export on launch. Closing this keeps the batch queued (the header button aborts it).'
            : phase === 'starting'
              ? 'Daz Studio is starting and picks the export up on launch — this closes as soon as the batch begins.'
              : 'Daz Studio didn’t pick the export up — it’s probably still closing. As soon as the process is gone, Daz Studio starts again by itself and runs the export. Closing this keeps the batch queued (the header button aborts it).'}
        </span>
      </p>
      {problem && <p className="mt-2 text-sm text-destructive">{problem}</p>}
    </Modal>
  )
}

/**
 * The export sets a project row carries, as chips on their own line.
 *
 * One chip = one **DazToHue network**: the HDA's `character_name`, which is the
 * export set the network writes and therefore the folder that reaches Unreal.
 *
 * What a list MEANS differs per leg, and only one of them is a statement about
 * the run:
 *
 * - **Houdini** — what that PROJECT writes, ticked or not and whatever mode the
 *   run is in. It describes the `.hip`, NOT the queue, and the three ways it
 *   parts company with the task rows are all normal: `houdiniTaskCards` names
 *   its rows from these only from TWO networks up (below that a project is one
 *   row carrying the project's own name), `skip` runs no Houdini leg at all,
 *   and an unticked project contributes nothing. What the chips buy is the
 *   count — how much work a `.hip` is — before Start.
 * - **Unreal** — what THIS RUN would send into that project, already narrowed
 *   by the panel to the sets the probe located there. That one IS the leg's
 *   rows: `unrealTaskCards` is one row per set per project and drops exactly
 *   the sets this list does.
 *
 * Empty renders NOTHING rather than "no networks": an unscanned project reports
 * an empty list, and empty means *not known* everywhere it is read (see the
 * scan schema's own note on `exportSets`). A row that stated "0 networks" would
 * turn that ignorance into a claim.
 */
function SetChips({
  caption,
  names,
  tone,
}: {
  /** What the names ARE on this leg, since the chips sit under a cover button
   *  that swallows their `title` — the word has to be on screen. */
  caption: string
  names: ReadonlyArray<string>
  tone: 'houdini' | 'unreal'
}) {
  if (names.length === 0) return null
  return (
    // `data-sets`/`data-set` are the smoke's hook on the run's shape before it
    // starts — the same role `data-task` plays on the pipeline list once it has.
    <div data-sets={tone} className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[11px] leading-4 text-muted-foreground">{caption}</span>
      {names.map((name) => (
        <span
          key={name}
          data-set={name}
          className={`max-w-full truncate rounded border px-1.5 py-px text-[11px] leading-4 ${
            tone === 'houdini'
              ? 'border-houdini-orange/40 bg-houdini-orange/10 text-houdini-orange'
              : 'border-unreal-blue/40 bg-unreal-blue/10 text-unreal-blue'
          }`}
        >
          {name}
        </span>
      ))}
    </div>
  )
}

/** One selectable scene row — a simplified Daz scene card: checkbox, `.tip.png`
 *  portrait, name, status hint, and the solo wand. Clicking the row toggles its
 *  checkbox, double-clicking selects EVERY row (the wand's counterpart); the
 *  daz-card utility supplies the tint/ring via `data-selected`. */
export function SceneRow({
  status,
  offsetY,
  mode,
  checked,
  loading,
  onToggle,
  onSolo,
  onSelectAll,
}: {
  status: ExecuteSceneStatus
  /** The character's `imageOffsetY` — its framing nudge on the row's preview
   *  (see lib/avatar-offset). */
  offsetY?: number
  /** The chosen run — decides what the row's hint reports and whether it can
   *  run at all (Export only needs a saved ROM animation; Houdini only needs
   *  the scene's last Daz export on disk). */
  mode: RunChoice
  checked: boolean
  /** Affected-detection still running — checkboxes are settling, keep quiet. */
  loading: boolean
  onToggle: () => void
  onSolo: () => void
  onSelectAll: () => void
}) {
  const fileName = status.scenePath.split(/[\\/]/).pop() ?? status.scenePath
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  // Export only runs off the SAVED ROM animation, so a scene without one has
  // nothing to export — disabled, like a missing scene file.
  const noRom = mode === 'export-only' && !loading && !status.romExists
  // Houdini only runs off the DELIVERED export — a scene without one on disk
  // has nothing to rely on. The `.duf` is deliberately NOT consulted here:
  // Houdini reads the export, not the scene, so even a missing scene file
  // stays runnable in this mode.
  const noExport = mode === 'houdini-only' && !loading && !status.exportExists
  const disabled = mode === 'houdini-only' ? noExport : status.missing || noRom
  // Each mode reports the state that decides ITS pre-selection ("Houdini only"
  // and "Hair items only" have no staleness signal, so nothing highlights
  // green there).
  const highlight =
    mode === 'houdini-only' || mode === 'hair-only'
      ? false
      : mode === 'export-only'
        ? status.romUnexported
        : status.affected
  const hint =
    mode === 'houdini-only'
      ? loading
        ? 'Checking for exports…'
        : noExport
          ? 'No Daz export on disk yet — run ROM + Export for this scene first'
          : 'Uses this scene’s last Daz export as it stands'
      : status.missing
        ? 'Scene file missing — relink it in the editor'
        : mode === 'hair-only'
          ? // No staleness to report and no ROM needed — the row can only say
            // what the run does to it.
            'Exports each hair item of this scene on its own'
          : loading
            ? 'Checking for changes…'
            : noRom
              ? 'No ROM animation yet — run a ROM build for this scene first'
              : mode === 'export-only'
                ? status.romUnexported
                  ? 'ROM animation changed since its last export'
                  : 'ROM animation already exported as it stands'
                : status.affected
                  ? 'Changed since the last export'
                  : 'Unchanged since the last export'
  return (
    <div className="group/card relative w-full">
      <div
        className={`daz-card relative flex items-center gap-3 rounded-lg border p-3 pl-4${disabled ? ' opacity-50' : ''}`}
        data-selected={checked ? 'true' : undefined}
      >
        {/* z-10 lifts the real controls above the row's cover button.
            Disabled only when NOT already checked: a refused row must not be
            checkable, but one that is ALREADY checked (the status can go stale
            under the selection — the pre-handoff re-check surfaces it) must
            still be possible to UNCHECK, or the gate's "unselect it" advice
            would be advice nobody can follow. */}
        <input
          type="checkbox"
          className="relative z-10 size-4 shrink-0 accent-daz-green"
          aria-label={`Export ${displayName}`}
          checked={checked}
          disabled={disabled && !checked}
          onChange={onToggle}
        />
        <Portrait
          scenePath={status.scenePath}
          name={displayName}
          offsetY={offsetY}
          className="aspect-[3/4] h-[56px] shrink-0 rounded-md"
          fallbackClassName="text-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-medium">{displayName}</span>
            {status.primary && <PrimaryBadge dense />}
          </div>
          <p
            className={`mt-0.5 text-xs ${
              status.missing && mode !== 'houdini-only'
                ? 'text-destructive'
                : noRom || noExport
                  ? 'text-amber-500'
                  : highlight && !loading
                    ? 'text-daz-green'
                    : 'text-muted-foreground'
            }`}
          >
            {hint}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative z-10 shrink-0 border border-transparent hover:border-white/20 hover:bg-[#333] hover:shadow-sm dark:hover:bg-[#333]"
          title="Export only this scene"
          aria-label={`Export only ${displayName}`}
          disabled={disabled}
          onClick={onSolo}
        >
          <Wand className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
      {/* Row-wide toggle as a transparent cover (the LinkedAssetCard pattern) —
          checkbox and wand sit above it with z-10. A DOUBLE click selects all
          rows: the two single-click toggles fire first and cancel out, then
          dblclick lands, so the end state is deterministic. */}
      {!disabled && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggle}
          onDoubleClick={onSelectAll}
          className="absolute inset-0 rounded-lg"
        />
      )}
      {/* Left accent bar, over the cover button like the scene cards. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-daz-green" />
    </div>
  )
}

/** The Daz **Mode** dropdown, in the user's words. Order is the offer order;
 *  `rom-export` leads because it is the default full run. */
export const DAZ_MODE_OPTIONS: ReadonlyArray<{ mode: RunChoice; title: string; blurb: string }> = [
  {
    mode: 'rom-export',
    // The same spelling the run's Daz task rows carry — one source, so the
    // card cannot end up calling the run something the dropdown didn't.
    title: EXPORT_MODE_LABELS['rom-export'],
    blurb: 'Build a fresh ROM, save the ROM animation scene, then export everything.',
  },
  {
    mode: 'rom-only',
    title: EXPORT_MODE_LABELS['rom-only'],
    blurb: 'Build the ROM and save the ROM animation scene, skipping the export.',
  },
  {
    mode: 'export-only',
    title: EXPORT_MODE_LABELS['export-only'],
    blurb: 'Export the saved ROM animations as they stand, without rebuilding.',
  },
  {
    mode: 'hair-only',
    title: EXPORT_MODE_LABELS['hair-only'],
    blurb: 'Export only the hair items of the selected scenes — lists the scenes with “Export hair items” on.',
  },
  {
    mode: 'houdini-only',
    title: 'Skip Daz — use last exports',
    blurb: 'Run nothing in Daz; the Houdini projects work off each scene’s last export.',
  },
]

/** The Houdini **Mode** dropdown — what the Houdini leg does. `skip` is offered
 *  only when the project has a linked Unreal project (see
 *  {@link HoudiniRunMode}): without one it would mean "do nothing". */
export const HOUDINI_MODE_OPTIONS: ReadonlyArray<{ mode: HoudiniRunMode; title: string; blurb: string }> = [
  {
    mode: 'export-selected',
    title: 'Export selected scenes',
    blurb: 'Run the DazToHue exports for the checked Daz scenes.',
  },
  {
    mode: 'skip',
    title: 'Skip Houdini — use last exports',
    blurb: 'Run no Houdini; hand the last exports on disk to the Unreal projects below.',
  },
]

export function HipRow({
  hip,
  sets,
  checked,
  missing,
  onToggle,
}: {
  hip: string
  /** The DazToHue networks this project writes, from the STORED scan (each
   *  export node's `character_name`) — read without opening the `.hip`, which
   *  costs tens of seconds. A fact about the PROJECT: it holds whether the row
   *  is ticked or not, and under "Skip Houdini", which runs no Houdini leg at
   *  all. Empty = the scan has never reached this project, which is "not
   *  known", not "writes none": the chips then say nothing at all (see
   *  {@link SetChips}). */
  sets: ReadonlyArray<string>
  checked: boolean
  /** The `.hip` can't be found on disk — the row is refused (an already-checked
   *  one can still be UNchecked, like the scene rows' stale-status rule). */
  missing: boolean
  onToggle: () => void
}) {
  const stem = (hip.split(/[\\/]/).pop() ?? hip).replace(/\.[^./\\]+$/, '')
  // The tail of the path — enough to tell twins apart without the wall of
  // drive/project prefix the full path wastes the line on.
  const parts = hip.replace(/\\/g, '/').split('/').filter(Boolean)
  const shortPath = parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : hip.replace(/\\/g, '/')
  return (
    <div className="group/card relative w-full">
      <div
        className={`houdini-card relative flex items-center gap-3 rounded-lg border p-3 pl-4${missing ? ' opacity-50' : ''}`}
        data-selected={checked ? 'true' : undefined}
      >
        <input
          type="checkbox"
          className="relative z-10 size-4 shrink-0 accent-houdini-orange"
          aria-label={`Run in ${stem}`}
          checked={checked}
          disabled={missing && !checked}
          onChange={onToggle}
        />
        <span className="flex aspect-[3/4] h-[56px] shrink-0 items-center justify-center rounded-md bg-[#262626]">
          <img src={houdiniLogo} alt="" aria-hidden className="size-8 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{stem}</span>
          <p
            className={`mt-0.5 truncate text-xs ${missing ? 'text-destructive' : 'text-muted-foreground'}`}
            title={hip.replace(/\\/g, '/')}
          >
            {missing ? 'Project file missing on disk — relink it in the editor' : shortPath}
          </p>
          {/* What this project actually DOES, one chip per network. A project
              can hold several, and until they were on the row the only way to
              learn how many was to start the run and watch the task list fill
              in. Not a claim about THIS run — the checkbox is what says whether
              the project is in it (see {@link SetChips}). */}
          <SetChips caption="Networks" names={sets} tone="houdini" />
        </div>
      </div>
      {/* Row-wide toggle as a transparent cover, like the scene rows. */}
      {!missing && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggle}
          className="absolute inset-0 rounded-lg"
        />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-houdini-orange" />
    </div>
  )
}

/** One linked Unreal project in the panel's third section. Same shape as
 *  {@link HipRow} — checkbox, logo, name, one line of context. */
export function UnrealRow({
  uproject,
  sets,
  checked,
  has,
  disabled,
  onToggle,
}: {
  uproject: string
  /** The export sets this run would send INTO THIS PROJECT — the characters it
   *  is getting, one import job (and one task row) each. Already narrowed to
   *  what the probe located there, because the send is re-import only and
   *  `unrealTaskCards` drops the rest. Empty when there is nothing to send or
   *  the studio cannot name it. */
  sets: ReadonlyArray<string>
  checked: boolean
  /** The project already holds at least one export set THIS RUN is sending it
   *  (assets named after it) — a re-import, and why the row comes pre-checked.
   *  `false` = the probe landed and found none, and since the send is
   *  RE-import only (a first import is the user's own act inside Unreal), the
   *  row is inert with the subtitle saying why. null = the probe hasn't
   *  landed (tickable — the send re-probes at handover). */
  has: boolean | null
  /** There is nothing for this run to send — it produces no export, the
   *  export folder it would hand over is empty, or (`has === false`) nothing
   *  this run makes is in that project to re-import. The row goes inert
   *  rather than sitting there ticked and lying about what Start does. */
  disabled: boolean
  onToggle: () => void
}) {
  const stem = (uproject.split(/[\\/]/).pop() ?? uproject).replace(/\.[^./\\]+$/, '')
  const parts = uproject.replace(/\\/g, '/').split('/').filter(Boolean)
  const shortPath = parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : uproject.replace(/\\/g, '/')
  return (
    <div className="group/card relative w-full">
      <div
        className={`unreal-pick-card relative flex items-center gap-3 rounded-lg border p-3 pl-4${disabled ? ' opacity-50' : ''}`}
        data-selected={checked ? 'true' : undefined}
      >
        <input
          type="checkbox"
          className="relative z-10 size-4 shrink-0 accent-unreal-blue"
          aria-label={`Send to ${stem}`}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
        />
        <span className="flex aspect-[3/4] h-[56px] shrink-0 items-center justify-center rounded-md bg-[#262626]">
          <img src={unrealLogo} alt="" aria-hidden className="size-8 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{stem}</span>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={uproject.replace(/\\/g, '/')}>
            {/* Not "already has this character": the whole point of the
                pre-tick is that holding SOME variant is not holding the one
                this run makes, and this line is where the user reads which
                question was asked. The `false` line names the manual step,
                because the studio deliberately doesn't do it: a character's
                FIRST import into a project is made in Unreal itself. */}
            {has === true
              ? 'Already has what this run sends'
              : has === false
                ? 'Nothing here to re-import — make the first import in Unreal itself'
                : shortPath}
          </p>
          {/* WHICH characters land in this project — one chip per import job,
              the same rows the run's task list carries for it. The section
              deliberately asks nothing about them (see the panel's `sendSets`);
              this only shows what the studio already worked out. */}
          <SetChips caption="Characters" names={sets} tone="unreal" />
        </div>
      </div>
      {!disabled && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggle}
          className="absolute inset-0 rounded-lg"
        />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-unreal-blue" />
    </div>
  )
}

