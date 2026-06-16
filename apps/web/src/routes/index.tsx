import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { FolderOpen, FolderPlus, Settings as SettingsIcon, Trash2 } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { pathChipClass } from '#/components/path-code.tsx'
import {
  createProject,
  deleteProject,
  fetchProjects,
  fetchSettings,
  saveSettings,
} from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { toast } from 'sonner'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [projects, settings] = await Promise.all([fetchProjects(), fetchSettings()])
    return { projects, settings }
  },
  component: ProjectsPage,
})

function ProjectsPage() {
  const { projects, settings } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const hasDazLibrary = Boolean(settings.dazLibraryFolder)

  async function onChooseDazLibrary() {
    const picked = await pickFolder('Select your "My DAZ 3D Library" folder')
    if (!picked) return
    setBusy(true)
    setError('')
    try {
      await saveSettings({ data: { ...settings, dazLibraryFolder: picked } })
      await router.invalidate()
      toast.success('DAZ 3D Library set')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onChooseFolder() {
    const picked = await pickFolder('Choose the project folder')
    if (!picked) return
    setPath(picked)
    // Suggest the project name from the folder's own name (editable).
    setName(picked.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? '')
  }

  async function onCreate() {
    if (!path || !name.trim()) return
    setBusy(true)
    setError('')
    try {
      const project = await createProject({ data: { name: name.trim(), path } })
      setName('')
      setPath('')
      await router.invalidate()
      toast.success(`Project “${project.name}” created`)
      await router.navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onDeleteProject(id: string, projectName: string) {
    if (
      !window.confirm(
        `Remove project "${projectName}" from the list? Your character files on disk are kept — this only removes the project entry.`,
      )
    )
      return
    await deleteProject({ data: { id } })
    await router.invalidate()
    toast.success(`Removed “${projectName}”`)
  }

  return (
    <main className="p-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="mt-1 text-muted-foreground">
            Each game project keeps its own character library. Pick a project to manage its
            characters.
          </p>
        </div>
        <Link
          to="/settings"
          className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <SettingsIcon className="size-4" /> Settings
        </Link>
      </header>

      {!hasDazLibrary ? (
        <div className="flex max-w-2xl flex-col items-start gap-3 rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold">Set your DAZ 3D Library</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Point the studio at your <strong>My DAZ 3D Library</strong> folder (your Daz content
            directory). Then you can add game projects — each with its own character library.
          </p>
          <Button onClick={onChooseDazLibrary} disabled={busy}>
            <FolderOpen /> Choose folder…
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      ) : (
        <>
          <div className="mb-8 max-w-3xl space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="text-lg font-semibold">Create project</h2>
              <p className="text-sm text-muted-foreground">
                Choose the project's folder location on disk.
              </p>
            </div>
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
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[12rem] flex-1">
                  <label className="mb-1 block text-sm font-medium">Project name</label>
                  <Input
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
          </div>
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          {projects.length === 0 ? (
            <p className="text-muted-foreground">
              No projects yet — choose a folder above to add one.
            </p>
          ) : (
            <ul className="space-y-3">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="group relative rounded-lg border bg-card transition-colors hover:border-primary"
                >
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="block p-4 pr-12"
                  >
                    <div className="font-semibold">{project.name}</div>
                    <code
                      className={`${pathChipClass()} mt-1 inline-block max-w-full truncate align-middle text-xs`}
                    >
                      {displayPath(project.path)}
                    </code>
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-3 right-3 opacity-0 transition-opacity group-hover:opacity-100"
                    title="Remove project from the list"
                    onClick={() => onDeleteProject(project.id, project.name)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  )
}
