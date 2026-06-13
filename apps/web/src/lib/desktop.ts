import { pickFbxFile as pickFbxFileServer } from '#/lib/rom/api.ts'

/**
 * Native FBX picker. In the Electron shell this goes through the preload
 * bridge (`window.desktop`) to the OS dialog in the main process; as a plain
 * web app it falls back to the server function (PowerShell dialog on Windows).
 */
export async function pickFbxPath(): Promise<string> {
  if (typeof window !== 'undefined' && window.desktop) {
    return window.desktop.pickFbxFile()
  }
  return pickFbxFileServer()
}
