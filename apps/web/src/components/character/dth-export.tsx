import { useEffect, useState } from 'react'
import { Ban, Loader2, Play, Wand } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Modal, useRefetchOnFocus } from '@dth/ui'
import dthLogo from '#/assets/dth-logo.webp'
import { Portrait } from '#/components/portrait.tsx'
import { PrimaryBadge } from '#/components/primary-badge.tsx'
import {
  abortExporterJobs,
  dismissExportRun,
  executeCharacterJobs,
  exporterJobsPending,
  fetchExecuteScenes,
  fetchExportRunProgress,
} from '#/lib/rom/api.ts'
import { normalizeSceneKey } from '#/lib/rom/execute-jobs.ts'

import type { ExecuteSceneStatus, ExportRunProgress } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

/**
 * The header's **DTH Export** button + its scene-picker dialog: choose which
 * linked Daz scenes to run through the DTH Exporter Plugin, then hand them off
 * as a job file and start Daz Studio (api/execute.ts +
 * docs/exporter-plugin-job-file.md).
 *
 * The dialog lists every linked scene as a simplified Daz scene card (accent
 * bar + selected styling like the editor's scene cards) with a checkbox; the
 * AFFECTED scenes — changed `.duf` or definition since their last handoff —
 * come pre-checked. Each row's wand solos it (check only this one). Confirm
 * needs at least one checked scene.
 *
 * Disabled while the draft is dirty (the export runs the GENERATED scripts on
 * disk, which lag unsaved edits), without an export directory (the runs exist
 * to deliver exports), or without a configured Daz library.
 *
 * While a job file is WAITING for Daz (written but not yet consumed — the
 * plugin deletes it once parsed, so "exists" is "pending") the button turns
 * into **Abort**: clicking deletes the job file (and rolls the aborted scenes'
 * handoff stamps back). Once Daz consumes the file, the button becomes a live
 * **Exporting n/m** state driven by the export watch (api/execute.ts keeps the
 * handed-off jobs in memory; a scene counts as delivered when its exported
 * PoseAsset CSV is newer than the handoff) — clicking that stops the watch,
 * and when every scene delivers it toasts and returns to DTH Export. Status
 * refreshes on window focus and polls lightly while pending/running.
 */
/** The DazToHue brand mark as a button icon. The button's automatic icon
 *  sizing only targets SVGs, so the img sizes itself — `size-6`, larger than
 *  the svg default; the mark's fine detail needs it. The host button keeps
 *  `px-3` by hand for the same reason (`has-[>svg]` doesn't see an img). */
function DthLogo() {
  return <img src={dthLogo} alt="" aria-hidden className="size-6 shrink-0 object-contain" />
}

