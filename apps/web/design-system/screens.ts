export type Screen = {
  id: string
  title: string
  description?: string
  route: string
  seed?: Record<string, unknown>
  width?: number
  height?: number
  drive?: (root: HTMLElement) => Promise<void>
}

export const defineScreens = (feature: string, screens: Screen[]) => ({ feature, screens })

export const screenModules = import.meta.glob<{ default: ReturnType<typeof defineScreens> }>(
  '../src/**/*.screens.tsx',
)
