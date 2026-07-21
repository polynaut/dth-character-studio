import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

/**
 * Files a folder move couldn't relocate because another process (Daz Studio /
 * Houdini) holds them open. Thrown by the move helpers BEFORE anything is
 * touched on disk, so the UI can show the "close those apps and continue"
 * dialog with the file list and retry — the move is all-or-nothing, never a
 * half-moved folder.
 */
export class LockedFilesError extends Error {
  constructor(readonly files: Array<string>) {
    super('Some files are open in another application and can’t be moved.')
    this.name = 'LockedFilesError'
  }
}

/** The files under `dir` currently locked by another process (empty off-desktop
 *  or when nothing is locked). Best-effort on Unix (no mandatory file locks). */
export async function probeLockedFiles(dir: string): Promise<Array<string>> {
  if (!isTauri()) return []
  return z.array(z.string()).parse(await invoke('probe_locked_files', { dir }))
}

/**
 * THE lock gate every folder move goes through: if any file under `sourceDir`
 * is locked, throw {@link LockedFilesError} (carrying the list) before the move
 * starts. Callers wrap their move in the shared retry loop (`useFolderMove`),
 * which shows the dialog and re-runs this on "Continue".
 */
export async function assertMovable(sourceDir: string): Promise<void> {
  const locked = await probeLockedFiles(sourceDir)
  if (locked.length) throw new LockedFilesError(locked)
}