export function DthExportAction({
  projectId,
  character,
  saving,
  dirty,
  dazLibraryConfigured,
}: {
  projectId: string
  character: Character
  saving: boolean
  dirty: boolean
  /** “My DAZ 3D Library” is set — where the job file and scripts live. */
  dazLibraryConfigured: boolean
}) {
  const [open, setOpen] = useState(false)
  // null = not yet checked (renders as the normal export button).
  const [pending, setPending] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<ExportRunProgress | null>(null)
  const [aborting, setAborting] = useState(false)

  // The one status refresh: is a job file still waiting (→ Abort), and how far
  // is the in-memory export watch (→ Exporting n/m)? Runs on mount + window
  // focus (tabbing back from Daz) and polls while either state is live.
  async function refreshStatus() {
    const [isPending, run] = await Promise.all([exporterJobsPending(), fetchExportRunProgress()])
    setPending(isPending)
    if (run && run.characterId !== character.id) {
      // Another character's run — not this button's business.
      setProgress(null)
      return
    }
    if (run?.allDone) {
      setProgress(null)
      toast.success(`DTH Export finished — ${run.total} scene${run.total === 1 ? '' : 's'} delivered.`)
      return
    }
    setProgress(run)
  }
  useRefetchOnFocus(
    () => {
      void refreshStatus()
    },
    [],
    { immediate: true },
  )
  const watching = pending === true || progress !== null
  useEffect(() => {
    if (!watching) return
    const id = window.setInterval(() => {
      void refreshStatus()
    }, 2500)
    return () => window.clearInterval(id)
    // Re-arm on `watching` alone (ONE interval): refreshStatus only captures
    // character.id, which is constant for a mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching])

  async function onAbort() {
    setAborting(true)
    try {
      await abortExporterJobs({ data: { projectId, id: character.id } })
      setPending(false)
      toast.success('Pending export jobs aborted — the job file was deleted.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setAborting(false)
    }
  }

  if (pending === true) {
    return (
      <Button
        variant="outline-destructive"
        onClick={() => void onAbort()}
        disabled={aborting}
        title="A job file is waiting for Daz Studio — Abort deletes it, nothing will run"
      >
        <Ban /> {aborting ? 'Aborting…' : 'Abort'}
      </Button>
    )
  }

  if (progress) {
    // Daz consumed the job file and is working through the scenes — the export
    // watch counts the delivered CSVs. Clicking stops the WATCH only (the run
    // in Daz can't be stopped from here); that's the escape hatch for a batch
    // that errored in Daz and will never deliver its remaining scenes.
    return (
      <Button
        variant="outline"
        className="px-3"
        onClick={() => {
          dismissExportRun()
          setProgress(null)
        }}
        title={`Daz Studio is delivering the exports — ${progress.finished} of ${progress.total} scene${progress.total === 1 ? '' : 's'} done. Click to stop watching.`}
      >
        <Loader2 className="animate-spin" /> Exporting {progress.finished}/{progress.total}…
      </Button>
    )
  }

  const sceneLinked = Boolean(character.scenePath)
  const exportDirSet = character.exportPath.trim() !== ''
  const disabled = saving || dirty || !sceneLinked || !dazLibraryConfigured || !exportDirSet
  const blockedHint = !dazLibraryConfigured
    ? 'Set “My DAZ 3D Library” in Settings first'
    : !sceneLinked
      ? 'Link a primary Daz scene first'
      : !exportDirSet
        ? 'Set an export directory first — the export runs deliver into it'
        : dirty
          ? 'Save first — the export runs the generated scripts on disk'
          : undefined

  return (
    <>
      <Button
        variant="outline"
        className="px-3"
        onClick={() => setOpen(true)}
        disabled={disabled}
        // Only the blocked states carry a tooltip (they explain WHY the button
        // is off); the enabled button speaks for itself — the dialog's title
        // popup holds the long description.
        title={blockedHint}
      >
        <DthLogo /> DTH Export
      </Button>
      {open && (
        <DthExportDialog
          projectId={projectId}
          character={character}
          onClose={() => setOpen(false)}
          onExported={() => {
            setPending(true)
            // Arm the progress view right away (0/n until Daz delivers).
            void refreshStatus()
          }}
        />
      )}
    </>
  )
}

/** One selectable scene row — a simplified Daz scene card: checkbox, `.tip.png`
 *  portrait, name, status hint, and the solo wand. Clicking the row toggles its
 *  checkbox; the daz-card utility supplies the tint/ring via `data-selected`. */
function SceneRow({
  status,
  checked,
  loading,
  onToggle,
  onSolo,
}: {
  status: ExecuteSceneStatus
  checked: boolean
  /** Affected-detection still running — checkboxes are settling, keep quiet. */
  loading: boolean
  onToggle: () => void
  onSolo: () => void
}) {
  const fileName = status.scenePath.split(/[\\/]/).pop() ?? status.scenePath
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  const disabled = status.missing
  const hint = status.missing
    ? 'Scene file missing — relink it in the editor'
    : loading
      ? 'Checking for changes…'
      : status.affected
        ? 'Changed since the last export'
        : 'Unchanged since the last export'
  return (
    <div className="group/card relative w-full">
      <div
        className={`daz-card relative flex items-center gap-3 rounded-lg border p-3 pl-4${disabled ? ' opacity-50' : ''}`}
        data-selected={checked ? 'true' : undefined}
      >
        {/* z-10 lifts the real controls above the row's cover button. */}
        <input
          type="checkbox"
          className="relative z-10 size-4 shrink-0 accent-daz-green"
          aria-label={`Export ${displayName}`}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
        />
        <Portrait
          scenePath={status.scenePath}
          name={displayName}
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
              status.missing
                ? 'text-destructive'
                : status.affected && !loading
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
          checkbox and wand sit above it with z-10. */}
      {!disabled && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggle}
          className="absolute inset-0 rounded-lg"
        />
      )}
      {/* Left accent bar, over the cover button like the scene cards. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-daz-green" />
    </div>
  )
}

function DthExportDialog({
  projectId,
  character,
  onClose,
  onExported,
}: {
  projectId: string
  character: Character
  onClose: () => void
  /** A handoff was written — the header button flips to Abort. */
  onExported: () => void
}) {
  // Rows render immediately from the linked scenes; the affected-detection
  // (one stat + signature per scene) fills in and pre-checks the changed ones.
  const [status, setStatus] = useState<Array<ExecuteSceneStatus> | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const rows: Array<ExecuteSceneStatus> =
    status ??
    linked.map((scenePath, index) => ({
      scenePath,
      primary: index === 0,
      affected: false,
      missing: false,
    }))

  useEffect(() => {
    let active = true
    fetchExecuteScenes({ data: { projectId, id: character.id } })
      .then((scenes) => {
        if (!active) return
        setStatus(scenes)
        setChecked(new Set(scenes.filter((s) => s.affected).map((s) => s.scenePath)))
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
            })),
        )
        toast.error(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
    // Mount-only ON PURPOSE (the dialog is modal — the scene list can't change
    // while it's open): re-running on a draft-identity change (the focus-driven
    // avatar sync patches the draft when tabbing back from Daz) would refetch
    // and wipe the user's checkbox choices mid-pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, character.id])

  function toggle(scene: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(scene)) next.delete(scene)
      else next.add(scene)
      return next
    })
  }

  async function onExport() {
    setBusy(true)
    try {
      const result = await executeCharacterJobs({
        // Preserve row order — the jobs run top to bottom.
        data: { projectId, id: character.id, scenes: rows.filter((r) => checked.has(r.scenePath)).map((r) => r.scenePath) },
      })
      if (result.dazWasRunning) {
        toast.warning(
          `Jobs written for ${result.scenes.length} scene${result.scenes.length === 1 ? '' : 's'}, ` +
            'but Daz Studio is already running — restart it so the Exporter Plugin picks them up.',
        )
      } else {
        toast.success(
          `Started Daz Studio — ${result.scenes.length} scene${result.scenes.length === 1 ? '' : 's'} queued for export.`,
        )
      }
      onExported()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-1.5">
          DTH Export
          <InfoPopup label="DTH Export — more information">
            Choose the Daz scenes to run through the DTH Exporter Plugin. Scenes that changed
            since their last export are pre-selected; the wand picks a single scene.
          </InfoPopup>
        </span>
      }
      dismissible={!busy}
    >
      <p className="text-xs text-muted-foreground">
        Heads up: this takes a long time — Daz Studio plays through the full ROM for every
        selected scene.
      </p>
      <div className="space-y-2">
        {rows.map((row) => (
          <SceneRow
            key={normalizeSceneKey(row.scenePath)}
            status={row}
            checked={checked.has(row.scenePath)}
            loading={status === null}
            onToggle={() => toggle(row.scenePath)}
            onSolo={() => setChecked(new Set([row.scenePath]))}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" className="mr-auto" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || checked.size === 0}
          title={checked.size === 0 ? 'Select at least one scene' : undefined}
          onClick={() => void onExport()}
        >
          <Play /> {busy ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </Modal>
  )
}
