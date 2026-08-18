// Sequential `await` in a loop is this module's normal shape, not an oversight:
// it is ORDERED filesystem work — a step reads, moves or overwrites what the
// step before it wrote, and the rule's advice (`Promise.all`) would race those
// against each other. Scoped off for the file rather than repeated at each
// loop; a loop here that genuinely CAN run in parallel should use `Promise.all`
// on its own merits.
/* oxlint-disable no-await-in-loop */
import { copyFile, exists, mkdir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { toast } from 'sonner'

import {
  DCSP_SCHEMA_VERSION,
  dataPath,
  findManifestPath,
  getSettings,
  metaImagesDir,
  PROJECT_BEHAVIOR_DEFAULTS,
  rememberRecent,
  saveSettings,
  scanCharacterLibrary,
  writeManifest,
  type DcspManifest,
} from './storage'
import { isExternalImage } from './image'
import { stripTrailingSeparators } from '#/lib/path.ts'

/**
 * Move each of a project's character avatars from the legacy `app-data/images`
 * into the project's `.dcsmeta/images`. Idempotent (a missing source is skipped)
 * and run on BOTH the fresh-manifest path AND the "already has a manifest" path —
 * a crash after writing the manifest but before moving avatars would otherwise
 * leave the avatars in app-data, which finalisation then deletes wholesale.
 * Best-effort per avatar.
 *
 * Returns whether the character scan was COMPLETE (zero unreadable
 * definitions). The scan tolerates a torn/corrupt definition by reporting it as
 * a problem instead of an entry — which means that character's avatar never
 * reaches this move. Finalisation must therefore not delete the legacy images
 * dir on an incomplete scan: those avatars are still only there.
 */
async function moveProjectAvatars(dir: string, imagesDir: string): Promise<boolean> {
  const dest = metaImagesDir(dir)
  await mkdir(dest, { recursive: true })
  const scan = await scanCharacterLibrary(dir)
  for (const { character } of scan.entries) {
    const image = character.image
    if (!image || isExternalImage(image)) continue
    const src = `${imagesDir}/${image}`
    try {
      if (await exists(src)) {
        // Native whole-file copy — avatars can be MBs; no webview byte round-trip.
        await copyFile(src, `${dest}/${image}`)
        await remove(src)
      }
    } catch {
      // a locked/missing avatar shouldn't fail the project's migration
    }
  }
  return scan.problems.length === 0
}

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
  // Whether EVERY project's avatar move ran off a complete character scan — an
  // unreadable definition hides its avatar from the move, so finalisation may
  // only delete the legacy images dir when nothing was hidden anywhere.
  let avatarsComplete = true

  for (const project of projects) {
    const dir = stripTrailingSeparators(project.path.replace(/\\/g, '/'))
    try {
      if (!dir || !(await exists(dir))) {
        allOk = false // unreachable — leave it for a later run
        continue
      }
      // Already migrated on an earlier run (e.g. this project was reachable then,
      // another wasn't, so projects.json is still around). Do NOT re-write its
      // manifest — that would clobber the user's per-project settings back to
      // defaults. But a prior run may have written the manifest and then crashed
      // BEFORE moving its avatars, so still attempt the (idempotent) avatar move
      // here — otherwise finalisation would delete app-data/images with those
      // avatars still in it. Then skip; it counts as done.
      if (await findManifestPath(dir)) {
        avatarsComplete = (await moveProjectAvatars(dir, imagesDir)) && avatarsComplete
        continue
      }
      const manifest: DcspManifest = {
        schemaVersion: DCSP_SCHEMA_VERSION,
        id: project.id,
        name: project.name,
        houdiniPathStyle: PROJECT_BEHAVIOR_DEFAULTS.houdiniPathStyle,
        createdAt: project.createdAt ?? new Date().toISOString(),
        ...oldSubs,
        // New per-project fields (defaults preserve today's behaviour): the assets
        // and Daz-products features are off and characters stay directly under the
        // project root.
        assetsEnabled: false,
        dazProductsEnabled: false,
        charactersSubdir: '',
        // A pre-`.dcsp` project never had a final-export folder; new characters
        // in it get one from here on, existing ones on their next generation.
        exportSubdir: PROJECT_BEHAVIOR_DEFAULTS.exportSubdir,
        unrealProjects: [],
      }
      await writeManifest(dir, manifest)
      // Move this project's avatars into its `.dcsmeta/images` (the stored `image`
      // is a bare filename). Shared with the already-migrated path above.
      avatarsComplete = (await moveProjectAvatars(dir, imagesDir)) && avatarsComplete

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
    // The legacy images dir may only go when every project's avatar move saw a
    // COMPLETE character scan: an unreadable definition never surfaced its
    // avatar to the move, so deleting the dir would delete that avatar's only
    // copy. Left in place otherwise — orphaned-at-worst beats gone.
    if (avatarsComplete) {
      try {
        if (await exists(imagesDir)) await remove(imagesDir, { recursive: true })
      } catch {
        // ignore — orphaned, unreferenced avatars
      }
    } else {
      console.warn(
        `[migrate-projects] kept the legacy avatar folder at ${imagesDir} — at least one project had unreadable character definitions, whose avatars may still live only there.`,
      )
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
