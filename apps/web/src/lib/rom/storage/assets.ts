import { exists, mkdir, readTextFile, remove } from '@tauri-apps/plugin-fs'

import { basename, join, writeTextFileAtomic } from './fs'

// --- Assets ---------------------------------------------------------------
// A library of reusable Daz scenes ("assets") — starting points to build
// characters on. They live per level: globally in the app-data folder, or inside
// a project's folder, both under a hidden `.assets/` directory holding a small
// `assets.json` registry plus, for copied assets, the scene files themselves. A
// linked asset keeps its scene where it is and just records the path.

export interface DazAsset {
  id: string
  /** Display name (defaults to the scene's file name; user-editable). */
  name: string
  /** Absolute path to the asset's Daz scene (.duf) — inside `.assets` when copied,
   *  wherever the user picked it when linked. */
  scenePath: string
  description: string
  /** Subfolder under `.assets` the scene was copied into ('' = directly in
   *  `.assets`; unused for a linked asset). */
  subfolder: string
  /** true = scene lives outside `.assets` (linked in place); false = copied in. */
  linked: boolean
  createdAt: string
  updatedAt: string
}

/** The hidden `.assets` folder under a level root (the app-data dir, or a project). */
export function assetsDir(base: string): string {
  return join(base, '.assets')
}

async function readAssetRegistry(base: string): Promise<Array<DazAsset>> {
  try {
    const raw = JSON.parse(await readTextFile(join(assetsDir(base), 'assets.json')))
    if (!Array.isArray(raw)) return []
    return raw
      .filter(
        (a): a is Partial<DazAsset> & Pick<DazAsset, 'id' | 'scenePath'> =>
          a && typeof a.id === 'string' && typeof a.scenePath === 'string',
      )
      .map((a) => ({
        id: a.id,
        name: a.name ?? '',
        scenePath: a.scenePath,
        description: a.description ?? '',
        subfolder: a.subfolder ?? '',
        linked: a.linked ?? true,
        createdAt: a.createdAt ?? '',
        updatedAt: a.updatedAt ?? '',
      }))
  } catch {
    return []
  }
}

async function writeAssetRegistry(base: string, assets: Array<DazAsset>): Promise<void> {
  await mkdir(assetsDir(base), { recursive: true })
  await writeTextFileAtomic(
    join(assetsDir(base), 'assets.json'),
    JSON.stringify(assets, null, 2) + '\n',
  )
}

export async function listAssets(base: string): Promise<Array<DazAsset>> {
  return (await readAssetRegistry(base)).sort((a, b) => a.name.localeCompare(b.name))
}

export async function addAsset(base: string, asset: DazAsset): Promise<DazAsset> {
  const assets = await readAssetRegistry(base)
  assets.push(asset)
  await writeAssetRegistry(base, assets)
  return asset
}

export async function updateAsset(base: string, asset: DazAsset): Promise<DazAsset> {
  const assets = await readAssetRegistry(base)
  const idx = assets.findIndex((a) => a.id === asset.id)
  if (idx < 0) throw new Error(`Asset ${asset.id} not found`)
  const updated = { ...asset, updatedAt: new Date().toISOString() }
  assets[idx] = updated
  await writeAssetRegistry(base, assets)
  return updated
}

export async function removeAsset(
  base: string,
  id: string,
  opts: { keepFiles?: boolean } = {},
): Promise<void> {
  const assets = await readAssetRegistry(base)
  const asset = assets.find((a) => a.id === id)
  if (!asset) return
  // A copied asset owns its scene files under `.assets` — remove them unless the
  // caller opts to keep them. A linked asset points outside `.assets`, so its
  // source is never touched.
  if (!asset.linked && !opts.keepFiles) {
    const dir = asset.subfolder ? join(assetsDir(base), asset.subfolder) : assetsDir(base)
    const duf = basename(asset.scenePath)
    const stem = duf.replace(/\.duf$/i, '')
    for (const sidecar of [duf, `${duf}.png`, `${duf}.tip.png`, `${stem}.tip.png`, `${stem}.png`]) {
      const p = join(dir, sidecar)
      try {
        if (await exists(p)) await remove(p)
      } catch {
        // leave a stray file rather than failing the delete
      }
    }
  }
  await writeAssetRegistry(
    base,
    assets.filter((a) => a.id !== id),
  )
}
