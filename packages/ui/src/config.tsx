import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/**
 * Host-supplied behaviours the UI kit needs but must not hard-code — this is the
 * seam that keeps `@dth/ui` free of any Tauri / router / filesystem dependency.
 *
 * The defaults are the plain-web implementations (history navigation + a new
 * browser tab), so the kit works standalone in a browser with no provider. The
 * desktop app wraps its tree in <UiConfigProvider> to route internal links
 * through TanStack Router and external links through the OS browser (Tauri).
 */
export type UiConfig = {
  /** Navigate to an in-app path (an href beginning with "/"). */
  onNavigate: (path: string) => void
  /** Open an external URL / scheme (http(s), mailto, …) outside the app. */
  onOpenExternal: (url: string) => void
}

const defaultConfig: UiConfig = {
  onNavigate: (path) => {
    if (typeof window !== 'undefined') window.location.assign(path)
  },
  onOpenExternal: (url) => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  },
}

const UiConfigContext = createContext<UiConfig>(defaultConfig)

export function UiConfigProvider({
  value,
  children,
}: {
  value: Partial<UiConfig>
  children: ReactNode
}) {
  return <UiConfigContext.Provider value={{ ...defaultConfig, ...value }}>{children}</UiConfigContext.Provider>
}

export function useUiConfig(): UiConfig {
  return useContext(UiConfigContext)
}
