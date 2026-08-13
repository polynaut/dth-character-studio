import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react'
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
  useRefetchOnFocus,
} from '@dth/ui'
import unrealLogo from '#/assets/unreal-logo.svg'
import {
  dismissUnrealImport,
  fetchUnrealImportProgress,
  fetchUnrealSendPlan,
  startUnrealImport,
} from '#/lib/rom/api.ts'
import { uprojectDisplayName } from '#/components/unreal-install-dialog.tsx'
import type { UnrealImportState } from '#/lib/rom/unreal-jobs.ts'
import type { UnrealSendPlan } from '#/lib/rom/api.ts'

/**
 * Send a character's Houdini export to a linked Unreal project.
 *
 * The third leg of the round trip, and the same handoff shape as the other two:
 * the studio writes a job file, the editor's bridge plugin claims it and
 * imports, the studio polls a result. Nothing here decides what an import DOES
 * — that is the DazToHue plugin's own pipeline.
 *
 * Deliberately NOT a Daz/Houdini-style launch: an Unreal editor takes minutes
 * to start and holds its project, so the studio never starts one. It hands over
 * a job; a watching editor picks it up (and one that opens later picks it up
 * on startup, exactly like a Daz that was closed when the batch was queued).
 *
 * The watcher — the DTH Studio Bridge plugin — is installed from the project
 * card's Install action, not from here: it is a plugin in the user's own Unreal
 * project, and sending must not put one there behind their back. Sending
 * without it fails saying exactly that.
 */
