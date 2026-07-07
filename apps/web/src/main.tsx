import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'

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
    <RouterProvider router={router} />
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
    // Activate this window's project — the `.dcsp` it was opened with. Windows
    // created at runtime load `index.html`, whose pathname (/index.html) matches
    // no route — every window must be navigated somewhere explicitly.
    const file = await activeProjectFile()
    if (file) {
      await router.navigate({ to: '/projects/$projectId', params: { projectId: dirOf(file) } })
    } else {
      // A Home window: land on `/`, preserving the `?new=1` the native
      // "New Project" menu passes so the create-project panel opens.
      const wantsNew = new URLSearchParams(window.location.search).get('new')
      await router.navigate({
        to: '/',
        search: wantsNew ? { new: true } : {},
        replace: true,
      })
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
