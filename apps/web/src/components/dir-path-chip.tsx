import { PathCode } from '#/components/path-code.tsx'
import { displayPath } from '#/lib/path.ts'

/** The display-formatted directory of a file path (its last segment dropped). */
export function displayDirOf(filePath: string): string {
  const abs = displayPath(filePath)
  const lastSep = Math.max(abs.lastIndexOf('\\'), abs.lastIndexOf('/'))
  return lastSep >= 0 ? abs.slice(0, lastSep) : ''
}

/**
 * The two-tone "dim root, bright remainder" path chip used across the editor:
 * the first of `roots` that prefixes `dir` (case-insensitive — Windows paths)
 * is dimmed as a known-context label, the rest reads emphasized. With no
 * matching root the whole path shows bright. Order `roots` most-specific first
 * (e.g. the character folder before the project root). Copy/reveal behavior
 * comes from {@link PathCode}; `onEdit` adds its pencil button.
 */
export function DirPathChip({
  dir,
  roots,
  onEdit,
  className,
}: {
  /** Display-formatted directory (see {@link displayDirOf} for file paths). */
  dir: string
  /** Display-formatted candidate roots, most specific first. */
  roots: Array<string>
  onEdit?: () => void
  /** Extra classes on the chip's `<code>` (e.g. `flex h-9 items-center` to
   *  match the fixed-height chips that sit beside `h-9` buttons). */
  className?: string
}) {
  const dirLower = dir.toLowerCase()
  const rootLen =
    roots
      .map((root) => (root && dirLower.startsWith(root.toLowerCase()) ? root.length : 0))
      .find((len) => len > 0) ?? 0
  return (
    <PathCode path={dir} onEdit={onEdit} className={className}>
      {rootLen > 0 && <span className="text-muted-foreground/60">{dir.slice(0, rootLen)}</span>}
      <span className="text-foreground/80">{dir.slice(rootLen)}</span>
    </PathCode>
  )
}
