import { useEffect, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/manrope/index.css'
import '#/styles.css'

import { screenModules } from './screens.ts'
import { demoFile, s, type DemoMeta, type Manifest } from './lib/ui.tsx'
import { Audit } from './pages/audit.tsx'
import { ComponentPage } from './pages/components.tsx'
import { Color, Icons, Shape, Space, Type } from './pages/foundations.tsx'
import { Overview } from './pages/overview.tsx'
import { Patterns } from './pages/patterns.tsx'
import { ScreenPage } from './pages/screens.tsx'

const demoModules = import.meta.glob<Record<string, unknown>>(
  '../../../packages/ui/src/**/*.demo.tsx',
)

async function buildManifest(): Promise<Manifest> {
  const screens = (
    await Promise.all(
      Object.entries(screenModules).map(async ([module, load]) =>
        (await load()).default.screens.map((sc) => ({
          module,
          id: sc.id,
          title: sc.title,
          description: sc.description,
          route: sc.route,
          width: sc.width,
          height: sc.height,
        })),
      ),
    )
  ).flat()
  const demos = (
    await Promise.all(
      Object.entries(demoModules).map(async ([module, load]) => {
        const mod = await load()
        const height = typeof mod.height === 'number' ? mod.height : undefined
        return Object.entries(mod)
          .filter(([, v]) => typeof v === 'function')
          .map(([name]): DemoMeta => ({ module, export: name, height }))
      }),
    )
  ).flat()
  return { screens, demos }
}

const group = (label: string) => (
  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted-foreground)', margin: '20px 0 6px' }}>{label}</div>
)

function Nav({ page, m }: { page: string; m: Manifest }) {
  const link = (id: string, label: string) => (
    <a
      key={id}
      href={`#/${id}`}
      style={{
        display: 'block',
        padding: '4px 10px',
        borderRadius: 'var(--radius)',
        fontSize: 13,
        color: page === id ? 'var(--primary)' : 'var(--foreground)',
        background: page === id ? 'var(--accent)' : 'transparent',
        textDecoration: 'none',
      }}
    >
      {label}
    </a>
  )
  const files = [...new Set(m.demos.map((d) => demoFile(d.module)))].sort()
  return (
    <nav style={{ width: 220, flexShrink: 0, padding: 16, borderRight: '1px solid var(--border)', overflowY: 'auto', position: 'sticky', top: 0, height: '100vh', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>DTH design system</div>
      {link('overview', 'Overview')}
      {group('Foundations')}
      {link('color', 'Color')}
      {link('type', 'Type')}
      {link('space', 'Space')}
      {link('shape', 'Shape')}
      {link('icons', 'Icons')}
      {group('Components')}
      {files.map((f) => link(`components/${f}`, f))}
      {group('Patterns')}
      {link('patterns', 'Patterns')}
      {group('Screens')}
      {m.screens.map((sc) => link(`screens/${sc.id}`, sc.title))}
      {group('Audit')}
      {link('audit', 'Drift audit')}
    </nav>
  )
}

function Content({ page, m }: { page: string; m: Manifest }) {
  const [kind, id = ''] = page.split('/')
  const pages: Record<string, ComponentType<{ m: Manifest }>> = {
    overview: Overview,
    color: Color,
    type: Type,
    space: Space,
    shape: Shape,
    icons: Icons,
    patterns: Patterns,
    audit: Audit,
  }
  if (kind === 'components') return <ComponentPage file={id} m={m} />
  if (kind === 'screens') return <ScreenPage id={id} m={m} />
  const P = pages[kind] ?? Overview
  return <P m={m} />
}

function Site() {
  const [m, setM] = useState<Manifest>()
  const [error, setError] = useState<string>()
  const [page, setPage] = useState(() => location.hash.slice(2) || 'overview')
  useEffect(() => {
    const on = () => setPage(location.hash.slice(2) || 'overview')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  useEffect(() => {
    buildManifest().then(
      (built) => {
        ;(window as unknown as { __dsManifest: Manifest }).__dsManifest = built
        setM(built)
        document.documentElement.setAttribute('data-ready', '')
      },
      (e: unknown) => {
        const message = e instanceof Error ? (e.stack ?? e.message) : String(e)
        setError(message)
        document.documentElement.setAttribute('data-ready', '')
        document.documentElement.setAttribute('data-manifest-error', message)
      },
    )
  }, [])
  if (error) return <pre style={{ ...s.mono, color: 'var(--destructive-text)', padding: 24 }}>{error}</pre>
  if (!m) return <p style={{ ...s.p, padding: 24 }}>Loading…</p>
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', minHeight: '100vh' }}>
      <Nav page={page} m={m} />
      <main style={{ flex: 1, minWidth: 0, padding: '32px 40px 80px' }}>
        <Content page={page} m={m} />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Site />)
