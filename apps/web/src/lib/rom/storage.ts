import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { appLocalDataDir } from '@tauri-apps/api/path'

import {
  ROM_SECTIONS,
  characterSchema,
  defaultSections,
  sectionsFromFlatFrames,
} from '@dth/rom'

import { canonicalImage } from './image'

import type { Character, DthPoseAsset, GenesisVersion, RomSection } from '@dth/rom'

/**
 * Local JSON-file-per-character storage, backed by the Tauri fs plugin.
 * Data lives in the per-user app-local data dir (e.g.
 * %LOCALAPPDATA%/com.polynaut.dthcharacterstudio) so it survives app updates
 * and never depends on the working directory. One readable, diffable JSON per
 * character also keeps sharing trivial.
 */

/** Join path segments with '/'. Tauri's fs normalizes separators on Windows. */
function join(...parts: Array<string>): string {
  return parts
    .map((p) => p.replace(/[\\/]+$/g, ''))
    .filter(Boolean)
    .join('/')
}

let dataDirPromise: Promise<string> | null = null
async function dataDir(): Promise<string> {
  if (!dataDirPromise) {
    dataDirPromise = appLocalDataDir().then((d) => d.replace(/[\\/]+$/g, ''))
  }
  return dataDirPromise
}

/** Resolve a path inside the per-user data directory. */
export async function dataPath(...parts: Array<string>): Promise<string> {
  return join(await dataDir(), ...parts)
}

async function ensureDirs(): Promise<void> {
  await mkdir(await dataPath('characters'), { recursive: true })
}

/**
 * Migrates older data files to the sections model:
 *  v1: flat `entries`  v2: `groups` (with section field) + `options` flags.
 */
function parseCharacter(raw: unknown): Character {
  const data = raw as Record<string, any>
  if (data.sections) {
    // v3 stored a GEN presetVariant instead of selected preset asset files.
    const gen = data.sections.GEN
    if (gen?.presetVariant && !gen.presetAssets) {
      gen.presetAssets =
        gen.presetVariant === 'both'
          ? ['GP9 - Golden Palace.duf', 'DK9 - Dicktator.duf']
          : gen.presetVariant === 'dk'
            ? ['DK9 - Dicktator.duf']
            : ['GP9 - Golden Palace.duf']
    }
  }
  if (!data.sections) {
    const sections = Array.isArray(data.entries)
      ? sectionsFromFlatFrames(data.entries)
      : defaultSections()
    if (Array.isArray(data.groups)) {
      for (const group of data.groups) {
        const section: RomSection = (ROM_SECTIONS as ReadonlyArray<string>).includes(group.section)
          ? group.section
          : 'MISC'
        const { section: _ignored, ...rest } = group
        sections[section].enabled = true
        sections[section].mode = 'custom'
        sections[section].groups.push(rest)
      }
    }
    const options = data.options ?? {}
    if (options.includeJCM === false) {
      sections.RET.enabled = false
      if (sections.JCM.mode === 'preset') sections.JCM.enabled = false
    }
    if (options.includeFAC === false && sections.FAC.mode === 'preset') {
      sections.FAC.enabled = false
    }
    if ((options.includeGP || options.includeDK) && sections.GEN.mode === 'preset') {
      sections.GEN.enabled = true
      sections.GEN.presetAssets = [
        ...(options.includeGP ? ['GP9 - Golden Palace.duf'] : []),
        ...(options.includeDK ? ['DK9 - Dicktator.duf'] : []),
      ]
    }
    if (typeof options.resetGPBeforeApplying === 'boolean') {
      data.resetGPBeforeApplying = options.resetGPBeforeApplying
    }
    data.sections = sections
    delete data.entries
    delete data.groups
    delete data.options
  }
  // The PoseAsset node knows no "none" suffix — older data migrates to centre.
  for (const config of Object.values(data.sections as Record<string, any>)) {
    for (const group of config?.groups ?? []) {
      if (group.suffix === 'none') group.suffix = 'centre'
    }
  }
  // Normalise avatar refs to the portable canonical form (filename or external
  // URL) — drops machine-specific asset/convertFileSrc URLs persisted earlier.
  data.image = canonicalImage(data.image)
  return characterSchema.parse(data)
}

