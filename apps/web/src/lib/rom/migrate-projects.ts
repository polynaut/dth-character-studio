import { exists, mkdir, readFile, readTextFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'

import {
  DCSP_SCHEMA_VERSION,
  dataPath,
  findManifestPath,
  getSettings,
  listCharacters,
  metaImagesDir,
  rememberRecent,
  saveSettings,
  writeManifest,
  type DcspManifest,
} from './storage'
import { isExternalImage } from './image'

/**
 * One-time upgrade from the pre-`.dcsp` model (a global `projects.json` registry +
 * avatars in `app-data/images`) to self-contained project files. For each known
 * project that still exists on disk it writes a `.dcsp` manifest (seeding the
 * behaviour defaults from the old global settings), moves that project's avatars
 * into its `.dcsmeta/images`, and records it in recents. When every project has
 * been migrated it strips the moved-out settings fields and deletes the old
 * `projects.json` + `app-data/images`.
 *
 * Guarded by the presence of `projects.json`: once it's gone (migrated, or a fresh
 * install) this is a no-op. Best-effort and idempotent — an unreachable project is
 * skipped and retried on the next launch (the old files stay until everything
 * succeeds). Safe to call on every startup; it only ever runs the once.
 */
export async function migrateProjects(): Promise<void> {
  let projects: Array<{ id: string; name: string; path: string; createdAt?: string }>
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('projects.json')))
    if (!Array.isArray(raw)) return
    projects = raw.filter(
      (p): p is { id: string; name: string; path: string; createdAt?: string } =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.path === 'string',
    )
  } catch {
    return // no projects.json → nothing to migrate (fresh install or already done)
  }

  // The behaviour defaults moved into each manifest — seed them from the old global
  // settings.json (current getSettings no longer parses these fields).
  let oldSubs = { dazSubdir: 'daz3d', houdiniSubdir: 'houdini', createHoudiniSubdir: true }
  try {
    const s = JSON.parse(await readTextFile(await dataPath('settings.json')))
    oldSubs = {
      dazSubdir: typeof s.dazSubdir === 'string' && s.dazSubdir ? s.dazSubdir : 'daz3d',
      houdiniSubdir:
        typeof s.houdiniSubdir === 'string' && s.houdiniSubdir ? s.houdiniSubdir : 'houdini',
      createHoudiniSubdir:
        typeof s.createHoudiniSubdir === 'boolean' ? s.createHoudiniSubdir : true,
    }
  } catch {
    // keep defaults
  }

  const imagesDir = await dataPath('images')
  let migrated = 0
  let allOk = true

  for (const project of projects) {
    const dir = project.path.replace(/\\/g, '/').replace(/\/+$/g, '')
    try {
      if (!dir || !(await exists(dir))) {
        allOk = false // unreachable — leave it for a later run
        continue
      }
      const manifest: DcspManifest = {
        schemaVersion: DCSP_SCHEMA_VERSION,
        id: project.id,
        name: project.name,
        createdAt: project.createdAt ?? new Date().toISOString(),
        ...oldSubs,
        // New per-project fields (defaults preserve today's behaviour): the assets
        // feature is off and characters stay directly under the project root.
        assetsEnabled: false,
        charactersSubdir: '',
      }
      await writeManifest(dir, manifest)
      const dest = metaImagesDir(dir)
      await mkdir(dest, { recursive: true })

      // Move each character's avatar from app-data/images into the project's
      // `.dcsmeta/images` (the stored `image` is a bare filename). Best-effort.
      for (const character of await listCharacters(dir)) {
        const image = character.image
        if (!image || isExternalImage(image)) continue
        const src = `${imagesDir}/${image}`
        try {
          if (await exists(src)) {
            await writeFile(`${dest}/${image}`, await readFile(src))
            await remove(src)
          }
        } catch {
          // a locked/missing avatar shouldn't fail the project's migration
        }
      }

      const dcsp = await findManifestPath(dir)
      if (dcsp) await rememberRecent(dcsp, project.name)
      migrated += 1
    } catch {
      allOk = false // surfaced on retry; old files are kept below until all succeed
    }
  }

  // Only finalise (drop the legacy state) once every project migrated cleanly —
  // otherwise keep projects.json so the unreachable ones retry next launch.
  if (allOk) {
    try {
      await remove(await dataPath('projects.json'))
    } catch {
      // leave it; harmless — the guard above just makes the next run a no-op
    }
    try {
      if (await exists(imagesDir)) await remove(imagesDir, { recursive: true })
    } catch {
      // ignore — orphaned, unreferenced avatars
    }
    // Rewrite settings.json without the moved-out behaviour fields (getSettings no
    // longer parses them, so a re-save strips them from disk).
    try {
      await saveSettings(await getSettings())
    } catch {
      // leaving the stale keys is harmless — they're ignored on read
    }
  }

  if (migrated > 0) {
    toast.success(`Migrated ${migrated} project${migrated === 1 ? '' : 's'} to project files`)
  }
}
