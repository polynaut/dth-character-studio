import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { FolderInput, FolderOpen, FolderPlus, Pencil } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { pathChipClass } from '#/components/path-code.tsx'
import { HeaderNav } from '#/components/header-nav.tsx'
import { BulkDeleteDialog } from '#/components/bulk-delete-dialog.tsx'
import { ProjectMoveDialog, ProjectRenameDialog } from '#/components/project-dialogs.tsx'
import {
  SelectCheckbox,
  SelectionBar,
  SortSelect,
  ViewToggle,
  formatDate,
  sortItems,
  type SortKey,
  type ViewMode,
} from '#/components/overview-controls.tsx'
import { cn } from '#/lib/utils.ts'
import {
  createProject,
  deleteProject,
  fetchProjects,
  isDirectory,
  moveProject,
  updateProject,
} from '#/lib/rom/api.ts'
import type { Project } from '#/lib/rom/api.ts'
import { useFileDrop } from '#/lib/file-drop.ts'
import { SidePanel } from '#/components/ui/side-panel.tsx'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { usePersistentState } from '#/lib/use-persistent-state.ts'
import { useSelection } from '#/lib/use-selection.ts'
import { toast } from 'sonner'

export const Route = createFileRoute('/')({
  loader: () => fetchProjects(),
  component: ProjectsPage,
})