export async function listCharacters(): Promise<Array<Character>> {
  await ensureDirs()
  const dir = await dataPath('characters')
  const files = (await readDir(dir)).filter((e) => e.isFile && e.name.endsWith('.json'))
  const characters = await Promise.all(
    files.map(async (file) => parseCharacter(JSON.parse(await readTextFile(join(dir, file.name))))),
  )
  return characters.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getCharacter(id: string): Promise<Character | null> {
  await ensureDirs()
  try {
    const raw = await readTextFile(await dataPath('characters', `${id}.json`))
    return parseCharacter(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function saveCharacter(character: Character): Promise<Character> {
  await ensureDirs()
  const stamped = { ...character, updatedAt: new Date().toISOString() }
  await writeTextFile(
    await dataPath('characters', `${character.id}.json`),
    JSON.stringify(stamped, null, 2) + '\n',
  )
  return stamped
}

export async function deleteCharacter(id: string): Promise<void> {
  const path = await dataPath('characters', `${id}.json`)
  if (await exists(path)) await remove(path)
}

export async function writeGeneratedFiles(
  slug: string,
  files: Array<{ fileName: string; content: string }>,
): Promise<string> {
  const dir = await dataPath('out', slug)
  await mkdir(dir, { recursive: true })
  await Promise.all(files.map((file) => writeTextFile(join(dir, file.fileName), file.content)))
  return dir
}

/** Writes files into an existing external folder (e.g. the DazToHue-Scripts checkout). */
export async function writeFilesToFolder(
  folder: string,
  files: Array<{ fileName: string; content: string }>,
): Promise<void> {
  if (!(await isDir(folder))) throw new Error(`Not a folder: ${folder}`)
  await Promise.all(files.map((file) => writeTextFile(join(folder, file.fileName), file.content)))
}

export interface StudioSettings {
  /** DazToHue-Scripts checkout — generated Daz files are written here, next to DthWorkflow.dsa. */
  dazScriptsFolder: string
  /** DazToHue Poses folder — scanned for the pre-defined pose preset catalog. */
  dthPosesFolder: string
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory
  } catch {
    return false
  }
}

/** Defaults for a fresh install: both folders empty. */
function defaultSettings(): StudioSettings {
  return { dazScriptsFolder: '', dthPosesFolder: '' }
}

export async function getSettings(): Promise<StudioSettings> {
  await ensureDirs()
  const defaults = defaultSettings()
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('settings.json')))
    return {
      dazScriptsFolder:
        typeof raw.dazScriptsFolder === 'string' ? raw.dazScriptsFolder : defaults.dazScriptsFolder,
      dthPosesFolder:
        typeof raw.dthPosesFolder === 'string' && raw.dthPosesFolder
          ? raw.dthPosesFolder
          : defaults.dthPosesFolder,
    }
  } catch {
    return defaults
  }
}

export async function saveSettings(settings: StudioSettings): Promise<StudioSettings> {
  await ensureDirs()
  await writeTextFile(await dataPath('settings.json'), JSON.stringify(settings, null, 2) + '\n')
  return settings
}

/** Recursively collect file paths (relative to `root`, '/'-separated). */
async function walkFiles(root: string, rel = ''): Promise<Array<string>> {
  const here = rel ? join(root, rel) : root
  const out: Array<string> = []
  for (const entry of await readDir(here)) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory) out.push(...(await walkFiles(root, childRel)))
    else out.push(childRel)
  }
  return out
}

/**
 * Scans the DazToHue Poses folder and classifies every .duf preset by genesis
 * generation, skinning variant and pose asset category. The folder layout is
 * `<Genesis X>/<Common|DQS|Linear>/...`.
 */
export async function listPoseAssets(): Promise<{
  folder: string
  assets: Array<DthPoseAsset>
  error: string | null
}> {
  const { dthPosesFolder } = await getSettings()
  if (!dthPosesFolder) {
    return { folder: '', assets: [], error: 'No DTH release / Poses folder configured.' }
  }
  if (!(await isDir(dthPosesFolder))) {
    return { folder: dthPosesFolder, assets: [], error: `Folder not reachable: ${dthPosesFolder}` }
  }
  // Accept either the Poses folder itself or a DTH release root
  // (e.g. ".../Release 2.4.3", which contains Daz Studio Content/DazToHue/Poses).
  let posesFolder = dthPosesFolder
  const looksLikePoses = (
    await Promise.all(
      ['Genesis 3', 'Genesis 8', 'Genesis 8.1', 'Genesis 9'].map((g) =>
        isDir(join(posesFolder, g)),
      ),
    )
  ).some(Boolean)
  if (!looksLikePoses) {
    const releaseContent = join(posesFolder, 'Daz Studio Content', 'DazToHue', 'Poses')
    if (await isDir(releaseContent)) posesFolder = releaseContent
  }
  const entries = await walkFiles(posesFolder)
  const assets: Array<DthPoseAsset> = []
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.duf')) continue
    const relPath = entry
    const parts = relPath.split('/')
    const fileName = parts[parts.length - 1]
    const name = fileName.replace(/\.duf$/i, '')

    const genesis: GenesisVersion | null =
      parts[0] === 'Genesis 3'
        ? 'G3'
        : parts[0] === 'Genesis 8'
          ? 'G8'
          : parts[0] === 'Genesis 8.1'
            ? 'G8.1'
            : parts[0] === 'Genesis 9'
              ? 'G9'
              : null
    const skinning = parts[1] === 'DQS' ? 'dqs' : parts[1] === 'Linear' ? 'linear' : null

    let section: RomSection | null = null
    if (/retargett?ing poses/i.test(name)) section = 'RET'
    else if (/JCM( FAC)? - Base/i.test(name)) section = 'JCM'
    else if (/FAC - Mouth/i.test(name)) section = 'FAC'
    else if (parts.some((p) => /golden ?palace|dicktator/i.test(p))) section = 'GEN'
    else if (parts.some((p) => /physics/i.test(p))) section = 'PHY'

    assets.push({
      name,
      relPath,
      genesis,
      skinning,
      section,
      includesFac: section === 'JCM' && /FAC/i.test(name),
    })
  }
  assets.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return { folder: posesFolder, assets, error: null }
}
