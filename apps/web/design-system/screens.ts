import type { TauriMockSeed } from '../smoke/tauri-mock.ts'

export type Screen = {
  id: string
  title: string
  description?: string
  route: string
  seed?: Record<string, unknown>
  /** For state the guide seeds past buildSeed's options (installs, scans). Runs in the frame. */
  tune?: (seed: TauriMockSeed) => void
  width?: number
  height?: number
  drive?: (root: HTMLElement) => Promise<void>
}

export const defineScreens = (feature: string, screens: Screen[]) => ({ feature, screens })

export const screenModules = import.meta.glob<{ default: ReturnType<typeof defineScreens> }>(
  '../src/**/*.screens.tsx',
)
