import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { BulkDeleteDialog } from '#/components/bulk-delete-dialog.tsx'
import { PathCode } from '#/components/path-code.tsx'
import { Button } from '@dth/ui'
import { deleteProject, LockedFilesError } from '#/lib/rom/api.ts'
import { displayPath } from '#/lib/path.ts'

import type { ReactNode } from 'react'
import type { ProjectInfo } from '#/lib/rom/api.ts'

/**
 * The project page's Operations tab — the danger zone. One action: DELETE the
 * whole project. `deleteProject` removes the project folder, its generated
 * Daz-script folder in the Daz library, its app-data scans and its Recents
 * entries, then unpins this window — so after the navigate to `/` it simply
 * continues as a Home window.
 */
export function ProjectOperations({ project }: { project: ProjectInfo }) {
  const router = useRouter()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<ReactNode>('')

  async function onDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteProject({ data: { projectId: project.path } })
      toast.success(`Deleted project “${project.name}”`)
      // Navigation unmounts the page; the api call already unpinned the window.
      await router.navigate({ to: '/' })
    } catch (e) {
      setDeleteError(
        e instanceof LockedFilesError ? (
          <>
            Some files are open in another application (Daz Studio / Houdini) — close it and try
            again. Nothing was deleted.
            <span className="mt-1.5 block">
              {e.files.map((f) => (
                <code key={f} className="block truncate text-xs" title={displayPath(f)}>
                  {displayPath(f)}
                </code>
              ))}
            </span>
          </>
        ) : e instanceof Error ? (
          e.message
        ) : (
          String(e)
        ),
      )
      setDeleting(false)
    }
  }

  return (
    <>
      <section className="max-w-3xl space-y-4 rounded-lg border border-destructive/40 bg-card p-5">
        <div>
          <h2 className="font-semibold text-destructive">Danger zone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These actions are permanent — there is no undo.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Delete this project</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Removes the entire project folder with every character in it, the project&rsquo;s
              generated Daz-script folder in your Daz library, and its entry in Recents.
            </p>
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={deleting}>
            <Trash2 /> Delete
          </Button>
        </div>
      </section>

      {deleteOpen && (
        <BulkDeleteDialog
          noun="project"
          names={[project.name]}
          message={
            <>
              This permanently removes the project folder{' '}
              <PathCode path={displayPath(project.path)} /> with everything in it (characters,
              scenes, generated files, notes), plus the project&rsquo;s generated Daz-script folder
              and its Recents entry. This cannot be undone.
            </>
          }
          busy={deleting}
          error={deleteError}
          onConfirm={() => void onDelete()}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  )
}
