import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'

import { isTauri } from '@tauri-apps/api/core'

import { getRouter } from './router'
import { checkForUpdates } from './lib/updater'
import { housekeepingSweep, isRefreshNeeded } from './lib/rom/api'
import { activeProjectFile } from './lib/desktop'
import { migrateProjects } from './lib/rom/migrate-projects'
import './styles.css'

/** Everything but the last path segment ('/'-joined). */
function dirOf(p: string): string {
  const norm = p.replace(/[\\/]+$/g, '')
  const idx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
  return idx >= 0 ? norm.slice(0, idx).replace(/\\/g, '/') : norm
}

const router = getRouter()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={router.options.context.queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

// Best-effort auto-update check (no-ops outside the packaged Tauri app). Once it
// settles, if this app generates newer scripts than some local character's (e.g.
// right after an update), send the user to the Refresh assets page. Gated to the
// Tauri app (dev:desktop or packaged) — the plain web build has no scripts to
// detect; isRefreshNeeded() is also self-guarding (returns false on any failure).
void (async () => {
  if (isTauri()) {
    // One-time upgrade of any pre-`.dcsp` install (old projects.json + avatars) to
    // project files — must run before anything reads project data.
    await migrateProjects().catch(() => {})
    // Activate this window's project — the `.dcsp` it was opened with. The Home
    // window has none and stays on `/`.
    const file = await activeProjectFile()
    if (file) {
      await router.navigate({ to: '/projects/$projectId', params: { projectId: dirOf(file) } })
    }
  }
  await checkForUpdates()
  if (!isTauri()) return
  // Quiet housekeeping: age-out stale product-scan files so app-data can't grow
  // without bound. Fire-and-forget — never blocks or fails startup.
  void housekeepingSweep().catch(() => {})
  if (await isRefreshNeeded()) {
    void router.navigate({ to: '/tools', search: { tab: 'refresh' } })
  }
})()
