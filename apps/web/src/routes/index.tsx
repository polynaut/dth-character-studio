import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { FolderOpen, FolderPlus, Trash2 } from 'lucide-react'

import { Button, Input, SidePanel } from '@dth/ui'
import { pathChipClass } from '#/components/path-code.tsx'
import { HeaderNav } from '#/components/header-nav.tsx'
import { formatDate } from '#/components/overview-controls.tsx'
import { createProject, fetchRecents, forgetRecent, isDirectory, openProject } from '#/lib/rom/api.ts'
import { useFileDrop } from '#/lib/file-drop.ts'
import { onMenu, pickDcspPath, pickFolder } from '#/lib/desktop.ts'
import { dirOf, displayPath } from '#/lib/path.ts'
import { toast } from 'sonner'

export const Route = createFileRoute('/')({
  // `?new=1` — a freshly created Home window (native menu "New Project") starts
  // with the create-project panel open (an event would race the webview's
  // listener registration; the URL can't).
  validateSearch: (search: Record<string, unknown>): { new?: boolean } =>
    search.new ? { new: true } : {},
  loader: () => fetchRecents(),
  component: HomePage,
})

/** Suggested project name from a chosen folder (its own name). */
function folderName(folder: string): string {
  return folder.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? ''
}

/**
 * The Home (launcher) screen. With no `.dcsp` opened the app lands here: a list of
 * recently opened projects (open / forget), plus Create and Open actions — each
 * opens the project in its own window. There is no all-projects registry anymore:
 * projects are `.dcsp` files the user scatters on disk; this only remembers the
 * recent ones. (Assets are per-project now — there's no global asset library.)
 */
function HomePage() {
  const recents = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)

  function applyFolder(folder: string) {
    setPath(folder)
    setName((n) => n || folderName(folder))
  }

  function openCreatePanel() {
    setError('')
    setName('')
    setPath('')
    setPanelOpen(true)
  }

  // Native menu "New Project" → open the create panel. Two arrival paths: the
  // `?new=1` search param (this window was just created on it) and the
  // `menu-new-project` event (this window was already running and got focused).
  const { new: startNew } = Route.useSearch()
  useEffect(() => {
    if (!startNew) return
    openCreatePanel()
    // One-shot: strip the param so a reload/back doesn't re-open the panel.
    void router.navigate({ to: '/', search: {}, replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startNew])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onMenu('menu-new-project', () => openCreatePanel()), [])

  async function onChooseFolder() {
    const picked = await pickFolder('Choose the project folder')
    if (picked) applyFolder(picked)
  }

  async function onCreate() {
    // Guard `busy`: the button is disabled while creating but the Enter-key
    // handler isn't, so a fast double-Enter could race two project creates.
    if (busy || !path || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      await createProject({ data: { name: name.trim(), path } })
      setPanelOpen(false)
      setName('')
      setPath('')
      await router.invalidate()
      toast.success(`Project “${name.trim()}” created`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onOpenExisting() {
    const picked = await pickDcspPath('Open a DTH Character Studio project (.dcsp)')
    if (picked) await onOpen(picked)
  }

  async function onOpen(dcsp: string) {
    try {
      await openProject({ data: { path: dcsp } })
      await router.invalidate()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function onForget(dcsp: string) {
    await forgetRecent({ data: { path: dcsp } })
    await router.invalidate()
  }

  // Drop a `.dcsp` to open it; drop a folder to start a project there.
  async function onDrop(paths: Array<string>) {
    const dropped = paths[0]
    if (!dropped) return
    if (/\.dcsp$/i.test(dropped)) {
      await onOpen(dropped)
      return
    }
    // Only an actual FOLDER can seed a new project — any other dropped file
    // (a .duf, a zip…) must not open the create panel with a file as its path.
    if (!(await isDirectory(dropped))) {
      toast.error('Drop a .dcsp project file to open it, or a folder to start a new project.')
      return
    }
    setError('')
    applyFolder(dropped)
    setPanelOpen(true)
  }

  const { id: dropId, isOver: dropOver } = useFileDrop({ acceptFolders: true, onDrop })

  return (
    <main data-filedrop-id={dropId} className="relative min-h-screen p-8">
      {dropOver && (
        <div className="pointer-events-none fixed inset-4 z-[60] flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-base font-medium text-primary">
          Drop a project (.dcsp) to open it, or a folder to start a new project
        </div>
      )}
      <div className="mb-6 h-5" aria-hidden />

      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold">
            <img src="/logo192.png" alt="" width={36} height={36} className="shrink-0" />
            DTH Character Studio
          </h1>
          <div className="mt-1 h-5" aria-hidden />
        </div>
        <HeaderNav />
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={openCreatePanel}>
          <FolderPlus /> New project
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenExisting}>
          <FolderOpen /> Open project…
        </Button>
        <span className="text-sm text-muted-foreground">
          {recents.length === 0
            ? 'no recent projects'
            : `${recents.length} recent project${recents.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {recents.length === 0 ? (
        <p className="text-muted-foreground">
          No recent projects — create one or open an existing <code>.dcsp</code> file.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {recents.map((recent) => (
            <li
              key={recent.path}
              className="group relative rounded-lg border bg-card transition-colors hover:border-primary"
            >
              <button
                type="button"
                onClick={() => void onOpen(recent.path)}
                className="block w-full p-4 pr-12 text-left"
              >
                <div className="truncate font-semibold">{recent.name}</div>
                <code
                  className={`${pathChipClass()} mt-1 inline-block max-w-full truncate align-middle text-xs`}
                >
                  {displayPath(dirOf(recent.path))}
                </code>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDate(recent.lastOpenedAt) || 'recently opened'}
                </div>
              </button>
              <button
                type="button"
                title="Remove from recents"
                onClick={() => void onForget(recent.path)}
                className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color] hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <SidePanel
        open={panelOpen}
        title="New project"
        onClose={() => setPanelOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose the project's folder (or drop one anywhere on the page). A{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">.dcsp</code> project file is
            created there and opened in its own window.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={onChooseFolder}
              disabled={busy}
            >
              <FolderOpen /> {path ? 'Choose another…' : 'Choose folder…'}
            </Button>
            {path && (
              <span className="truncate font-mono text-xs text-muted-foreground">
                {displayPath(path)}
              </span>
            )}
          </div>
          {path && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Project name</label>
                <Input
                  autoFocus
                  placeholder="e.g. Project Nova"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onCreate()}
                />
              </div>
              <Button onClick={onCreate} disabled={busy || !name.trim()}>
                <FolderPlus /> Create
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </SidePanel>
    </main>
  )
}
