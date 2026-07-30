import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'

import { writeTextFileAtomic } from './fs'

import type { StudioSettings } from './settings'

/**
 * The studio-managed `houdini.env` variable: `DAZ3D_LIB` points every Houdini
 * session at the "My DAZ 3D Library" folder from Settings, so networks can
 * reference Daz files as `$DAZ3D_LIB/...` instead of hardcoding machine paths
 * — a project built that way stays moveable. Written into the Houdini
 * documents folder(s) from Settings (primary + extras — houdini.env lives in
 * the per-version documents folder, which is exactly what those settings
 * hold), kept current by every Settings save AND by Tools → Refresh assets,
 * so existing users get it without re-saving Settings. Houdini reads the file
 * at startup — changes apply on the next Houdini restart.
 */
export const DAZ_LIB_ENV_VAR = 'DAZ3D_LIB'

/** The comment line written once above a variable this studio manages. */
const MANAGED_COMMENT = '# Managed by DTH Character Studio'

/**
 * Upsert `NAME = "value"` into houdini.env TEXT, preserving everything else:
 * an existing assignment line for NAME (however it was spelled/spaced) is
 * replaced in place; otherwise the assignment is appended (with a managed-by
 * comment) after a blank separator line. The file's newline flavor is kept.
 * Pure — the one place the env-file edit rule lives; exported for its test.
 */
export function upsertHoudiniEnvVar(text: string, name: string, value: string): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const assignment = `${name} = "${value}"`
  const lines = text.split(/\r?\n/)
  // NAME possibly surrounded by whitespace, then '=' — never a longer name
  // that merely starts with NAME (DAZ3D_LIB vs DAZ3D_LIB_X).
  const isVarLine = (line: string) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    return m !== null && m[1] === name
  }
  if (lines.some(isVarLine)) {
    return lines.map((line) => (isVarLine(line) ? assignment : line)).join(eol)
  }
  const out = [...lines]
  // Drop trailing empty lines so the appended block sits one blank line below
  // the existing content, then restore the trailing newline.
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
  if (out.length > 0) out.push('')
  out.push(MANAGED_COMMENT, assignment, '')
  return out.join(eol)
}

/**
 * Ensure `DAZ3D_LIB` in every configured Houdini documents folder's
 * `houdini.env` (created when missing). No-op without a Daz library folder or
 * without Houdini docs folders — the studio only ever ADDS/UPDATES the one
 * variable, it never removes it (a cleared library folder leaves the last
 * good value; pointing Houdini at nothing helps nobody). Returns how many env
 * files were actually (re)written — an unchanged file doesn't count — plus
 * per-folder errors (unreachable folder, write failure).
 */
export async function ensureHoudiniEnvDazLib(
  settings: Pick<StudioSettings, 'dazLibraryFolder' | 'houdiniDocsFolder' | 'extraHoudiniDocsFolders'>,
): Promise<{ updated: number; errors: Array<string> }> {
  const result = { updated: 0, errors: [] as Array<string> }
  if (!isTauri()) return result
  const dazLib = settings.dazLibraryFolder.trim().replace(/\\/g, '/')
  if (!dazLib) return result
  const folders = [settings.houdiniDocsFolder, ...settings.extraHoudiniDocsFolders]
    .map((f) => f.trim())
    .filter(Boolean)
  for (const folder of folders) {
    try {
      if (!(await exists(folder))) continue
      const envPath = `${folder.replace(/\\/g, '/')}/houdini.env`
      const current = (await exists(envPath)) ? await readTextFile(envPath) : ''
      const next = upsertHoudiniEnvVar(current, DAZ_LIB_ENV_VAR, dazLib)
      if (next !== current) {
        await writeTextFileAtomic(envPath, next)
        result.updated += 1
      }
    } catch (e) {
      result.errors.push(`${folder}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return result
}
