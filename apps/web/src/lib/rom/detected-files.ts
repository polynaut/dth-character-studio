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

/** Directory names whose subtrees never hold offerable files. `daz-export` and
 *  `rom-animations` are generated Daz output, `.dcsmeta` is app-owned, `backup`
 *  is Houdini's auto-backup. One shared set: a `.duf` can't legitimately live in
 *  a Houdini backup either, so over-pruning is fine. Also the `skipDir` for the
 *  walk that feeds {@link detectNewFiles} — pruning at walk time saves the IPC. */
export function detectSkipDir(name: string): boolean {
  const dir = name.toLowerCase()
  return DETECT_SKIP_DIRS.includes(dir)
}

/** The same list the NATIVE walk is given (`scan_files_by_ext`), which prunes
 *  before descending — reading a character's whole export tree only to discard
 *  it is the expensive half of a sweep, and the sweep runs on every focus.
 *
 *  `dth-exports` is the pre-v0.69 name of the export root and stays on the list:
 *  a character is only migrated off it by its next SAVE, and until then that
 *  tree is exactly as full of generated `.duf`s as the new one. */
export const DETECT_SKIP_DIRS = [
  '.dcsmeta',
  'daz-export',
  'dth-exports',
  'rom-animations',
  'backup',
]

/** The extensions worth walking for, without the dot — what the native scan is
 *  asked for. `.duf` scenes and every Houdini scene flavour. */
export const DETECT_EXTS = ['duf', 'hip', 'hipnc', 'hiplc']

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

/**
 * Split one whole-project file list among the characters that own the folders.
 *
 * The project-wide sweep walks the characters ROOT once (one native call rather
 * than one per character), so every hit arrives root-relative and has to be
 * handed back to a character before {@link detectNewFiles} can judge it.
 *
 * **Longest folder wins.** Character folders can nest — `charactersSubdir` is a
 * plain root, and nothing stops `Kira/Variants/Kira Young/`. Matching shortest-
 * first would let the outer character claim the inner one's scenes and offer
 * them on the wrong page. A file under no character folder belongs to nobody
 * and is dropped: the root can hold anything, and "somewhere in the project" is
 * not something the wizard could link.
 *
 * Returns each owner's files as CHARACTER-folder-relative paths, in the order
 * the owners were given.
 */
export function attributeToOwners(
  relFiles: Array<string>,
  owners: Array<{ id: string; relFolder: string }>,
): Map<string, Array<string>> {
  const ranked = owners
    .map((owner) => ({ owner, prefix: `${normalizePathLower(owner.relFolder)}/` }))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  const byOwner = new Map<string, Array<string>>()
  for (const rel of relFiles) {
    const lower = normalizePathLower(rel)
    const hit = ranked.find((r) => r.prefix !== '/' && lower.startsWith(r.prefix))
    if (!hit) continue
    const list = byOwner.get(hit.owner.id)
    // Sliced by the matched prefix's LENGTH, not by the raw relFolder: the
    // stored spelling can differ in case or separator from the walk's.
    const relToChar = rel.slice(hit.prefix.length)
    if (list) list.push(relToChar)
    else byOwner.set(hit.owner.id, [relToChar])
  }
  return byOwner
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
