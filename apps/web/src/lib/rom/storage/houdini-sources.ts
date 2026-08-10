import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import { writeTextFileAtomic } from './fs'
import { dataPath, ensureAppDir } from './app-data'

/**
 * The Utils drawer's recently used TRANSFER SOURCES — the `.hip` files a
 * material or skeleton setup was last copied FROM.
 *
 * App-data, not the project: a source is usually a personal template that lives
 * outside any project and gets reused across characters and projects alike. That
 * is exactly the file this list exists to save re-browsing for, so scoping it to
 * one project would empty the list precisely when it is most useful.
 *
 * Deliberately NOT the compare-and-swap treatment `recents.json` gets: this is a
 * convenience list, every entry is one Browse away from coming back, and the
 * worst a lost race can do is drop a shortcut. Last write wins, and that is a
 * proportionate answer here where it was not there (losing a recents entry loses
 * a PROJECT from the Home screen).
 */

const FILE = 'houdini-sources.json'

/** How many to keep. Small on purpose: this is a shortcut row under the picker,
 *  not a history — past a handful, scanning it costs more than browsing. */
export const HOUDINI_SOURCE_RECENTS_MAX = 5

const storeSchema = z.object({
  version: z.number().default(1),
  /** Newest first. */
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        /** ISO timestamp of the last use — diagnostics, and the tooltip's
         *  raw material if the row ever wants to show it. */
        usedAt: z.string().default(''),
      }),
    )
    .default([]),
})

export type HoudiniSourceRecent = z.infer<typeof storeSchema>['files'][number]

/** Anything unreadable is an EMPTY list, never an exception: this is a
 *  convenience row, and failing loud here would break the drawer that shows it
 *  to protect nothing. */
export function parseHoudiniSources(text: string): Array<HoudiniSourceRecent> {
  try {
    return storeSchema.parse(JSON.parse(text)).files
  } catch {
    return []
  }
}

/** Windows path comparison, the same fold every other path lookup here uses. */
function key(path: string): string {
  return path.trim().replace(/\\/g, '/').toLowerCase()
}

/**
 * Put `path` at the top, drop any older spelling of the same file, and cap the
 * list. Pure, so the ordering rule is testable without a filesystem.
 */
export function withHoudiniSource(
  recents: ReadonlyArray<HoudiniSourceRecent>,
  path: string,
  usedAt: string,
): Array<HoudiniSourceRecent> {
  const trimmed = path.trim()
  if (!trimmed) return [...recents]
  const folded = key(trimmed)
  return [
    { path: trimmed, usedAt },
    ...recents.filter((entry) => key(entry.path) !== folded),
  ].slice(0, HOUDINI_SOURCE_RECENTS_MAX)
}

async function readStore(): Promise<Array<HoudiniSourceRecent>> {
  try {
    return parseHoudiniSources(await readTextFile(await dataPath(FILE)))
  } catch {
    return []
  }
}

/**
 * The list, newest first, with entries whose file is GONE dropped — a shortcut
 * that cannot open is worse than one absent, and a template being moved or
 * deleted is exactly the normal way an entry dies. The pruned list is not
 * written back: a network template on a disconnected share is missing today and
 * back tomorrow, and forgetting it on one offline open would be the one failure
 * mode the user cannot undo from here.
 */
export async function listHoudiniSources(): Promise<Array<HoudiniSourceRecent>> {
  if (!isTauri()) return []
  const recents = await readStore()
  const alive = await Promise.all(
    recents.map(async (entry) => ((await exists(entry.path).catch(() => false)) ? entry : null)),
  )
  return alive.filter((entry): entry is HoudiniSourceRecent => entry !== null)
}

/** Record a source as just used (moves it to the top). */
export async function rememberHoudiniSource(path: string, usedAt: string): Promise<void> {
  if (!isTauri() || !path.trim()) return
  const next = withHoudiniSource(await readStore(), path, usedAt)
  await ensureAppDir()
  await writeTextFileAtomic(
    await dataPath(FILE),
    `${JSON.stringify({ version: 1, files: next }, null, 2)}\n`,
  )
}
