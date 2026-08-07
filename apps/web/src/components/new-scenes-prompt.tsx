import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FilePlus2, Loader2 } from 'lucide-react'

import { Button, Modal, useRefetchOnFocus } from '@dth/ui'
import { dismissNewScenes, fetchNewScenes, getActiveProjectDir } from '#/lib/rom/api.ts'
import type { FoundScene } from '#/lib/rom/api.ts'
import { requestSceneAdd } from '#/lib/scene-add-request.ts'
import { displayPath, normalizePath } from '#/lib/path.ts'

/** Last path segment — the scene's file name. */
function fileName(path: string): string {
  return normalizePath(path).split('/').pop() ?? path
}

/**
 * "You saved a new scene — want it on the character?"
 *
 * Mounted once per window in the root route, so it works wherever the user
 * happens to be when they come back from Daz — the character page, the project
 * page, Settings. It no-ops in a window with no project (Home) and outside the
 * desktop app.
 *
 * It does NOT add anything itself: **Add** navigates to the owning character
 * and opens that page's real Add-scene dialog on the file (see
 * `lib/scene-add-request.ts`), so the validation, the copy-vs-link decision and
 * the "Add anyway" escape are the ones that already exist — one flow, not two
 * that can drift.
 *
 * The offer is per FILE VERSION: **Not now** records what is on screen at the
 * mtime it carries, so it stops asking — until the file changes, which is
 * exactly when a user who has just re-saved it wants to be asked again.
 */
export function NewScenesPrompt() {
  const navigate = useNavigate()
  const [scenes, setScenes] = useState<Array<FoundScene>>([])
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  /** The window's project — captured with the scan that found these scenes, so
   *  the Add navigation and the dismissal cannot drift onto another project. */
  const [projectId, setProjectId] = useState('')

  // On a focus REGAIN only — deliberately not `immediate`. The offer answers
  // "you went to Daz and came back", and a window that has only just opened is
  // nobody coming back from anywhere: firing on mount would greet every launch
  // with a list of every loose scene in the project, and could raise a modal on
  // top of a flow the user was already in the middle of.
  useRefetchOnFocus(() => {
    // Never re-open over a decision the user is in the middle of making.
    if (open || busy) return
    void (async () => {
      const dir = await getActiveProjectDir()
      if (!dir) return // Home window / browser — nothing to offer
      const found = await fetchNewScenes({ data: { projectId: dir } })
      if (found.length === 0) return
      setProjectId(dir)
      setScenes(found)
      setOpen(true)
    })()
  })

  async function dismiss() {
    setBusy(true)
    try {
      if (projectId) {
        await dismissNewScenes({
          data: { projectId, scenes: scenes.map((s) => ({ path: s.path, mtimeMs: s.mtimeMs })) },
        })
      }
    } finally {
      setBusy(false)
      setOpen(false)
      setScenes([])
    }
  }

  function add(scene: FoundScene) {
    requestSceneAdd(scene.characterId, scene.path)
    setOpen(false)
    setScenes([])
    void navigate({
      to: '/projects/$projectId/characters/$characterId',
      params: { projectId, characterId: scene.characterId },
    })
  }

  if (!open || scenes.length === 0) return null

  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      dismissible={!busy}
      title={scenes.length === 1 ? 'A new Daz scene is sitting there' : 'New Daz scenes are sitting there'}
    >
      <div className="space-y-2 text-sm">
        <p>
          {scenes.length === 1 ? 'This scene is' : `These ${scenes.length} scenes are`} in a
          character&apos;s folder but not linked to anything. Add{' '}
          {scenes.length === 1 ? 'it' : 'one'} and the usual checks run first.
        </p>
        <ul className="max-h-56 space-y-1.5 overflow-y-auto">
          {scenes.map((scene) => (
            <li
              key={scene.path}
              className="flex items-center justify-between gap-3 rounded-md border p-2"
            >
              <div className="min-w-0">
                <p className="truncate font-medium" title={scene.path}>
                  {fileName(scene.path)}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={displayPath(scene.path)}>
                  {scene.characterName}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => add(scene)}>
                <FilePlus2 /> Add
              </Button>
            </li>
          ))}
        </ul>
      </div>

      {/* What "Not now" actually promises — a dismissal the user cannot see the
          rules of is one they stop trusting. */}
      <p className="rounded-md border p-3 text-xs text-muted-foreground">
        <strong>Not now</strong> stops asking about{' '}
        {scenes.length === 1 ? 'this file' : 'these files'} — until you save over{' '}
        {scenes.length === 1 ? 'it' : 'one'} in Daz, which brings the offer back.
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Later
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void dismiss()}>
          {busy ? <Loader2 className="animate-spin" /> : null} Not now
        </Button>
      </div>
    </Modal>
  )
}
