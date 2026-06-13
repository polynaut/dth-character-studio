/**
 * Shape of the bridge the Electron shell exposes on `window.desktop`
 * (see apps/desktop/src/preload). Absent when running as a plain web app —
 * always feature-detect before use.
 */
export {}

declare global {
  interface DesktopApi {
    readonly isDesktop: true
    /** App version from the Electron main process. */
    version(): Promise<string>
    /** Open the native FBX file dialog; resolves to the path, or '' if cancelled. */
    pickFbxFile(): Promise<string>
    /** Reveal the per-user data folder in the OS file manager. */
    openDataDir(): Promise<string>
  }

  interface Window {
    desktop?: DesktopApi
  }
}