function ProjectsPage() {
  const projects = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The create-project form lives in a slide-in side panel now.
  const [panelOpen, setPanelOpen] = useState(false)

  const [view, setView] = usePersistentState<ViewMode>('dth.projects.view', 'list')
  const [sort, setSort] = usePersistentState<SortKey>('dth.projects.sort', 'alpha')
  const sel = useSelection()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Per-card rename ("easy") + move-folder ("meaty") dialogs.
  const [renaming, setRenaming] = useState<Project | null>(null)
  const [movingProject, setMovingProject] = useState<Project | null>(null)
  const [opBusy, setOpBusy] = useState(false)
  const [opError, setOpError] = useState('')

  const sorted = sortItems(projects, sort, { name: (p) => p.name, date: (p) => p.createdAt ?? '' })
  const selectedProjects = sorted.filter((p) => sel.isSelected(p.id))

  function applyFolder(folder: string) {
    setPath(folder)
    // Suggest the project name from the folder's own name (editable).
    setName(folder.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? '')
  }

  async function onChooseFolder() {
    const picked = await pickFolder('Choose the project folder')
    if (picked) applyFolder(picked)
  }

  // Open the create panel fresh (no folder picked yet) — the "Add project" button.
  function openCreatePanel() {
    setError('')
    setName('')
    setPath('')
    setPanelOpen(true)
  }

  async function onDropFolder(paths: Array<string>) {
    const dropped = paths[0]
    if (!dropped) return
    setError('')
    // A dropped folder is used as-is; a dropped file resolves to its folder.
    applyFolder((await isDirectory(dropped)) ? dropped : dropped.replace(/[\\/][^\\/]*$/, ''))
    // Surface the panel, prefilled with the dropped folder + suggested name.
    setPanelOpen(true)
  }

  // The whole page is a folder drop target — `data-filedrop-id` goes on <main>.
  const { id: dropId, isOver: dropOver } = useFileDrop({ acceptFolders: true, onDrop: onDropFolder })

  async function onCreate() {
    if (!path || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const project = await createProject({ data: { name: name.trim(), path } })
      setName('')
      setPath('')
      setPanelOpen(false)
      await router.invalidate()
      toast.success(`Project “${project.name}” created`)
      await router.navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onRename(name: string) {
    if (!renaming) return
    setOpBusy(true)
    setOpError('')
    try {
      await updateProject({ data: { id: renaming.id, name } })
      setRenaming(null)
      await router.invalidate()
      toast.success(`Renamed to “${name}”`)
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpBusy(false)
    }
  }

  async function onMove(path: string) {
    if (!movingProject) return
    setOpBusy(true)
    setOpError('')
    try {
      const moved = await moveProject({ data: { id: movingProject.id, path } })
      setMovingProject(null)
      await router.invalidate()
      toast.success(`Moved “${moved.name}” to its new folder`)
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e))
    } finally {
      setOpBusy(false)
    }
  }

  async function onBulkDelete({ keep }: { keep: boolean }) {
    setDeleting(true)
    setDeleteError('')
    try {
      for (const project of selectedProjects) {
        await deleteProject({ data: { id: project.id, deleteFiles: !keep } })
      }
      const n = selectedProjects.length
      sel.clear()
      setConfirmOpen(false)
      await router.invalidate()
      toast.success(`Deleted ${n} project${n === 1 ? '' : 's'}`)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <main data-filedrop-id={dropId} className="relative min-h-screen p-8">
      {dropOver && (
        <div className="pointer-events-none fixed inset-4 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-base font-medium text-primary">
          Drop a folder to create a project
        </div>
      )}
      {/* Reserve the height of a project's "← All projects" nav row (text-sm +
          mb-6) so entering/leaving a project doesn't shift the layout. */}
      <div className="mb-6 h-5" aria-hidden />

      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          {/* Reserve the height of a project's path-chip subtitle (text-xs chip,
              mt-1) — kept empty here since the projects list has no path. */}
          <div className="mt-1 h-5" aria-hidden />
        </div>
        <HeaderNav />
      </header>

      {projects.length === 0 ? (
        <div className="flex flex-col items-start gap-4">
          <p className="text-muted-foreground">
            No projects yet — drop a folder anywhere, or add one.
          </p>
          <Button onClick={openCreatePanel}>
            <FolderPlus /> Add project
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              {projects.length} project{projects.length === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={openCreatePanel}>
                <FolderPlus /> Add project
              </Button>
              <SortSelect value={sort} onChange={setSort} />
              <ViewToggle value={view} onChange={setView} />
            </div>
          </div>
          <ul
            className={cn(
              view === 'grid'
                ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                : 'grid grid-cols-[max-content_max-content_1fr_max-content_max-content] gap-x-4 divide-y rounded-lg border bg-card',
            )}
          >
            {sorted.map((project) => {
              const created = formatDate(project.createdAt ?? '')
              const count = `${project.characterCount} character${project.characterCount === 1 ? '' : 's'}`
              // Rename ("easy") + move-folder ("meaty") + selection toggle, shared
              // by both views. In list view these sit above the stretched row link.
              const controls = (
                <>
                  <button
                    type="button"
                    title="Rename project"
                    onClick={() => {
                      setOpError('')
                      setRenaming(project)
                    }}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color] hover:bg-muted hover:text-foreground',
                      sel.selecting ? 'pointer-events-none' : 'group-hover:opacity-100',
                    )}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    title="Move project to another folder"
                    onClick={() => {
                      setOpError('')
                      setMovingProject(project)
                    }}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-[opacity,color] hover:bg-muted hover:text-foreground',
                      sel.selecting ? 'pointer-events-none' : 'group-hover:opacity-100',
                    )}
                  >
                    <FolderInput className="size-4" />
                  </button>
                  <SelectCheckbox
                    checked={sel.isSelected(project.id)}
                    selecting={sel.selecting}
                    onChange={() => sel.toggle(project.id)}
                  />
                </>
              )
              return view === 'grid' ? (
                <li
                  key={project.id}
                  className="group relative rounded-lg border bg-card transition-colors hover:border-primary"
                >
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    onClick={(e) => {
                      if (sel.selecting) {
                        e.preventDefault()
                        sel.toggle(project.id)
                      }
                    }}
                    className="block p-4 pr-24"
                  >
                    <div className="font-semibold">{project.name}</div>
                    <code
                      className={`${pathChipClass()} mt-1 inline-block max-w-full truncate align-middle text-xs`}
                    >
                      {displayPath(project.path)}
                    </code>
                    <div className="mt-1 text-xs text-muted-foreground">{count}</div>
                  </Link>
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1">{controls}</div>
                </li>
              ) : (
                // List view: an aligned table. Columns size to the widest name /
                // path / count across rows; a stretched link makes the whole row
                // (except the controls) navigable.
                <li
                  key={project.id}
                  className="group relative col-span-full grid grid-cols-subgrid items-center py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/40"
                >
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    aria-label={project.name}
                    onClick={(e) => {
                      if (sel.selecting) {
                        e.preventDefault()
                        sel.toggle(project.id)
                      }
                    }}
                    className="absolute inset-0 z-[1]"
                  />
                  <span className="truncate pl-4 font-medium">{project.name}</span>
                  <code
                    className={`${pathChipClass()} w-fit max-w-full justify-self-start truncate text-xs`}
                  >
                    {displayPath(project.path)}
                  </code>
                  {/* Flexible spacer pushes the count + date + controls to the right,
                      while the count stays a left-aligned column of its own. */}
                  <span aria-hidden="true" />
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{count}</span>
                  <div className="flex items-center justify-end gap-4 pr-2.5 text-xs text-muted-foreground">
                    {created && <span className="hidden sm:inline">{created}</span>}
                    <div className="relative z-10 flex items-center gap-1">{controls}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <SelectionBar
        open={sel.selecting}
        count={sel.count}
        total={sorted.length}
        noun="project"
        onSelectAll={() => sel.selectAll(sorted.map((p) => p.id))}
        onClear={sel.clear}
        onDelete={() => setConfirmOpen(true)}
        busy={deleting}
      />

      {confirmOpen && (
        <BulkDeleteDialog
          noun="project"
          names={selectedProjects.map((p) => p.name)}
          message="This permanently deletes the project folder and all character data inside it. This cannot be undone."
          keepLabel="Keep project files on disk"
          keepNote="When on, only the project entry is removed — your files are left untouched."
          busy={deleting}
          error={deleteError}
          onConfirm={onBulkDelete}
          onClose={() => setConfirmOpen(false)}
        />
      )}

      {renaming && (
        <ProjectRenameDialog
          project={renaming}
          busy={opBusy}
          error={opError}
          onSave={onRename}
          onClose={() => setRenaming(null)}
        />
      )}

      {movingProject && (
        <ProjectMoveDialog
          project={movingProject}
          busy={opBusy}
          error={opError}
          onMove={onMove}
          onClose={() => setMovingProject(null)}
        />
      )}

      <SidePanel open={panelOpen} title="Create project" onClose={() => setPanelOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose the project's folder (or drop one anywhere on the page). Each project has its own
            character library.
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
