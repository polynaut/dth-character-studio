import { createContext, useContext, useMemo } from 'react'
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
  /**
   * Surface a user-facing error message (e.g. a failed inline save). The host
   * routes it into its toast system; the provider-less default only logs, so a
   * bare-browser build never swallows the error silently.
   */
  onError: (message: string) => void
}

const defaultConfig: UiConfig = {
  onNavigate: (path) => {
    if (typeof window !== 'undefined') window.location.assign(path)
  },
  onOpenExternal: (url) => {
    if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
  },
  onError: (message) => {
    console.error(message)
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
  // Memoized per handler, not per `value` object: hosts typically pass an
  // inline literal, and an unmemoized merge re-rendered every useUiConfig
  // consumer whenever the host root re-rendered.
  const { onNavigate, onOpenExternal, onError } = value
  const merged = useMemo(
    () => ({
      onNavigate: onNavigate ?? defaultConfig.onNavigate,
      onOpenExternal: onOpenExternal ?? defaultConfig.onOpenExternal,
      onError: onError ?? defaultConfig.onError,
    }),
    [onNavigate, onOpenExternal, onError],
  )
  return <UiConfigContext.Provider value={merged}>{children}</UiConfigContext.Provider>
}

export function useUiConfig(): UiConfig {
  return useContext(UiConfigContext)
}
