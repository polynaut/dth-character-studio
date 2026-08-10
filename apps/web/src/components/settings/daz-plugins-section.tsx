import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CircleCheck, Download, FolderOpen, Plus, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Input, useRefetchOnFocus } from '@dth/ui'
import { InstallReportList } from '#/components/install-controls.tsx'
import { PathCode } from '#/components/path-code.tsx'
import { PostInstallElevationNotice } from '#/components/settings/post-install-elevation-notice.tsx'
import { fetchDazPluginState, installDazPlugins, pendingPluginInstalls } from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { browseStart, displayPath } from '#/lib/path.ts'

import type { DazPluginState, DazPluginTarget, InstallReport } from '#/lib/rom/api.ts'
import type { DazFlavor } from '#/lib/daz-plugins.ts'

/** "Daz Studio 4" / "Daz Studio 6+" — what a generation is called on screen. */
const FLAVOR_LABEL: Record<DazFlavor, string> = { ds4: 'Daz Studio 4', ds6: 'Daz Studio 6' }

/** What this target still needs, as the row's own verdict. */
function exporterLine(target: DazPluginTarget): { text: string; tone: 'ok' | 'pending' | 'none' } {
  if (!target.exporterSource) {
    return {
      text: target.flavor
        ? `no ${FLAVOR_LABEL[target.flavor]} build among your release folders`
        : 'generation unknown — no build can be matched',
      tone: 'none',
    }
  }
  const source = target.exporterSource.version || '?'
  if (!target.exporterInstalled) return { text: `not installed → ${source}`, tone: 'pending' }
  if (target.exporterInstalled === target.exporterSource.version) {
    return { text: target.exporterInstalled, tone: 'ok' }
  }
  return { text: `${target.exporterInstalled} → ${source}`, tone: 'pending' }
}

/** The same verdict for the bundled Runner. */
function runnerLine(target: DazPluginTarget): { text: string; tone: 'ok' | 'pending' | 'none' } {
  const { runner } = target
  if (runner.error) return { text: runner.error, tone: 'none' }
  if (runner.installed === 'current') return { text: runner.bundledVersion || 'installed', tone: 'ok' }
  if (runner.installed === 'none') {
    return { text: `not installed → ${runner.bundledVersion || 'bundled'}`, tone: 'pending' }
  }
  const installed = runner.installedVersion || 'unknown build'
  return { text: `${installed} → ${runner.bundledVersion || 'bundled'}`, tone: 'pending' }
}

function StateCell({ state }: { state: { text: string; tone: 'ok' | 'pending' | 'none' } }) {
  if (state.tone === 'ok') {
    return (
      <span className="flex items-center gap-1 text-emerald-500">
        <CircleCheck className="size-3.5 shrink-0" /> {state.text}
      </span>
    )
  }
  return (
    <span className={state.tone === 'pending' ? 'text-foreground' : 'text-muted-foreground'}>
      {state.text}
    </span>
  )
}

/**
 * "Daz Studio plugins" (Settings → General) — every plugin the studio installs
 * into Daz, into every Daz on the machine.
 *
 * Both plugins ship ONE BINARY PER STUDIO GENERATION (the DTH Exporter from
 * mrpdean's release folders, the Runner from inside this app), and a machine can
 * run several generations side by side. The old panels asked for one release
 * folder and installed it into one Daz — which on a DS4 + DS6 machine could only
 * ever describe half the setup, and silently offered to copy a DS4 build into a
 * DS6 install. So this is a MATCH instead: what you have on the left, every
 * installation on the right, paired by the generation each binary is built for
 * (`lib/daz-plugins.ts` — the `dsp_` prefix Daz Studio 6 requires is what names
 * a build's generation, the folder name only cross-checks it).
 */
