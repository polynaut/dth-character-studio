import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ExternalLink, Plus, X } from 'lucide-react'
import { toast } from 'sonner'

import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { Button } from '#/components/ui/button.tsx'
import unrealLogo from '#/assets/unreal-logo.svg'
import { openScene, setUnrealProjects } from '#/lib/rom/api.ts'
import { pickUprojectPath } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'

import type { ProjectInfo } from '#/lib/rom/api.ts'

/** A linked Unreal project as a compact footer chip: the U mark + name — the
 *  chip opens the `.uproject` (OS file association → Unreal), the folder shows
 *  as its tooltip, a hover ✕ only unlinks (files are never touched). */
function UnrealChip({
  uprojectPath,
  onOpen,
  onRemove,
}: {
  uprojectPath: string
  onOpen: () => void
  onRemove: () => void
}) {
  const fileName = uprojectPath.split(/[\\/]/).pop() ?? uprojectPath
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  return (
    <div className="group/card relative">
      <button
        type="button"
        onClick={onOpen}
        title={`Open in Unreal Engine — ${displayPath(uprojectPath)}`}
        className="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:border-foreground/40"
      >
        <img src={unrealLogo} alt="" aria-hidden className="size-5 shrink-0 object-contain" />
        <span className="max-w-56 truncate font-medium">{displayName}</span>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
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
          <UnrealChip
            key={path}
            uprojectPath={path}
            onOpen={() =>
              // Surface failures — a scope/association problem otherwise looks
              // like a dead button (exactly how the .uproject scope bug hid).
              void openScene({ data: { scenePath: path } }).catch((e: unknown) =>
                toast.error(e instanceof Error ? e.message : String(e)),
              )
            }
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
