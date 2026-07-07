import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { pathChipClass } from '#/components/path-code.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Label } from '#/components/ui/label.tsx'
import unrealLogo from '#/assets/unreal-logo.svg'
import { openScene, setUnrealProjects } from '#/lib/rom/api.ts'
import { pickUprojectPath } from '#/lib/desktop.ts'
import { displayPath, pathSeparator } from '#/lib/path.ts'

import type { ProjectInfo } from '#/lib/rom/api.ts'

/** A linked Unreal project card: the U mark, the project name, its folder —
 *  the whole card opens the `.uproject` (OS file association → Unreal). Linked
 *  in place, never copied; a hover ✕ only unlinks. */
function UnrealCard({
  uprojectPath,
  projectDirAbs,
  onOpen,
  onRemove,
}: {
  uprojectPath: string
  /** The studio project's folder; a `.uproject` inside it shows "%PROJECT%"
   *  in place of that prefix (mirrors the character cards' "%CHAR%"). */
  projectDirAbs: string
  onOpen: () => void
  onRemove: () => void
}) {
  const fileName = uprojectPath.split(/[\\/]/).pop() ?? uprojectPath
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const dirAbs = norm(uprojectPath).replace(/\/[^/]*$/, '')
  const base = norm(projectDirAbs)
  const inProject =
    !!base &&
    (dirAbs.toLowerCase() === base.toLowerCase() ||
      dirAbs.toLowerCase().startsWith(base.toLowerCase() + '/'))
  const dir = inProject
    ? '%PROJECT%' + dirAbs.slice(base.length).split('/').join(pathSeparator())
    : displayPath(dirAbs)
  return (
    <div className="group/card relative w-80">
      <button
        type="button"
        onClick={onOpen}
        title="Open in Unreal Engine"
        className="group relative flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-foreground/40"
      >
        <img src={unrealLogo} alt="" aria-hidden className="size-14 shrink-0 object-contain" />
        <div className="min-w-0 text-xs">
          <div className="truncate text-sm font-medium">{displayName}</div>
          {dir && (
            <code
              className={`${pathChipClass('secondary')} mt-1 inline-block max-w-full truncate align-middle`}
            >
              {dir}
              {pathSeparator()}
            </code>
          )}
        </div>
        <ExternalLink className="absolute right-3 bottom-3 size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1.5 right-1.5 size-7 opacity-0 transition-opacity group-hover/card:opacity-100"
        title="Unlink from project (the file is kept)"
        onClick={onRemove}
      >
        <Trash2 className="size-3.5 text-destructive" />
      </Button>
    </div>
  )
}

/**
 * The project's linked Unreal projects (`.uproject`), shown prominently on the
 * project page like the character pages' Daz scenes / Houdini projects. Links
 * only — files stay in place, unlinking never deletes. Add via the picker or by
 * dropping a `.uproject` onto the section.
 */
export function UnrealProjectsField({
  project,
  onChanged,
}: {
  project: ProjectInfo
  onChanged: (project: ProjectInfo) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

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
      className="rounded-lg"
    >
      <Label className="mb-1 block">Unreal projects</Label>
      <div className="flex flex-wrap items-stretch gap-3">
        {project.unrealProjects.map((path) => (
          <UnrealCard
            key={path}
            uprojectPath={path}
            projectDirAbs={project.path}
            onOpen={() => void openScene({ data: { scenePath: path } })}
            onRemove={() =>
              void save(
                project.unrealProjects.filter((p) => p !== path),
                'Unlinked Unreal project',
              )
            }
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          disabled={busy}
          onClick={() => void onPick()}
        >
          <Plus /> {busy ? 'Linking…' : project.unrealProjects.length ? 'Add' : 'Link Unreal project'}
        </Button>
      </div>
    </FileDropZone>
  )
}
