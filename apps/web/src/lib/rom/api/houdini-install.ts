import { documentDir, homeDir } from '@tauri-apps/api/path'
import { exists, readDir } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import { EMPTY_HOUDINI_SCAN, buildHoudiniScan } from '#/lib/houdini-install.ts'
import { houdiniVersionFromDocs } from '#/lib/houdini-version.ts'
import { houdiniInstallSchema } from './native-types.ts'
import { joinPath } from './core'

import type { HoudiniInstallScan } from '#/lib/houdini-install.ts'

// Finding Houdini: the registry half is native (`houdini_install.rs`), the
// preferences folders are a directory listing, and the pairing rule lives in
// `lib/houdini-install.ts`. This module is only the I/O.

/**
 * Where a `houdini<major>.<minor>` preferences folder can live.
 *
 * BOTH, in this order, and that is measured rather than defensive: on a machine
 * whose Documents is redirected to another drive, `houdini22.0` existed under
 * `D:/User Data/Documents` AND under `%USERPROFILE%`. Houdini writes to the
 * documents folder when it can and falls back to the home directory, so a
 * detection that knew only one of them would pair half the installs with
 * nothing. Documents wins when both hold the same release.
 */
async function docsRoots(): Promise<Array<string>> {
  const resolved = await Promise.all(
    [documentDir, homeDir].map(async (resolve) => {
      try {
        return (await resolve()).replace(/\\/g, '/')
      } catch {
        // a root the OS won't name is simply one fewer place to look
        return ''
      }
    }),
  )
  // Deduped, keeping order: on a machine where Documents is NOT redirected the
  // two can resolve to the same tree, and looking twice would list every prefs
  // folder twice.
  const roots: Array<string> = []
  for (const dir of resolved) {
    if (dir !== '' && !roots.includes(dir)) roots.push(dir)
  }
  return roots
}

/** Every `houdini<major>.<minor>` folder under the roots, in root order. */
async function findDocsFolders(): Promise<Array<string>> {
  const found: Array<string> = []
  const seen = new Set<string>()
  const roots = await docsRoots()
  const listings = await Promise.all(
    roots.map(async (root) => {
      try {
        return { root, entries: await readDir(root) }
      } catch {
        return { root, entries: [] }
      }
    }),
  )
  for (const { root, entries } of listings) {
    for (const entry of entries) {
      if (!entry.isDirectory) continue
      const path = joinPath(root, entry.name)
      // Matched by the SAME rule generation pairs with, so detection can never
      // offer a folder Generate project would then refuse.
      const release = houdiniVersionFromDocs(path)
      if (release === '' || seen.has(release)) continue
      seen.add(release)
      found.push(path)
    }
  }
  return found
}

/**
 * Every Houdini install on this machine, paired with its preferences folder.
 *
 * Best-effort: no Houdini, no registry key, or a non-Windows build all come
 * back empty, which the Settings UI shows as "nothing detected — set the
 * folders yourself". A missing Houdini is not an error; this app's Daz half
 * works without it.
 */
export async function detectHoudiniInstalls(): Promise<HoudiniInstallScan> {
  if (!isTauri()) return EMPTY_HOUDINI_SCAN
  let installs
  try {
    // Never a bare invoke<T>() cast — the list crosses the registry → serde →
    // here, pinned by contracts/houdini-installs.json on both sides.
    installs = z.array(houdiniInstallSchema).parse(await invoke('houdini_installs'))
  } catch {
    return EMPTY_HOUDINI_SCAN
  }
  const docs = await findDocsFolders()
  // The registry is what Houdini BELIEVES; the folder is what is there. An
  // uninstall SideFX didn't tidy would otherwise activate paths resolving to
  // nothing.
  const existing = new Set<string>()
  await Promise.all(
    installs.map(async (install) => {
      try {
        if (await exists(install.path)) existing.add(install.path)
      } catch {
        // unreadable — treated as absent, and the card says so
      }
    }),
  )
  return buildHoudiniScan(installs, docs, existing)
}
