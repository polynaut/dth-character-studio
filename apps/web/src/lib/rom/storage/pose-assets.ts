import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'

import type { DthPoseAsset, GenesisVersion, RomSection } from '@dth/rom'

import { isDir } from './fs'
import { getSettings } from './settings'
import { resolveActiveRelease } from './releases'

// --- Pose asset scan ------------------------------------------------------
// The active release's Poses folder is walked natively (Rust scan_duf_files) and
// classified here on demand — there is no on-disk catalog to build or go stale.
// The scan is tiny and fast (a handful of .duf files), so the frontend keeps the
// result in memory for the session and re-scans when the release selection
// changes (see api.fetchPoseAssets / rescanPoseAssets).

/**
 * Classify one pose preset by its path relative to the Poses root
 * (`<Genesis X>/<DQS|Linear>/...`): genesis generation, skinning variant and ROM
 * section.
 */
function classifyPose(relPath: string): DthPoseAsset {
  const parts = relPath.split('/')
  const name = parts[parts.length - 1].replace(/\.duf$/i, '')
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
  return {
    name,
    relPath,
    genesis,
    skinning,
    section,
    includesFac: section === 'JCM' && /FAC/i.test(name),
  }
}

/** Recursively list `.duf` paths under a Poses folder via the native walk (one
 *  IPC call; rel paths are '/'-separated, relative to `posesFolder`). Parsed
 *  through zod rather than a bare `invoke<T>()` cast (primitive shape — no
 *  contracts/ fixture needed; those pin structured returns). */
async function scanDufPaths(posesFolder: string): Promise<Array<string>> {
  return z.array(z.string()).parse(await invoke('scan_duf_files', { folder: posesFolder }))
}

/**
 * Scan + classify the active DTH release's pose presets, live. Resolves the
 * selected release under the configured folder, walks its Poses folder natively,
 * and classifies each `.duf`. Nothing is persisted — callers keep the result in
 * memory for the session (see api.fetchPoseAssets / rescanPoseAssets). Returns a
 * setup error (which ConfigError turns into a "change in Settings" link) when no
 * release is configured or it's unreachable.
 */
export async function scanPoseAssets(): Promise<{
  folder: string
  releaseName: string
  version: string
  assets: Array<DthPoseAsset>
  error: string | null
}> {
  const empty = { folder: '', releaseName: '', version: '', assets: [] as Array<DthPoseAsset> }
  const { dthPosesFolder, currentDthVersion } = await getSettings()
  if (!dthPosesFolder) {
    return { ...empty, error: 'No DTH release folder configured' }
  }
  if (!(await isDir(dthPosesFolder))) {
    return { ...empty, folder: dthPosesFolder, error: `Folder not reachable: ${dthPosesFolder}` }
  }
  const resolved = await resolveActiveRelease(dthPosesFolder, currentDthVersion)
  if (resolved.error) {
    return {
      ...empty,
      folder: dthPosesFolder,
      releaseName: resolved.releaseName,
      version: resolved.version,
      error: resolved.error,
    }
  }
  const posesFolder = resolved.posesFolder
  if (!(await isDir(posesFolder))) {
    return {
      ...empty,
      folder: dthPosesFolder,
      releaseName: resolved.releaseName,
      version: resolved.version,
      error: `Release "${resolved.releaseName}" has no Poses folder (expected at ${posesFolder})`,
    }
  }
  const assets = (await scanDufPaths(posesFolder))
    .map((relPath) => classifyPose(relPath))
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
  return { folder: posesFolder, releaseName: resolved.releaseName, version: resolved.version, assets, error: null }
}
