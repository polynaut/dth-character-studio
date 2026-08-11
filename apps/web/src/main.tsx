import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'

import { isTauri } from '@tauri-apps/api/core'

import { getRouter } from './router'
import { checkForUpdates } from './lib/updater'
import { housekeepingSweep, isRefreshNeeded, rememberActiveProject } from './lib/rom/api'
import { activeProjectFile } from './lib/desktop'
import { dirOf } from './lib/path'
import { migrateProjects } from './lib/rom/migrate-projects'
import '@fontsource-variable/manrope/index.css'
import './styles.css'

const router = getRouter()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

/**
 * Point the router at THIS window's real destination — before the first paint.
 *
 * Every window loads the same document, so the URL it starts on says nothing
 * about which project the window is for: the config window starts at `/`, which
 * the Home route matches, and a runtime window at `/index.html`, which matches
 * no route. Mounting first and correcting afterwards therefore painted a
 * project window's Home recents list for as long as the window→project lookup
 * plus the project loader took — the "wrong screen, then a jump" this function
 * exists to remove. Nothing renders until the destination is known, so the
 * window shows its own dark `backgroundColor` (tauri.conf.json) and then the
 * finished screen.
 *
 * The legacy-model upgrade still completes before any project data is read, but
 * it no longer sits IN FRONT of the lookup: the two are independent (one
 * rewrites legacy app-data, the other is a window-map read in Rust), so they
 * run together instead of stacking two IPC round trips onto the critical path.
 */
async function resolveStartRoute(): Promise<void> {
  if (!isTauri()) return
  const [, file] = await Promise.all([migrateProjects().catch(() => {}), activeProjectFile()])
  if (file) {
    // A `.dcsp` opened via the OS file association boots straight here without
    // going through openProject — record it in recents so Home and the
    // cross-project sweeps (which read recents as the registry) can see it.
    void rememberActiveProject(file)
    await router.navigate({
      to: '/projects/$projectId',
      params: { projectId: dirOf(file) },
      // A project window has no Home behind it — replacing keeps the start
      // location out of its history instead of leaving a recents entry to
      // navigate "back" to.
      replace: true,
    })
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
  // navigate() only commits the location; load() runs the destination route's
  // loader, so the first paint is the finished screen, not its pending state.
  await router.load()
}

void (async () => {
  // A boot hiccup must never leave a blank window: whatever happens above, the
  // router still mounts — at worst on the location the window started with.
  await resolveStartRoute().catch(() => {})
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
  await checkForUpdates()
  if (!isTauri()) return
  // Quiet housekeeping: age-out stale product-scan files so app-data can't grow
  // without bound. Fire-and-forget — never blocks or fails startup.
  void housekeepingSweep().catch(() => {})
  if (await isRefreshNeeded()) {
    void router.navigate({ to: '/tools', search: { tab: 'refresh' } })
  }
})()
