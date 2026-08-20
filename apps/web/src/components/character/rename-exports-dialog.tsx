import { AlertTriangle, FolderOpen, Trash2 } from 'lucide-react'

import { Button, Modal } from '@dth/ui'
import { formatBytes } from '#/lib/rom/rename-exports.ts'

import type { CharacterRenameImpact } from '#/lib/rom/api.ts'

/** `houdini/daz-export` rather than the full absolute path — the character
 *  folder is the one part of it the user is already looking at. */
function relativeToFolder(path: string, folderAbs: string): string {
  const clean = path.replace(/\\/g, '/')
  const root = folderAbs.replace(/\\/g, '/').replace(/\/+$/, '')
  return root && clean.toLowerCase().startsWith(`${root.toLowerCase()}/`)
    ? clean.slice(root.length + 1)
    : clean
}

const KIND_LABEL = {
  daz: 'Daz exports',
  final: 'Houdini exports',
} as const

const KIND_HINT = {
  daz: 'The Daz→Houdini intermediate — the .dth/.fbx/.abc set your DazToHue networks import.',
  final: 'The final export folder — what Houdini generates for Unreal.',
} as const

/**
 * The rename's one warning: a character's exports are named after it, so
 * renaming makes the ones on disk unreachable — and they are DELETED rather
 * than renamed, because their content names the old character too (a `.dth`
 * carries `"Character Name"` and absolute paths to its own siblings).
 *
 * Shown only when there is something to lose (`impact.wipes`); a character with
 * no exports yet renames straight away. Everything the rename will remove is
 * itemized with its size, because "all export files" is an abstraction and
 * "1.2 GB" is a decision.
 */
export function RenameExportsDialog({
  fromName,
  toName,
  impact,
  onConfirm,
  onClose,
}: {
  fromName: string
  toName: string
  impact: CharacterRenameImpact
  onConfirm: () => void
  onClose: () => void
}) {
  const wiping = impact.targets.filter((target) => target.files > 0)
  const total = wiping.reduce((sum, target) => sum + target.bytes, 0)
  // Never a "busy" state, deliberately. Nothing here is awaited while the
  // dialog is up — the caller resolves its promise on the click and unmounts
  // this — so a busy flag could only ever come from an UNRELATED save already
  // in flight, and disabling on that took Escape, the backdrop AND Cancel away
  // for the length of a save+generate. Double-clicking the confirm is already
  // free: settling a settled promise is a no-op.
  return (
    <Modal open onClose={onClose} title={`Rename “${fromName}” to “${toName}”?`}>
      <p className="text-sm text-muted-foreground">
        Every file the pipeline exports is named after the character — and names it inside, too: a{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">.dth</code> carries the figure’s name
        and absolute paths to its own siblings. Renaming them would leave the import calling{' '}
        <strong className="font-medium text-foreground">{toName}</strong> by the old name, so the
        exports below are <strong className="font-medium text-foreground">deleted</strong> instead.
        You’ll need to run DTH Export again.
      </p>
      <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <Trash2 className="size-4 shrink-0" />
          Deleted — {formatBytes(total)} in {wiping.length === 1 ? '1 folder' : `${wiping.length} folders`}
        </div>
        {wiping.map((target) => (
          <div key={target.path}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>
                {KIND_LABEL[target.kind]}{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {relativeToFolder(target.path, impact.folderAbs)}
                </code>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {target.files === 1 ? '1 file' : `${target.files} files`} · {formatBytes(target.bytes)}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{KIND_HINT[target.kind]}</p>
          </div>
        ))}
      </div>
      {impact.houdiniProjects.length > 0 && (
        <div className="space-y-2 rounded-md border bg-card p-3">
          {/* Headed by what will ACTUALLY happen. Saying "is repointed" above a
              note explaining that it can't be is the half a user reads. */}
          <div className="flex items-center gap-2 text-sm font-medium">
            <FolderOpen className="size-4 shrink-0" />
            {impact.houdiniProjects.length === 1
              ? `1 Houdini project ${impact.houdiniBlocked ? 'imports the old exports' : 'is repointed'}`
              : `${impact.houdiniProjects.length} Houdini projects ${
                  impact.houdiniBlocked ? 'import the old exports' : 'are repointed'
                }`}
          </div>
          {!impact.houdiniBlocked && (
            <p className="text-xs text-muted-foreground">
              Their DazToHue import paths and character name are rewritten to “{toName}”, so the
              next export lands where they are already looking. Each project is backed up first.
            </p>
          )}
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {impact.houdiniProjects.map((hip) => (
              <li key={hip}>
                <code className="rounded bg-muted px-1 py-0.5">{hip.split(/[\\/]/).pop()}</code>
              </li>
            ))}
          </ul>
          {impact.houdiniBlocked && (
            <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
              <span>
                <strong className="font-medium">They can’t be repointed right now:</strong>{' '}
                {impact.houdiniBlocked} You can still rename — the projects will keep importing the
                old export set until you repoint them by hand.
              </span>
            </p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Your Daz scenes, saved ROM animations and Houdini project files are left alone — only the
        exported files go.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          Delete exports and rename
        </Button>
      </div>
    </Modal>
  )
}
