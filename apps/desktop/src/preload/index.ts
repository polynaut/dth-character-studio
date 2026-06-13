import { contextBridge, ipcRenderer } from 'electron'

/**
 * The entire main↔renderer bridge. Kept deliberately tiny: the web app's own
 * server functions still do all the file I/O — this only exposes the few things
 * that genuinely need the OS (native dialogs, app metadata). Mirrored by the
 * `DesktopApi` type in apps/web/src/desktop.d.ts.
 */
const desktop = {
  isDesktop: true as const,
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  pickFbxFile: (): Promise<string> => ipcRenderer.invoke('dialog:pickFbx'),
  openDataDir: (): Promise<string> => ipcRenderer.invoke('app:openDataDir'),
}

contextBridge.exposeInMainWorld('desktop', desktop)
