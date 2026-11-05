import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/manrope/index.css'
import './frame.css'

import { installTauriMock, type TauriMockSeed } from '../smoke/tauri-mock.ts'
import { screenModules } from './screens.ts'

const demoModules = import.meta.glob('../../../packages/ui/src/**/*.demo.tsx')

const rootEl = document.getElementById('root') as HTMLElement

function showError(e: unknown) {
  const pre = document.createElement('pre')
  pre.setAttribute('data-screen-error', '')
  pre.textContent = e instanceof Error ? (e.stack ?? e.message) : String(e)
  document.body.replaceChildren(pre)
  document.documentElement.setAttribute('data-ready', '')
}

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) {
    return { error }
  }
  componentDidCatch(error: unknown, _info: ErrorInfo) {
    showError(error)
  }
  render() {
    return this.state.error ? null : this.props.children
  }
}

const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))

async function bootScreen(moduleKey: string, id: string) {
  const load = screenModules[moduleKey]
  if (!load) throw new Error(`No screens module "${moduleKey}"`)
  const screen = (await load()).default.screens.find((s) => s.id === id)
  if (!screen) throw new Error(`No screen "${id}" in ${moduleKey}`)

  const res = await fetch(`/__seed?opts=${encodeURIComponent(JSON.stringify(screen.seed ?? {}))}`)
  if (!res.ok) throw new Error(`/__seed failed: ${await res.text()}`)
  const seed = (await res.json()) as TauriMockSeed
  screen.tune?.(seed)
  installTauriMock(seed)
  ;(window as unknown as { __dthHideDevtools?: boolean }).__dthHideDevtools = true

  const { RouterProvider, createRouter, createMemoryHistory } =
    await import('@tanstack/react-router')
  const { routeTree } = await import('#/routeTree.gen.ts')
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [screen.route] }),
  })
  createRoot(rootEl).render(
    <StrictMode>
      <Boundary>
        <RouterProvider router={router} />
      </Boundary>
    </StrictMode>,
  )

  await router.load()
  await settle()
  // RootErrorComponent swallows loader/render errors into normal-looking UI.
  const failed = router.state.matches.find((m) => m.status === 'error')
  if (failed) throw failed.error
  await screen.drive?.(rootEl)
  await settle()
}

async function bootDemo(moduleKey: string, exportName: string) {
  const load = demoModules[moduleKey]
  if (!load) throw new Error(`No demo module "${moduleKey}"`)
  const Demo = ((await load()) as Record<string, React.ComponentType>)[exportName]
  if (!Demo) throw new Error(`No export "${exportName}" in ${moduleKey}`)
  createRoot(rootEl).render(
    <StrictMode>
      <Boundary>
        <Demo />
      </Boundary>
    </StrictMode>,
  )
  await settle()
}

window.addEventListener('error', (e) => showError(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => showError(e.reason))

const q = new URLSearchParams(location.search)
void (async () => {
  try {
    if (q.has('fail')) throw new Error('deliberate failure (?fail=1)')
    if (q.has('demo')) await bootDemo(q.get('demo') ?? '', q.get('export') ?? 'default')
    else await bootScreen(q.get('module') ?? '', q.get('screen') ?? '')
    document.documentElement.setAttribute('data-ready', '')
  } catch (e) {
    showError(e)
  }
})()
