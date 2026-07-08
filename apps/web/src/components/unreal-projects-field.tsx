import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ExternalLink, HardDriveDownload, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { Button } from '#/components/ui/button.tsx'
import { cn } from '#/lib/utils.ts'
import unrealLogo from '#/assets/unreal-logo.svg'
import {
  installUnrealDthContent,
  openScene,
  revealPath,
  setUnrealProjects,
  unrealDthContentPresent,
} from '#/lib/rom/api.ts'
import { pickUprojectPath } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'

import type { ProjectInfo } from '#/lib/rom/api.ts'

/**
 * A linked Unreal project card in the footer bar: the U mark, name + folder —
 * clicking opens the `.uproject` (OS association → Unreal). The tiny install
 * button bootstraps the project with the ACTIVE DTH release's Unreal content
 * (`Content/DazToHue`): dimmed once present; Ctrl+click overwrites anyway
 * (e.g. after switching the release in Settings). The hover ✕ only unlinks.
 */
function UnrealCard({
  uprojectPath,
  dthPresent,
  ctrlHeld,
  installing,
  onOpen,
  onInstall,
  onRemove,
}: {
  uprojectPath: string
  /** undefined while the Content/DazToHue probe is still running. */
  dthPresent: boolean | undefined
  /** Ctrl/Cmd is held — an installed project's dimmed install button wakes up
   *  to hint that a click now re-installs (overwrite). */
  ctrlHeld: boolean
  installing: boolean
  onOpen: (e: React.MouseEvent) => void
  onInstall: (e: React.MouseEvent) => void
  onRemove: () => void
}) {
  const fileName = uprojectPath.split(/[\\/]/).pop() ?? uprojectPath
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  const dir = displayPath(uprojectPath).replace(/[\\/][^\\/]*$/, '')
  return (
    <div className="group/card relative">
      <div className="flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:border-foreground/40">
        <button
          type="button"
          onClick={onOpen}
          title="Open in Unreal Engine"
          className="flex min-w-0 items-center gap-3 text-left"
        >
          <img src={unrealLogo} alt="" aria-hidden className="size-9 shrink-0 object-contain" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{displayName}</span>
            <span className="block max-w-72 truncate text-xs text-muted-foreground">{dir}</span>
          </span>
          <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={onInstall}
          disabled={installing || dthPresent === undefined}
          aria-label={`Install DTH content into ${displayName}`}
          title="Install DTH Content"
          className={cn(
            'shrink-0 rounded-md border p-1.5 transition-colors',
            // Installed → dimmed; holding Ctrl/Cmd wakes it up as the hint
            // that a click now re-installs (overwrite from the active release).
            dthPresent && !ctrlHeld
              ? 'text-muted-foreground/50'
              : 'text-primary hover:bg-accent hover:text-primary',
            installing && 'animate-pulse',
          )}
        >
          <HardDriveDownload className="size-4" />
        </button>
      </div>
      <button
        type="button"
        title="Unlink from project (the file is kept)"
        aria-label={`Unlink ${displayName}`}
        className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full border bg-card text-muted-foreground group-hover/card:flex hover:text-destructive"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/**
 * The project's linked Unreal projects (`.uproject`) as a footer bar docked to
 * the bottom of the viewport — always visible while browsing the project.
 * Links only: files stay in place, unlinking never deletes. Add via the picker
 * or by dropping a `.uproject` onto the bar. Pages rendering it need bottom
 * padding so content can scroll clear of the bar.
 */
export function UnrealProjectsBar({
  project,
  onChanged,
}: {
  project: ProjectInfo
  onChanged: (project: ProjectInfo) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  // Per-project `Content/DazToHue` presence (undefined = probe in flight) and
  // which card's install is currently running.
  const [dthStatus, setDthStatus] = useState<Record<string, boolean | undefined>>({})
  const [installingPath, setInstallingPath] = useState('')
  // Ctrl/Cmd held → installed cards' dimmed install buttons light up (re-install).
  const [ctrlHeld, setCtrlHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') setCtrlHeld(false)
    }
    const clear = () => setCtrlHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  useEffect(() => {
    let active = true
    for (const path of project.unrealProjects) {
      void unrealDthContentPresent({ data: { uprojectPath: path } }).then((present) => {
        if (active) setDthStatus((s) => ({ ...s, [path]: present }))
      })
    }
    return () => {
      active = false
    }
  }, [project.unrealProjects])

  async function installDth(path: string, e: React.MouseEvent) {
    const present = dthStatus[path]
    // Present → the button is a no-op unless Ctrl/Cmd is held (explicit overwrite).
    if (present && !(e.ctrlKey || e.metaKey)) {
      toast.info('DTH content is already installed — Ctrl+click to overwrite it.')
      return
    }
    setInstallingPath(path)
    try {
      const files = await installUnrealDthContent({
        data: { uprojectPath: path, overwrite: !!present },
      })
      toast.success(
        `${present ? 'Overwrote' : 'Installed'} DTH Unreal content — ${files} file(s)`,
      )
      setDthStatus((s) => ({ ...s, [path]: true }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setInstallingPath('')
    }
  }

  async function save(paths: Array<string>, okMessage: string) {
    setBusy(true)
    try {
      const saved = await setUnrealProjects({ data: { projectId: project.path, paths } })
      onChanged(saved)
      void router.invalidate()
      toast.success(okMessage)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function add(paths: Array<string>) {
    const fresh = paths.filter((p) => !project.unrealProjects.includes(p))
    if (!fresh.length) {
      toast.info('That Unreal project is already linked.')
      return
    }
    void save([...project.unrealProjects, ...fresh], 'Linked Unreal project')
  }

  async function onPick() {
    const picked = await pickUprojectPath('Select the Unreal project (.uproject)')
    if (picked) add([picked])
  }

  return (
    <FileDropZone
      accept={['uproject']}
      onDrop={add}
      label="Drop an Unreal project (.uproject) to link"
      className="fixed inset-x-0 bottom-0 z-20"
    >
      <div className="flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-2 backdrop-blur">
        <span className="mr-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Unreal projects
        </span>
        {project.unrealProjects.map((path) => (
          <UnrealCard
            key={path}
            uprojectPath={path}
            dthPresent={dthStatus[path]}
            ctrlHeld={ctrlHeld}
            installing={installingPath === path}
            onOpen={(e) => {
              // Shift+click = the app-wide "show in Explorer" hotkey (same as
              // path chips); plain click opens the project in Unreal. Failures
              // surface as toasts — a scope/association problem otherwise looks
              // like a dead button (exactly how the .uproject scope bug hid).
              const action = e.shiftKey
                ? revealPath({ data: { path } })
                : openScene({ data: { scenePath: path } })
              void action.catch((err: unknown) =>
                toast.error(err instanceof Error ? err.message : String(err)),
              )
            }}
            onInstall={(e) => void installDth(path, e)}
            onRemove={() =>
              void save(
                project.unrealProjects.filter((p) => p !== path),
                'Unlinked Unreal project',
              )
            }
          />
        ))}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void onPick()}>
          <Plus />
          {busy ? 'Linking…' : project.unrealProjects.length ? 'Add' : 'Link Unreal project'}
        </Button>
      </div>
    </FileDropZone>
  )
}
