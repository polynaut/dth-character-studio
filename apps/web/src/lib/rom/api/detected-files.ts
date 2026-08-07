import { exists, mkdir, readTextFile } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  DETECTED_IGNORE_FILE,
  DETECT_EXTS,
  DETECT_SKIP_DIRS,
  attributeToOwners,
  detectNewFiles,
  detectedIgnoreJson,
  parseDetectedIgnore,
} from '../detected-files.ts'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

// Detection of NEW files in a character's folder (the banner + add wizard):
// scenes/Houdini projects the user saved there that the character doesn't link
// yet. Stateless apart from the permanent skip list in the character's
// `.dcsmeta` folder — the caller passes its LIVE linked lists (the draft may
// hold an add the definition on disk doesn't), so a rescan on every window
// focus stays cheap and idempotent.

/** ABSOLUTE candidate paths, each list sorted. */
export interface DetectedFilesResult {
  scenes: Array<string>
  houdini: Array<string>
}

const EMPTY: DetectedFilesResult = { scenes: [], houdini: [] }

const detectInput = charScopeInput.extend({
  linkedScenes: z.array(z.string()),
  linkedHoudini: z.array(z.string()),
})

function ignorePath(projectDir: string, relFolder: string, characterId: string): string {
  return joinPath(storage.characterMetaDir(projectDir, relFolder, characterId), DETECTED_IGNORE_FILE)
}

async function readIgnored(path: string): Promise<Array<string>> {
  try {
    if (await exists(path)) return parseDetectedIgnore(await readTextFile(path))
  } catch {
    // unreadable skip list — worst case a skipped file is offered once more
  }
  return []
}

/**
 * Every candidate file under `folder`, folder-relative — ONE native walk.
 *
 * Replaces a JS `walkFiles`, which costs a `readDir` IPC per directory: fine
 * once, sluggish per character on a network share, and untenable for the
 * project-wide sweep below. The generated trees are pruned natively, before
 * they are read.
 */
async function scanCandidates(folder: string): Promise<Array<string>> {
  try {
    return z
      .array(z.string())
      .parse(
        await invoke('scan_files_by_ext', {
          folder,
          exts: DETECT_EXTS,
          skipDirs: DETECT_SKIP_DIRS,
        }),
      )
  } catch {
    return [] // folder gone, share offline, permissions — the caller keeps its last answer
  }
}

export async function fetchDetectedFiles({ data }: { data: unknown }): Promise<DetectedFilesResult> {
  const { projectId, id, linkedScenes, linkedHoudini } = detectInput.parse(data)
  if (!isTauri()) return EMPTY
  const project = await resolveProject(projectId)
  const location = await locateCharacter(charsRoot(project), id)
  if (!location) return EMPTY
  // THROW on an unreachable folder rather than answering "no files": the walk
  // below tolerates unreadable SUBfolders (returns what it can), but a vanished
  // root means the answer is unknowable — and the hook's contract is that an
  // error keeps the last answer, so a share blip must not blank the banner and
  // eat the session's dismiss.
  if (!(await exists(location.folderAbs))) {
    throw new Error(`Character folder not reachable: ${location.folderAbs}`)
  }
  const [relFiles, ignored] = await Promise.all([
    scanCandidates(location.folderAbs),
    readIgnored(ignorePath(project.path, location.relFolder, id)),
  ])
  const detected = detectNewFiles({
    relFiles,
    charFolder: location.folderAbs,
    linkedScenes,
    linkedHoudini,
    ignored,
  })
  return {
    scenes: detected.scenes.map((rel) => joinPath(location.folderAbs, rel)),
    houdini: detected.houdini.map((rel) => joinPath(location.folderAbs, rel)),
  }
}

const ignoreInput = charScopeInput.extend({ paths: z.array(z.string().min(1)).min(1) })

/** Permanently skip `paths` (absolute, inside the character folder) — the wizard's
 *  "Skip". Appends to the `.dcsmeta` skip list; a manual pick/drop still works. */
