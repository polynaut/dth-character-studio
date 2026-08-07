import { useMatchRoute, useNavigate } from '@tanstack/react-router'
import { X } from 'lucide-react'

import { Button } from '@dth/ui'
import { useProjectDetectedFiles } from '#/lib/use-project-detected-files.ts'

/**
 * "You saved something into a character's folder" — anywhere in the project
 * window.
 *
 * The character page has its own banner and wizard
 * (`character/detected-files-banner.tsx`); this is the project-wide companion
 * for when the user comes back to the studio showing something else entirely
 * (issue #740). It deliberately does NOT try to add anything: **Open** takes
 * you to the owning character, whose banner and wizard then do the work — one
 * add flow, not two that can drift.
 *
 * The character currently open is EXCLUDED, so its own banner is never
 * duplicated by this one.
 *
 * Non-modal, like its character-page sibling: alt-tabbing back from Daz must
 * not steal a click.
 */
export function ProjectDetectedFilesBanner() {
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const { found, projectId, dismissed, dismiss } = useProjectDetectedFiles()

  const onCharacter = matchRoute({
    to: '/projects/$projectId/characters/$characterId',
    fuzzy: true,
  })
  const openCharacterId = onCharacter ? onCharacter.characterId : ''

  // Whoever's page is open speaks for itself.
  const others = found.filter((c) => c.characterId !== openCharacterId)
  if (dismissed || others.length === 0) return null

  const files = others.reduce((n, c) => n + c.scenes.length + c.houdini.length, 0)
  const names = others.map((c) => c.characterName)
  const who =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names[0]} and ${names.length - 1} others`

  return (
    <div className="mx-4 mt-4 flex items-center gap-3 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
      <span aria-hidden className="text-sky-500">
        ✦
      </span>
      <span className="flex-1">
        {files} new file{files === 1 ? '' : 's'} in {who}
        {names.length === 1 ? "'s" : ''} folder{names.length === 1 ? '' : 's'}.
      </span>
      {/* One character: straight there. Several: the first, and the banner
          comes back for the rest once that one is dealt with. */}
      <Button
        size="sm"
        disabled={!projectId}
        onClick={() =>
          void navigate({
            to: '/projects/$projectId/characters/$characterId',
            params: { projectId, characterId: others[0]?.characterId ?? '' },
          })
        }
      >
        Open {others[0]?.characterName}
      </Button>
      <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={dismiss}>
        <X className="size-4" />
      </Button>
    </div>
  )
}
