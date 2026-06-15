import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { FolderOpen, FolderPlus, Settings as SettingsIcon, Trash2 } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import {
  createProject,
  deleteProject,
  fetchProjects,
  fetchSettings,
  saveSettings,
} from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
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

  async function onAddProject() {
    if (!name.trim()) return
    const picked = await pickFolder(`Choose the folder for "${name.trim()}"`)
    if (!picked) return
    setBusy(true)
    setError('')
    try {
      const project = await createProject({ data: { name: name.trim(), path: picked } })
      setName('')
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
          <p className="mb-6 text-xs text-muted-foreground">
            DAZ 3D Library:{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 break-all">
              {settings.dazLibraryFolder}
            </code>{' '}
            ·{' '}
            <Link to="/settings" className="underline hover:text-foreground">
              change
            </Link>
          </p>

          <div className="mb-8 flex max-w-3xl items-end gap-3 rounded-lg border bg-card p-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium">New project name</label>
              <Input
                placeholder="e.g. Project Nova"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAddProject()}
              />
            </div>
            <Button onClick={onAddProject} disabled={busy || !name.trim()}>
              <FolderPlus /> Choose folder & add
            </Button>
          </div>
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

          {projects.length === 0 ? (
            <p className="text-muted-foreground">
              No projects yet — name one above and pick its folder.
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
                    <div className="mt-0.5 text-xs break-all text-muted-foreground">
                      {project.path}
                    </div>
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