export async function ignoreDetectedFiles({ data }: { data: unknown }): Promise<void> {
  const { projectId, id, paths } = ignoreInput.parse(data)
  if (!isTauri()) return
  const project = await resolveProject(projectId)
  const location = await locateCharacter(charsRoot(project), id)
  if (!location) return
  const storePath = ignorePath(project.path, location.relFolder, id)
  const existing = await readIgnored(storePath)
  const seen = new Set(existing.map((p) => p.toLowerCase()))
  const root = location.folderAbs.replace(/\\/g, '/').toLowerCase()
  const fresh = paths
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p.toLowerCase().startsWith(`${root}/`))
    .map((p) => p.slice(root.length + 1))
    .filter((rel) => !seen.has(rel.toLowerCase()))
  if (fresh.length === 0) return
  await mkdir(storage.characterMetaDir(project.path, location.relFolder, id), { recursive: true })
  // Atomic like every other studio-written store: a crash mid-write must not
  // cost the whole skip list (tolerant parsing would read garbage as "skip
  // nothing" and re-offer every skipped file). Read-modify-write is unguarded —
  // the wizard is the only writer and its busy flag serializes the clicks.
  await storage.writeTextFileAtomic(storePath, detectedIgnoreJson([...existing, ...fresh]))
}

/** One character's share of the project-wide sweep. */
export interface ProjectDetectedCharacter {
  characterId: string
  characterName: string
  /** ABSOLUTE paths, each list sorted (same shape as {@link DetectedFilesResult}). */
  scenes: Array<string>
  houdini: Array<string>
}

const projectScopeInput = z.object({ projectId: z.string().min(1) })

/**
 * The same detection, across EVERY character in the project.
 *
 * Why it exists: the per-character scan above only runs while that character's
 * page is mounted, so a Save As out of Daz while the studio was showing the
 * project page — or Settings, or Tools — went unnoticed until the user happened
 * to open that character (issue #740).
 *
 * ONE native walk for the whole characters tree, not one per character: the
 * sweep runs on every window focus, and a walk per character folder is what
 * makes that untenable on a network share. Each hit is attributed back to its
 * owner by the LONGEST matching character folder — longest wins so a character
 * whose folder nests inside another's cannot have its files claimed by the
 * outer one.
 *
 * Files under no character folder are dropped: the characters root can hold
 * anything, and "somewhere in the project" is not something this can offer to
 * link.
 */
export async function fetchProjectDetectedFiles({
  data,
}: {
  data: unknown
}): Promise<Array<ProjectDetectedCharacter>> {
  const { projectId } = projectScopeInput.parse(data)
  if (!isTauri()) return []
  const project = await resolveProject(projectId)
  const root = charsRoot(project)
  // Same rule as the per-character scan: THROW on an unreachable root rather
  // than answering "nothing found". The hook keeps its last answer on an error,
  // so a share blip must not blank the banner — and here it would eat the
  // session's dismiss for every character at once.
  if (!(await exists(root))) {
    throw new Error(`Characters folder not reachable: ${root}`)
  }
  const [relFiles, scan] = await Promise.all([
    scanCandidates(root),
    storage.scanCharacterLibrary(root),
  ])
  if (relFiles.length === 0) return []

  // Attribution is a pure rule (longest folder wins, nested characters keep
  // their own files) — see `attributeToOwners`.
  const byOwner = attributeToOwners(
    relFiles,
    scan.entries.map(({ character, location }) => ({
      id: character.id,
      relFolder: location.relFolder,
    })),
  )
  if (byOwner.size === 0) return []
  const owners = scan.entries.filter(({ character }) => byOwner.has(character.id))

  const results = await Promise.all(
    owners
      .map(async ({ character, location }): Promise<ProjectDetectedCharacter> => {
        const detected = detectNewFiles({
          relFiles: byOwner.get(character.id) ?? [],
          charFolder: location.folderAbs,
          linkedScenes: [character.scenePath, ...character.extraScenes].filter(Boolean),
          linkedHoudini: character.houdiniProjects,
          ignored: await readIgnored(ignorePath(project.path, location.relFolder, character.id)),
        })
        return {
          characterId: character.id,
          characterName: character.name,
          scenes: detected.scenes.map((rel) => joinPath(location.folderAbs, rel)),
          houdini: detected.houdini.map((rel) => joinPath(location.folderAbs, rel)),
        }
      }),
  )
  return results.filter((r) => r.scenes.length > 0 || r.houdini.length > 0)
}
