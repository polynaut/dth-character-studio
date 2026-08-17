/**
 * The export panel's list rows — one Daz scene, one Houdini project, one Unreal
 * project — plus the run-mode option tables they pick from and the modal that
 * waits for Daz to close.
 *
 * Split out of `dth-export.tsx`; nothing here changed in the move.
 */
import { useEffect } from 'react'
import { Loader2, Wand } from 'lucide-react'

import { Button, Modal } from '@dth/ui'
import houdiniLogo from '#/assets/houdini-logo.svg'
import unrealLogo from '#/assets/unreal-logo.svg'
import { Portrait } from '#/components/portrait.tsx'
import { PrimaryBadge } from '#/components/primary-badge.tsx'
import {
  exportDazStudioRunning,
  exporterJobsWorking,
  launchDazForPendingJobs,
} from '#/lib/rom/api.ts'
import { EXPORT_MODE_LABELS } from '#/lib/rom/execute-jobs.ts'
import type { GenesisVersion } from '@dth/rom'
import type { ExecuteSceneStatus } from '#/lib/rom/api.ts'
import type { HoudiniRunMode, RunChoice } from '#/lib/rom/execute-jobs.ts'

export function WaitForDazCloseModal({
  onDone,
  onCancel,
}: {
  /** The wait resolved: `started` = Daz was launched (or runs again) for the
   *  pending batch; false = nothing to launch — the handoff disappeared
   *  (aborted) or a live Daz claimed late and is working it (the export
   *  watch's run now). */
  onDone: (started: boolean) => void
  onCancel: () => void
}) {
  useEffect(() => {
    let active = true
    let settled = false
    const id = window.setInterval(() => {
      void (async () => {
        // Wait for the process to actually be gone, then hand the decision to
        // `launchDazForPendingJobs` — it is the one that knows whether there is
        // anything left to run.
        //
        // It used to bail the moment the PENDING file disappeared, on the
        // assumption that "claimed or aborted" both mean "not my problem". But
        // a Daz that is closing can claim the batch (the rename) and exit
        // before running a row, which looks identical from here — so the panel
        // closed, nothing launched, and the batch sat orphaned in a `running_`
        // file the Runner never polls for. That is now reclaimed instead.
        //
        // The EXPORT installation, not "any Daz": this waits for the process
        // that has to restart to run the batch, and with "Export only" set,
        // another open Daz would keep the modal spinning forever.
        const running = await exportDazStudioRunning()
        if (!active || settled) return
        if (running) {
          // A LIVE Daz can also claim late — stuck on a modal Save prompt past
          // the pickup window, or restarted by the user. Once the claimed
          // batch shows real work it is the export watch's run, and "waiting
          // for Daz to close" would only invite killing it mid-batch — stand
          // down. Mere "pending gone while Daz runs" is NOT enough to settle:
          // that is exactly the closing-Daz claim this modal exists to rescue.
          if (await exporterJobsWorking()) {
            if (!active || settled) return
            settled = true
            onDone(false)
          }
          return
        }
        settled = true
        onDone(await launchDazForPendingJobs())
      })()
    }, 1000)
    return () => {
      active = false
      window.clearInterval(id)
    }
    // Mount-only: the callbacks are stable enough for this modal's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Modal open onClose={onCancel} title="Waiting for Daz Studio to close…" dismissible>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        <span>
          Daz Studio didn&apos;t pick the export up — it&apos;s probably still closing. As soon
          as the process is gone, Daz Studio starts again by itself and runs the export.
          Closing this keeps the batch queued (the header button aborts it).
        </span>
      </p>
    </Modal>
  )
}

/** One selectable scene row — a simplified Daz scene card: checkbox, `.tip.png`
 *  portrait, name, status hint, and the solo wand. Clicking the row toggles its
 *  checkbox, double-clicking selects EVERY row (the wand's counterpart); the
 *  daz-card utility supplies the tint/ring via `data-selected`. */
export function SceneRow({
  status,
  genesis,
  mode,
  checked,
  loading,
  onToggle,
  onSolo,
  onSelectAll,
}: {
  status: ExecuteSceneStatus
  /** The character's generation — picks the preview's face crop, because Daz
   *  frames a G3/G8/G8.1 render higher in the tip than a G9 one (lib/tip-framing). */
  genesis: GenesisVersion
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
  // has no staleness signal, so nothing highlights green there).
  const highlight =
    mode === 'houdini-only'
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
          genesis={genesis}
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
  checked,
  missing,
  onToggle,
}: {
  hip: string
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
  checked,
  has,
  disabled,
  onToggle,
}: {
  uproject: string
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

