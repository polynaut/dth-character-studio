import { ask, open } from '@tauri-apps/plugin-dialog'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { rememberNetworkPath } from './rom/api.ts'

/**
 * Open an external URL — via the Tauri shell in the desktop app, or `window.open`
 * in a plain browser. Routing every "open link" through here keeps native access
 * in the desktop boundary and makes external links work in the web build too
 * (a bare `@tauri-apps/plugin-shell` call throws outside Tauri).
 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  await shellOpen(url)
}

/**
 * Intercept this window's native close request (the titlebar ✕ / Alt+F4). The
 * Tauri shell does NOT deliver `beforeunload` on a native close, so browser-style
 * guards never see it — this is the only hook that does. The handler may be
 * async; calling `event.preventDefault()` before it resolves keeps the window
 * open. Returns an unsubscribe. No-op in a plain browser (where `beforeunload`
 * works and covers the same case).
 */
export function onWindowCloseRequested(
  handler: (event: { preventDefault: () => void }) => void | Promise<void>,
): () => void {
  if (!isTauri()) return () => {}
  let unlisten: (() => void) | null = null
  let disposed = false
  void getCurrentWindow()
    .onCloseRequested(handler)
    .then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
  return () => {
    disposed = true
    unlisten?.()
  }
}

/**
 * A native yes/no confirmation for a destructive action, via the Tauri dialog
 * plugin (falls back to `window.confirm` in a plain browser). Returns whether the
 * user confirmed. Keeps native dialog access inside the desktop boundary.
 */
export async function confirmDialog(
  message: string,
  opts?: { title?: string; kind?: 'info' | 'warning' | 'error' },
): Promise<boolean> {
  if (!isTauri()) return window.confirm(message)
  return ask(message, { title: opts?.title, kind: opts?.kind, okLabel: 'Yes', cancelLabel: 'Cancel' })
}

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
 * Native CSV picker (DAZ morph export) via the Tauri dialog plugin. Returns the
 * picked absolute path, or '' if the user cancelled.
 */
export async function pickCsvPath(title: string): Promise<string> {
  const selected = await open({
    multiple: false,
    directory: false,
    title,
    filters: [{ name: 'CSV files', extensions: ['csv'] }],
  })
  return notePick(typeof selected === 'string' ? selected : '')
}

/**
 * Native Unreal project picker via the Tauri dialog plugin. Returns the picked
 * absolute path, or '' if the user cancelled.
 */
export async function pickUprojectPath(title: string): Promise<string> {
  const selected = await open({
    multiple: false,
    directory: false,
    title,
    filters: [{ name: 'Unreal projects', extensions: ['uproject'] }],
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

/**
 * Native `.dcsp` project-file picker via the Tauri dialog plugin. Returns the
 * picked absolute path, or '' if the user cancelled.
 */
export async function pickDcspPath(title: string): Promise<string> {
  const selected = await open({
    multiple: false,
    directory: false,
    title,
    filters: [{ name: 'DTH Character Studio projects', extensions: ['dcsp'] }],
  })
  return notePick(typeof selected === 'string' ? selected : '')
}

// --- Active project per window --------------------------------------------
// Each window is pinned to one project: the `.dcsp` file it was opened with (the
// Home window has none). The Rust side records this per window label and exposes
// it / opens new windows via these commands. All no-op / '' off the desktop.

/**
 * The `.dcsp` project file this window was opened with — the per-window active
 * project. '' for the Home window (and on the web build). Never throws.
 */
export async function activeProjectFile(): Promise<string> {
  if (!isTauri()) return ''
  try {
    return (await invoke<string | null>('active_project_file')) ?? ''
  } catch {
    return ''
  }
}

/** Open a project in its own window — creating it, or focusing an existing one. */
export async function openProjectWindow(dcspPath: string): Promise<void> {
  if (!isTauri()) return
  await invoke('open_project_window', { path: dcspPath })
}

/** Open (or focus) the Home window — the projects launcher. */
export async function openHomeWindow(): Promise<void> {
  if (!isTauri()) return
  await invoke('open_home_window')
}