export function UnrealImportField({
  projectId,
  characterId,
  unrealProjects,
}: {
  projectId: string
  characterId: string
  /** The PROJECT's linked `.uproject` paths (per-project, not per-character). */
  unrealProjects: ReadonlyArray<string>
}) {
  const [target, setTarget] = useState(unrealProjects[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [run, setRun] = useState<UnrealImportState | null>(null)
  // The character's export sets + which of them the chosen project already
  // holds. null = the probe hasn't landed.
  const [plan, setPlan] = useState<UnrealSendPlan | null>(null)
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  // The project being watched — kept in a ref so the poll never chases a target
  // the user changed mid-run.
  const watching = useRef('')

  // Keep the picker on a still-linked project when the list changes underneath.
  useEffect(() => {
    if (!unrealProjects.includes(target)) setTarget(unrealProjects[0] ?? '')
  }, [unrealProjects, target])

  // Re-read on focus: a Houdini export writes new sets outside this window.
  useRefetchOnFocus(
    () => {
      void fetchUnrealSendPlan({ data: { projectId, id: characterId } })
        .then(setPlan)
        .catch(() => setPlan({ sets: [], located: {} }))
    },
    [projectId, characterId],
    { immediate: true },
  )

  // The tick rule, and the whole point of the checklist: a set the project
  // ALREADY holds is a re-import and comes ticked; one it doesn't is a FIRST
  // import and waits to be asked for. Re-derived when the target changes,
  // because "already there" is a question about that project.
  useEffect(() => {
    const has = plan?.located[target] ?? {}
    setChosen(new Set((plan?.sets ?? []).filter((name) => has[name] !== undefined)))
  }, [plan, target])

  const poll = useCallback(async () => {
    const uprojectPath = watching.current
    if (!uprojectPath) return
    const state = await fetchUnrealImportProgress({ data: { uprojectPath } }).catch(() => null)
    setRun(state)
    if (state?.state === 'finished') {
      watching.current = ''
      if (state.error) toast.error(`Unreal import failed — ${state.error}`, { duration: Infinity })
      else {
        // Which of the two happened is worth saying: a re-import landed on the
        // assets that were already there (possibly somewhere the studio never
        // chose), a plain import created a set at the destination it asked for.
        const what = state.reimported ? 'Re-imported in Unreal' : 'Imported into Unreal'
        const assets = `${state.assets} asset${state.assets === 1 ? '' : 's'}`
        // One set names its folder; several name their count, because a toast
        // listing three content paths is a wall.
        const where =
          state.destination !== ''
            ? ` in ${state.destination}`
            : ` across ${state.sets} export set${state.sets === 1 ? '' : 's'}`
        toast.success(`${what} — ${assets}${where}.`, { duration: Infinity })
      }
      // The files have said what they had to; the next run starts clean.
      void dismissUnrealImport({ data: { uprojectPath } })
    }
  }, [])

  // 2.5s, the same cadence as the other two watches.
  useEffect(() => {
    if (!run || run.state === 'finished') return
    const timer = setInterval(() => void poll(), 2500)
    return () => clearInterval(timer)
  }, [run, poll])

  async function onSend() {
    if (!target) return
    setBusy(true)
    try {
      const started = await startUnrealImport({
        data: { projectId, id: characterId, uprojectPath: target, sets: [...chosen] },
      })
      watching.current = target
      setRun({ state: 'waiting' })
      // `destination` is where a FRESH import goes; if the project already has
      // these files the bridge re-imports where they are, and the finish toast
      // says so. Hence "into" here and the real path on the way out.
      const what =
        started.destination !== ''
          ? started.destination
          : `${started.sets.length} export sets (${started.sets.map((set) => set.name).join(', ')})`
      toast.info(
        started.replacedPending
          ? `Queued for Unreal — replaced a job the editor had not picked up yet. Importing ${what}.`
          : `Queued for Unreal — importing ${what}. Open the project if it isn't already.`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e), { duration: Infinity })
    } finally {
      setBusy(false)
    }
  }

  if (unrealProjects.length === 0) return null

  return (
    <section className="rounded-lg border p-3">
      <Label className="mb-1 flex w-fit items-center gap-1.5 text-base font-semibold">
        <img src={unrealLogo} alt="" aria-hidden className="size-4 object-contain" />
        Send to Unreal
        <InfoPopup label="Send to Unreal — more information">
          <div className="space-y-2">
            <p>
              Hands this character&apos;s <strong>Houdini export</strong> to the chosen Unreal
              project — the <code>.dth</code> in the character&apos;s <code>export</code> folder,
              which is what the DazToHue importer plugin reads. Run the Houdini export first.
            </p>
            <p>
              The studio does <strong>not</strong> start Unreal: an editor takes minutes to come up
              and holds its project. It writes a job file, and the{' '}
              <strong>DTH Studio Bridge</strong> plugin picks it up within about a second — an
              editor opened later claims it on startup.
            </p>
            <p>
              The bridge installs like any other plugin: the project card&apos;s{' '}
              <strong>Install</strong> action, where it is pre-checked. Unreal loads plugins at
              startup, so restart the editor once after installing it.
            </p>
            <p>
              One character can have several <strong>export sets</strong> — one per character name
              used in Houdini, e.g. outfit variants. Each is its own import, so each is its own
              tick: a set the project already holds is shown with the folder it will refresh and
              comes ticked; one it doesn&apos;t is marked <em>not in this project</em> and waits to
              be asked for, so a variant never lands in Unreal by accident.
            </p>
            <p>
              The import itself is the DazToHue plugin&apos;s own pipeline, unmodified: meshes,
              textures, materials, animation curves and the post-process anim blueprint.
            </p>
          </div>
        </InfoPopup>
      </Label>

      {unrealProjects.length > 1 && (
        <Select value={target} onValueChange={setTarget} disabled={busy}>
          <SelectTrigger className="mb-2 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {unrealProjects.map((path) => (
              <SelectItem key={path} value={path}>
                {uprojectDisplayName(path)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* WHAT to send. A character's export folder holds one set per HDA
          character name, and they are separate imports — so they are separate
          decisions, with the ones the project already has ticked for you. */}
      {plan !== null && plan.sets.length > 0 && (
        <ul className="mb-2 space-y-1">
          {plan.sets.map((name) => {
            const at = plan.located[target]?.[name]
            return (
              <li key={name}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-unreal-blue"
                    disabled={busy}
                    checked={chosen.has(name)}
                    onChange={(e) =>
                      setChosen((current) => {
                        const next = new Set(current)
                        if (e.target.checked) next.add(name)
                        else next.delete(name)
                        return next
                      })
                    }
                  />
                  <span className="font-mono">{name}</span>
                  {at !== undefined ? (
                    <span className="text-xs text-muted-foreground" title={`Re-imports into ${at}`}>
                      {at}
                    </span>
                  ) : (
                    <span className="rounded bg-amber-500/15 px-1 py-0.5 text-xs font-medium text-amber-500">
                      not in this project
                    </span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {plan !== null && plan.sets.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">
          Nothing exported yet — run the Houdini export first.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => void onSend()} disabled={busy || !target || chosen.size === 0}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Send to Unreal
        </Button>
        {run?.state === 'waiting' && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Waiting for the editor to pick it up…
          </span>
        )}
        {run?.state === 'running' && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Importing in Unreal…
          </span>
        )}
      </div>

      {run?.state === 'waiting' && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Nothing has claimed it yet. That is normal while Unreal starts — if the project is
            already open and this does not move, the bridge was installed after that editor
            session began: restart the editor once.
          </span>
        </p>
      )}
    </section>
  )
}
