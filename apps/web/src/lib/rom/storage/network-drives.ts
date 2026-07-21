import { readTextFile } from '@tauri-apps/plugin-fs'

import { writeTextFileAtomic } from './fs'
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
  await writeTextFileAtomic(
    await dataPath('network-drives.json'),
    JSON.stringify(drives, null, 2) + '\n',
  )
}

export async function listKnownDrives(): Promise<Array<KnownDrive>> {
  return (await readKnownDrives()).sort((a, b) => a.drive.localeCompare(b.drive))
}

// Drive mutations are an unlocked read-modify-write on a file shared across
// windows — the same class of bug fixed for recents (see `mutateRecents` in
// storage/projects.ts). Serialize the mutations within this window and RE-READ
// fresh inside each queued step, so two overlapping calls (paths picked in two
// windows at once) merge against the latest disk state instead of clobbering
// each other with stale snapshots. Returning null from `mutate` skips the write.
let drivesMutationQueue: Promise<void> = Promise.resolve()

function mutateKnownDrives(
  mutate: (drives: Array<KnownDrive>) => Array<KnownDrive> | null,
): Promise<void> {
  const run = drivesMutationQueue.then(async () => {
    const next = mutate(await readKnownDrives())
    if (next) await writeKnownDrives(next)
  })
  // The queue survives a failed write — the next mutation still runs.
  drivesMutationQueue = run.catch(() => {})
  return run
}

/** Upsert a drive→UNC mapping, keyed by drive letter (case-insensitive). */
export async function rememberDrive(drive: string, unc: string): Promise<void> {
  const key = drive.trim().toUpperCase()
  const target = unc.trim()
  if (!key || !target) return
  return mutateKnownDrives((drives) => {
    const idx = drives.findIndex((d) => d.drive.toUpperCase() === key)
    if (idx >= 0) {
      if (drives[idx].unc === target) return null // unchanged — skip the write
      drives[idx] = { drive: key, unc: target }
    } else {
      drives.push({ drive: key, unc: target })
    }
    return drives
  })
}

export async function forgetDrive(drive: string): Promise<void> {
  const key = drive.trim().toUpperCase()
  return mutateKnownDrives((drives) => drives.filter((d) => d.drive.toUpperCase() !== key))
}
