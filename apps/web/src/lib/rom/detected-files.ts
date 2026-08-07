import { normalizePathLower } from '#/lib/path.ts'

/**
 * The candidate rule behind the character page's "new files found" banner: which
 * files in the character folder should be OFFERED for linking. Pure subtraction —
 * everything on disk, minus the app's generated trees, minus what the character
 * (or the caller's live draft) already links, minus what the user permanently
 * skipped in the wizard. Stateless on purpose: re-running it on every window
 * focus is idempotent, which is what lets the wizard update live while open.
 *
 * All compares are case-insensitive on '/'-normalized paths — Windows.
 */

/** The per-character skip list's filename (in `.dcsmeta/characters/<folder>/`). */
export const DETECTED_IGNORE_FILE = 'detected-ignore.json'

/** Character-folder-RELATIVE '/'-paths, each list sorted. */
export interface DetectedFiles {
  scenes: Array<string>
  houdini: Array<string>
}

const HIP_EXT = /\.(hip|hipnc|hiplc)$/i

/** Directory names whose subtrees never hold offerable files. `dth-exports` and
 *  `rom-animations` are generated Daz output, `.dcsmeta` is app-owned, `backup`
 *  is Houdini's auto-backup. One shared set: a `.duf` can't legitimately live in
 *  a Houdini backup either, so over-pruning is fine. Also the `skipDir` for the
 *  walk that feeds {@link detectNewFiles} — pruning at walk time saves the IPC. */
export function detectSkipDir(name: string): boolean {
  const dir = name.toLowerCase()
  return dir === '.dcsmeta' || dir === 'dth-exports' || dir === 'rom-animations' || dir === 'backup'
}

export function detectNewFiles({
  relFiles,
  charFolder,
  linkedScenes,
  linkedHoudini,
  ignored,
}: {
  /** Everything in the character folder: folder-relative '/'-paths (walkFiles). */
  relFiles: Array<string>
  /** The character folder, absolute — resolves `relFiles` against the linked lists. */
  charFolder: string
  /** Absolute paths the character already links (any separator/case spelling). */
  linkedScenes: Array<string>
  linkedHoudini: Array<string>
  /** Folder-relative paths the user permanently skipped. */
  ignored: Array<string>
}): DetectedFiles {
  const root = normalizePathLower(charFolder)
  const linked = new Set([...linkedScenes, ...linkedHoudini].filter(Boolean).map(normalizePathLower))
  const skipped = new Set(ignored.map((p) => normalizePathLower(p)))
  const scenes: Array<string> = []
  const houdini: Array<string> = []
  for (const rel of relFiles) {
    const lower = normalizePathLower(rel)
    if (lower.split('/').slice(0, -1).some(detectSkipDir)) continue
    if (skipped.has(lower) || linked.has(`${root}/${lower}`)) continue
    if (lower.endsWith('.duf')) {
      if (lower.endsWith('_rom.duf')) continue // generated ROM animations
      scenes.push(rel)
    } else if (HIP_EXT.test(lower)) houdini.push(rel)
  }
  scenes.sort()
  houdini.sort()
  return { scenes, houdini }
}

/** The skip list read tolerantly: missing/garbled file or entries = just fewer
 *  ignores — worst case a skipped file is offered once more, never a crash. */
export function parseDetectedIgnore(text: string): Array<string> {
  try {
    const parsed: unknown = JSON.parse(text)
    const ignored = (parsed as { ignored?: unknown }).ignored
    if (!Array.isArray(ignored)) return []
    return ignored.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

/** Pretty JSON + trailing newline — the shape every other studio-written JSON has. */
export function detectedIgnoreJson(paths: Array<string>): string {
  return `${JSON.stringify({ ignored: paths }, null, 2)}\n`
}
