import { exists, readTextFile, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  NEW_SCENES_DISMISSED_FILE,
  dismissedJson,
  emptyDismissed,
  isGeneratedScene,
  offerableScenes,
  parseDismissed,
  pruneDismissed,
  withDismissed,
} from '../new-scenes.ts'
import type { FoundScene } from '../new-scenes.ts'
import { charactersLinkedScenes } from '#/lib/scene-compat.ts'
import { characterScenesRoot } from './execute'
import { charsRoot, joinPath, resolveProject } from './core'

/**
 * "You saved a new scene — want it?"
 *
 * The studio looks for loose `.duf` files under the project's character folders
 * whenever its window regains focus, so a Save As out of Daz is noticed instead
 * of having to be remembered. The rules live in `../new-scenes.ts` (pure); this
 * module does the reads.
 *
 * Deliberately cheap, because it runs on every focus: one library scan (already
 * the routes' own bread and butter, and location-cached), then one native
 * `scan_duf_files` per character folder — a recursive Rust walk, not a JS
 * readDir tree. Everything is best-effort: an unreadable character, a folder on
 * a disconnected share, a missing scenes root — each drops out of the answer
 * rather than failing the sweep. The worst outcome of a failure here is that
 * the studio does not offer something, which is exactly where it started.
 */

const projectInput = z.object({ projectId: z.string().min(1) })

const dismissInput = z.object({
  projectId: z.string().min(1),
  scenes: z.array(z.object({ path: z.string().min(1), mtimeMs: z.number() })).min(1),
})

/** Where the declined record lives: with the project's other app data, not in
 *  the user's own tree (it is a UI preference, not something to back up). */
function dismissedPath(projectDir: string): string {
  return joinPath(storage.dcsmetaDir(projectDir), NEW_SCENES_DISMISSED_FILE)
}

async function readDismissed(projectDir: string) {
  try {
    const path = dismissedPath(projectDir)
    if (await exists(path)) return parseDismissed(await readTextFile(path))
  } catch {
    // unreadable — an empty record costs one extra offer, nothing worse
  }
  return emptyDismissed()
}

/** Every `.duf` under one character's scenes root, with its mtime. */
async function scenesUnder(
  root: string,
  characterId: string,
  characterName: string,
): Promise<Array<FoundScene>> {
  let rel: Array<string> = []
  try {
    rel = z.array(z.string()).parse(await invoke('scan_duf_files', { folder: root }))
  } catch {
    return [] // folder gone, share offline, permissions — not this feature's business
  }
  // Concurrent: these are independent single-file stats in a tree the native
  // walk has just read, so there is nothing to serialize them for (unlike the
  // per-character walks in the caller, which are deliberately one at a time).
  const stats = await Promise.all(
    rel
      // The studio's own generated ROM animations sit in exactly this tree.
      .filter((relPath) => !isGeneratedScene(relPath))
      .map(async (relPath): Promise<FoundScene | null> => {
        const path = joinPath(root, relPath)
        try {
          const info = await stat(path)
          return {
            path,
            characterId,
            characterName,
            mtimeMs: info.mtime?.getTime() ?? info.birthtime?.getTime() ?? 0,
          }
        } catch {
          return null // vanished between the walk and the stat
        }
      }),
  )
  return stats.filter((found): found is FoundScene => found !== null)
}

/**
 * Loose scenes in this project that no character links and the user has not
 * declined at this version.
 *
 * Returns `[]` outside the desktop app (nothing to read) and on any failure —
 * this is an offer, and an offer that cannot be made is simply not made.
 */
export async function fetchNewScenes({ data }: { data: unknown }): Promise<Array<FoundScene>> {
  const { projectId } = projectInput.parse(data)
  if (!isTauri()) return []
  try {
    const project = await resolveProject(projectId)
    const scan = await storage.scanCharacterLibrary(charsRoot(project))
    const found: Array<FoundScene> = []
    // Sequential on purpose: a character folder on a network share is the
    // common case, and firing N recursive native walks at one at once is how a
    // focus handler turns into a stall the user feels.
    for (const { character, location } of scan.entries) {
      const root = characterScenesRoot(character, location, project.dazSubdir)
      if (!root) continue // no primary, or it lives outside the character folder
      found.push(...(await scenesUnder(root, character.id, character.name)))
    }
    return offerableScenes({
      found,
      linked: charactersLinkedScenes(scan.entries.map((e) => e.character)).map((o) => o.path),
      dismissed: await readDismissed(project.path),
    })
  } catch {
    return []
  }
}

/**
 * Record scenes as declined at the mtime they carry now.
 *
 * Pruned against what is still loose in the same write, so the record can only
 * ever describe scenes that exist and are still unlinked — a declined scene
 * that is later added, deleted or renamed drops out on the next dismissal.
 */
export async function dismissNewScenes({ data }: { data: unknown }): Promise<void> {
  const { projectId, scenes } = dismissInput.parse(data)
  if (!isTauri()) return
  try {
    const project = await resolveProject(projectId)
    const path = dismissedPath(project.path)
    const stillLoose = (await fetchNewScenes({ data: { projectId } })).map((s) => s.path)
    const next = pruneDismissed(withDismissed(await readDismissed(project.path), scenes), [
      ...stillLoose,
      ...scenes.map((s) => s.path),
    ])
    await storage.writeTextFileAtomic(path, dismissedJson(next))
  } catch {
    // A record that will not write means the offer comes back next focus —
    // annoying, never destructive, and not worth failing a dialog over.
  }
}