export function DazPluginsSection({
  folders,
  onFoldersChange,
  saveBeforeInstall,
}: {
  /** The configured Exporter release folders (`dthExporterFolders`). */
  folders: Array<string>
  onFoldersChange: (folders: Array<string>) => void
  /** Settings' "pending changes are saved on install" hook — the folder list
   *  has to be ON DISK before the install reads it back. Returns false when the
   *  save failed, in which case the install is not attempted. */
  saveBeforeInstall: () => Promise<boolean>
}) {
  const [state, setState] = useState<DazPluginState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<InstallReport | null>(null)

  // Scanned from the FIELDS, not from settings.json: a folder just added is
  // unsaved, and reading the saved list would describe the list the user had
  // before they touched it.
  const foldersKey = folders.join('|')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setState(await fetchDazPluginState({ data: { folders } }))
      setLoadError('')
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // The folder LIST is the input; `foldersKey` is its stable identity (a new
    // array every render would re-create this callback forever).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldersKey])

  // Re-read on focus: installing a Daz Studio, or dropping a new plugin release
  // into a folder, both happen outside this window. Debounced on the folder
  // list so TYPING a path doesn't walk a network share on every keystroke —
  // the same 350ms the folder fields on this page have always used.
  useRefetchOnFocus(
    () => {
      void load()
    },
    [load],
    { immediate: false },
  )
  useEffect(() => {
    const timer = setTimeout(() => void load(), 350)
    return () => clearTimeout(timer)
  }, [load])

  async function addFolder() {
    const picked = await pickFolder(
      'DTH Exporter Plugin release folder',
      browseStart(folders[folders.length - 1], folders.find(Boolean)),
    )
    if (picked && !folders.some((f) => f.toLowerCase() === picked.toLowerCase())) {
      onFoldersChange([...folders, picked])
    }
  }

  async function run(dryRun: boolean, force = false) {
    setBusy(true)
    try {
      // The install re-reads settings from disk, so an unsaved folder list would
      // install from the PREVIOUS one — save first, exactly like the other
      // install buttons on this page.
      if (!dryRun && !(await saveBeforeInstall())) return
      const result = await installDazPlugins({ data: { dryRun, force } })
      setReport(result)
      const failed = result.steps.filter((step) => step.status === 'error').length
      if (failed > 0) {
        toast.warning(
          `${result.steps.length - failed} of ${result.steps.length} plugin copies succeeded — ${failed} failed (admin rights?)`,
        )
      } else {
        toast.success(
          dryRun
            ? `Dry run — ${result.steps.length} plugin cop(ies) would be installed`
            : `Installed ${result.totalFiles} file(s) into ${result.steps.length} location(s)`,
        )
      }
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pending = state ? pendingPluginInstalls(state) : 0

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1 font-semibold">
          Daz Studio plugins
          <InfoPopup label="Daz Studio plugins — more information">
            <div className="space-y-2">
              <p>
                Two plugins live inside Daz Studio: the <strong>DTH Exporter</strong> (mrpdean&apos;s
                — you point the studio at its release folders) and the{' '}
                <strong>DTH Character Studio Runner</strong> (ours, shipped inside this app), which
                runs DTH Export batches unattended.
              </p>
              <p>
                Both are built <strong>per Daz Studio generation</strong>, and both are installed
                into <strong>every</strong> Daz Studio on this machine — the Daz Studio 4 build into
                each Daz Studio 4, the Daz Studio 6 build into each Daz Studio 6. Which build a
                folder holds is read from the DLL itself: Daz Studio 6 only loads plugins named{' '}
                <span className="font-mono">dsp_*.dll</span>, so the name is the generation.
              </p>
              <p>
                Add one folder per release, or a single folder holding a subfolder per generation
                (how the Exporter is published) — both are scanned. Daz Studio must be closed while
                installing: a running Daz locks its plugins.
              </p>
            </div>
          </InfoPopup>
        </h2>
        <Button variant="ghost" size="sm" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw className={loading ? 'animate-spin' : ''} /> Rescan
        </Button>
      </div>

      {/* --- sources ------------------------------------------------------ */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">DTH Exporter Plugin release folder(s)</p>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void addFolder()}>
            <Plus /> Add folder
          </Button>
        </div>
        {folders.length === 0 && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No release folder yet — add the folder holding the Exporter DLLs (or the one holding a
            folder per Daz Studio version). The Runner plugin below needs none; it ships with the
            app.
          </p>
        )}
        {folders.map((folder, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={displayPath(folder)}
              placeholder={'X:\\…\\DazToHue\\ExporterPlugin'}
              onChange={(e) => onFoldersChange(folders.map((f, j) => (j === i ? e.target.value : f)))}
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  const picked = await pickFolder('DTH Exporter Plugin release folder', browseStart(folder))
                  if (picked) onFoldersChange(folders.map((f, j) => (j === i ? picked : f)))
                })()
              }}
            >
              <FolderOpen /> Browse
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0"
              title="Remove folder"
              disabled={busy}
              onClick={() => onFoldersChange(folders.filter((_, j) => j !== i))}
            >
              <X />
            </Button>
          </div>
        ))}

        {/* What the scan actually found — the evidence behind every row below. */}
        {state && state.sources.length > 0 && (
          <ul className="space-y-1 pl-1 text-xs text-muted-foreground">
            {state.sources.map((source) => (
              <li key={`${source.folder}|${source.fileName}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-foreground">{source.fileName}</span>
                <span className="rounded bg-muted px-1 py-0.5 font-medium">
                  {FLAVOR_LABEL[source.flavor]}
                </span>
                <span>{source.version || 'no version resource'}</span>
                <span className="min-w-0 truncate">· {displayPath(source.folder)}</span>
                {source.pathHint && source.pathHint !== source.flavor && (
                  <span className="flex items-center gap-1 text-amber-500">
                    <AlertTriangle className="size-3 shrink-0" />
                    the folder says {FLAVOR_LABEL[source.pathHint]} — the DLL name wins
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {state?.emptyFolders.map((folder) => (
          <p key={folder} className="flex items-start gap-1.5 text-xs text-amber-500">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>No Exporter DLL in {displayPath(folder)} (or one level below it).</span>
          </p>
        ))}
        {state && (
          <p className="pl-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Runner plugin</span> — ships with this app
            {state.runnerBundledVersion ? ` (${state.runnerBundledVersion})` : ' (none staged in this build)'}.
          </p>
        )}
      </div>

      {/* --- targets ------------------------------------------------------ */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Installed in</p>
        {loadError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>Couldn&apos;t read the Daz installations: {loadError}</span>
            <Button variant="outline" size="xs" className="shrink-0" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}
        {!loadError && state?.noTargets && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No Daz Studio installation detected — activate one above, or set the Daz Studio install
            folder, and the plugins go there.
          </p>
        )}
        {state && state.targets.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-1 pr-3 font-medium">Daz Studio</th>
                  <th className="pb-1 pr-3 font-medium">Exporter plugin</th>
                  <th className="pb-1 font-medium">Runner plugin</th>
                </tr>
              </thead>
              <tbody>
                {state.targets.map((target) => (
                  <tr key={target.path} className="border-t align-top">
                    <td className="py-1.5 pr-3">
                      <div className="font-medium">{target.name}</div>
                      <PathCode path={displayPath(target.path)} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <StateCell state={exporterLine(target)} />
                    </td>
                    <td className="py-1.5">
                      <StateCell state={runnerLine(target)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={busy || loading} onClick={() => void run(true)}>
          {busy ? 'Working…' : 'Dry run'}
        </Button>
        <Button
          disabled={busy || loading || !state || state.noTargets}
          onClick={() => void run(false, pending === 0)}
        >
          <Download /> {pending > 0 ? 'Install / update all' : 'Reinstall all'}
        </Button>
        <span className="text-sm text-muted-foreground">
          {pending > 0
            ? `${pending} plugin cop${pending === 1 ? 'y' : 'ies'} pending`
            : state && state.targets.length > 0
              ? 'Everything up to date — Reinstall copies it all again.'
              : ''}
        </span>
      </div>

      {report && <InstallReportList report={report} onClose={() => setReport(null)} />}

      {report?.steps.some((step) => step.status === 'error') && (
        <p className="text-sm text-destructive">
          A copy failed — close all Daz Studio windows and restart DTH Character Studio as
          administrator, then try again. (A running Daz locks its loaded plugin DLLs, and{' '}
          <span className="font-mono">Program Files</span> needs elevation.)
        </p>
      )}

      <PostInstallElevationNotice report={report} />
    </section>
  )
}
