import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  DETECTED_IGNORE_FILE,
  detectNewFiles,
  detectSkipDir,
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

export async function fetchDetectedFiles({ data }: { data: unknown }): Promise<DetectedFilesResult> {
  const { projectId, id, linkedScenes, linkedHoudini } = detectInput.parse(data)
  if (!isTauri()) return EMPTY
  const project = await resolveProject(projectId)
  const location = await locateCharacter(charsRoot(project), id)
  if (!location) return EMPTY
  const [relFiles, ignored] = await Promise.all([
    storage.walkFiles(location.folderAbs, '', detectSkipDir),
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
  await writeTextFile(storePath, detectedIgnoreJson([...existing, ...fresh]))
}
