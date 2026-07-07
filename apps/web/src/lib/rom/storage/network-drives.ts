import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'

import { dataPath, ensureAppDir } from './app-data'

// --- Known network drives (metadata) --------------------------------------
// Mapped network drives (X: → \\host\share) live in the user's logon session,
// so an elevated relaunch loses them. We remember each one's UNC as paths are
// picked (network-drives.json) and re-map the missing ones on startup — see the
// WNet commands in apps/desktop.

export interface KnownDrive {
  /** Drive specifier, upper-cased, e.g. "X:". */
  drive: string
  /** UNC target, e.g. "\\jebpot\devs". */
  unc: string
}

async function readKnownDrives(): Promise<Array<KnownDrive>> {
  try {
    const raw = JSON.parse(await readTextFile(await dataPath('network-drives.json')))
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (d): d is KnownDrive => d && typeof d.drive === 'string' && typeof d.unc === 'string',
    )
  } catch {
    return []
  }
}

async function writeKnownDrives(drives: Array<KnownDrive>): Promise<void> {
  await ensureAppDir()
  await writeTextFile(await dataPath('network-drives.json'), JSON.stringify(drives, null, 2) + '\n')
}

export async function listKnownDrives(): Promise<Array<KnownDrive>> {
  return (await readKnownDrives()).sort((a, b) => a.drive.localeCompare(b.drive))
}

/** Upsert a drive→UNC mapping, keyed by drive letter (case-insensitive). */
export async function rememberDrive(drive: string, unc: string): Promise<void> {
  const key = drive.trim().toUpperCase()
  const target = unc.trim()
  if (!key || !target) return
  const drives = await readKnownDrives()
  const idx = drives.findIndex((d) => d.drive.toUpperCase() === key)
  if (idx >= 0) {
    if (drives[idx].unc === target) return // unchanged — skip the write
    drives[idx] = { drive: key, unc: target }
  } else {
    drives.push({ drive: key, unc: target })
  }
  await writeKnownDrives(drives)
}

export async function forgetDrive(drive: string): Promise<void> {
  const key = drive.trim().toUpperCase()
  await writeKnownDrives((await readKnownDrives()).filter((d) => d.drive.toUpperCase() !== key))
}
