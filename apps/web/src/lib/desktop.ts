import { open } from '@tauri-apps/plugin-dialog'

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
  return typeof selected === 'string' ? selected : ''
}

/**
 * Native folder picker via the Tauri dialog plugin. Returns the picked absolute
 * path, or '' if the user cancelled.
 */
export async function pickFolder(title: string): Promise<string> {
  const selected = await open({ multiple: false, directory: true, title })
  return typeof selected === 'string' ? selected : ''
}
