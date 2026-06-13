import { join } from 'node:path'

/**
 * SERVER ONLY — the single source of truth for where persisted studio data lives.
 *
 * Standalone web app: `<cwd>/data` (the app is launched from apps/web).
 * Electron desktop shell: the shell sets `DTH_DATA_DIR` to the per-user
 * application-data folder so characters survive app updates and don't depend
 * on the working directory the OS happened to launch the binary from.
 */
export const DATA_DIR = process.env.DTH_DATA_DIR || join(process.cwd(), 'data')

/** Resolve a path inside the data directory. */
export function dataPath(...parts: Array<string>): string {
  return join(DATA_DIR, ...parts)
}
