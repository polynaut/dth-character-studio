import { useEffect, useState } from 'react'

import { loadSources } from '../lib/sources.ts'
import { demoFile, s, Title, type Manifest } from '../lib/ui.tsx'

// Mounted once at the app root and driven by `title` attributes, so there is nothing to render in a frame.
const NO_DEMO = new Set(['tooltip-host'])

const routeRegex = (file: string) => {
  const parts = file.replace(/\.tsx$/, '').split('.').filter((p) => !['index', '__root'].includes(p))
  return new RegExp(`^/${parts.map((p) => (p.startsWith('$') ? '[^/]+' : p)).join('/')}$`.replace('//', '/'))
}

export function Overview({ m }: { m: Manifest }) {
  const [files, setFiles] = useState<string[]>()
  useEffect(() => {
    void loadSources().then((f) => setFiles(Object.keys(f)))
  }, [])
  const kit = (files ?? [])
    .map((f) => /packages\/ui\/src\/(?:primitives|components)\/([^/]+)\.tsx$/.exec(f)?.[1])
    .filter((n): n is string => Boolean(n))
  const demoed = new Set(m.demos.map((d) => demoFile(d.module)))
  const missingDemos = kit.filter((n) => !demoed.has(n) && !NO_DEMO.has(n))
  const routes = (files ?? [])
    .map((f) => /apps\/web\/src\/routes\/([^/]+)\.tsx$/.exec(f)?.[1])
    .filter((n): n is string => Boolean(n) && n !== '__root')
  const paths = m.screens.map((sc) => sc.route)
  const missingScreens = routes.filter((r) => !paths.some((p) => routeRegex(r).test(p)))
  const stat = (n: number | string, label: string) => (
    <div style={s.card}>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{n}</div>
      <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{label}</div>
    </div>
  )
  const gap = (title: string, list: string[]) => (
    <>
      <h2 style={s.h2}>{title}</h2>
      <p style={s.p}>{!files ? 'Scanning…' : list.length === 0 ? 'None. Every one is covered.' : list.join(', ')}</p>
    </>
  )
  return (
    <>
      <Title lead="A dev-only catalog of what the app is built from. Everything here renders the real kit and the real screens, so it can't drift from them.">DTH design system</Title>
      <div style={s.grid}>
        {stat(m.demos.length, 'demos')}
        {stat(demoed.size, 'kit components with demos')}
        {stat(m.screens.length, 'screens')}
        {stat(kit.length || '…', 'kit component files')}
      </div>
      {gap('Kit components without a demo', missingDemos)}
      {gap('Routes without a screen', missingScreens)}
    </>
  )
}
