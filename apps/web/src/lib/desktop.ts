import { open } from '@tauri-apps/plugin-dialog'

import { rememberNetworkPath } from './rom/api.ts'

/**
 * After any pick, remember (in the background) whether the path sits on a mapped
 * network drive, so that drive can be re-mapped on a later elevated startup.
 * Fire-and-forget — it never blocks or fails the pick.
 */
function notePick(path: string): string {
  if (path) void rememberNetworkPath(path).catch(() => {})
  return path
}

/**
 * Native FBX picker via the Tauri dialog plugin. Returns the picked absolute
 * path, or '' if the user cancelled.
 */
export async function pickFbxPath(): Promise<string> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: 'Select reference skeleton FBX',
    filters: [{ name: 'FBX files', extensions: ['fbx'] }],
  })
  return notePick(typeof selected === 'string' ? selected : '')
}

/**
 * Native .duf pose-preset picker via the Tauri dialog plugin. Returns the
 * picked absolute path, or '' if the user cancelled.
 */
export async function pickDufPath(title: string): Promise<string> {
  const selected = await open({
    multiple: false,
    directory: false,
    title,
    filters: [{ name: 'DAZ pose presets', extensions: ['duf'] }],
  })
  return notePick(typeof selected === 'string' ? selected : '')
}

/**
 * Native Houdini project picker via the Tauri dialog plugin. Returns the picked
 * absolute path, or '' if the user cancelled.
 */
export async function pickHipPath(title: string): Promise<string> {
  const selected = await open({
    multiple: false,
    directory: false,
    title,
    filters: [{ name: 'Houdini projects', extensions: ['hip', 'hipnc', 'hiplc'] }],
  })
  return notePick(typeof selected === 'string' ? selected : '')
}

/**
 * Native folder picker via the Tauri dialog plugin. Returns the picked absolute
 * path, or '' if the user cancelled. `defaultPath` opens the dialog there.
 */
export async function pickFolder(title: string, defaultPath?: string): Promise<string> {
  const selected = await open({ multiple: false, directory: true, title, defaultPath })
  return notePick(typeof selected === 'string' ? selected : '')
}
