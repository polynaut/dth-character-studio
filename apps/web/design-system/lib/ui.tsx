import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export type ScreenMeta = {
  module: string
  id: string
  title: string
  description?: string
  route: string
  width?: number
  height?: number
}
export type DemoMeta = { module: string; export: string; height?: number }
export type Manifest = { screens: ScreenMeta[]; demos: DemoMeta[] }

export const demoFile = (module: string) => /([^/]+)\.demo\.tsx$/.exec(module)?.[1] ?? module
export const frameUrl = (q: Record<string, string>) => `/frame.html?${new URLSearchParams(q)}`
export const demoUrl = (d: DemoMeta) => frameUrl({ demo: d.module, export: d.export })
export const screenUrl = (s: ScreenMeta) => frameUrl({ module: s.module, screen: s.id })
export const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ')

export const s = {
  h1: { fontSize: 28, fontWeight: 700, margin: '0 0 8px' },
  h2: { fontSize: 18, fontWeight: 600, margin: '32px 0 12px' },
  p: { color: 'var(--muted-foreground)', fontSize: 14, lineHeight: 1.6, margin: '0 0 12px', maxWidth: 720 },
  card: { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 },
  mono: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 },
  link: { color: 'var(--info)', fontSize: 12 },
} satisfies Record<string, CSSProperties>

export function Title({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <>
      <h1 style={s.h1}>{children}</h1>
      {lead && <p style={s.p}>{lead}</p>}
    </>
  )
}

/** One screen or demo, same-origin so the page can read the frame's height once it is ready. */
export function Frame({ src, title, height }: { src: string; title: string; height?: number }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [h, setH] = useState(height ?? 120)
  const [loaded, setLoaded] = useState(false)
  // Starts at onLoad, not mount: a lazy frame below the fold loads only when scrolled near.
  useEffect(() => {
    if (height || !loaded) return
    let ticks = 0
    const id = setInterval(() => {
      const doc = ref.current?.contentDocument?.documentElement
      if (doc?.hasAttribute('data-ready')) setH(Math.max(80, doc.scrollHeight))
      if (++ticks > 20) clearInterval(id)
    }, 300)
    return () => clearInterval(id)
  }, [height, loaded])
  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      loading="lazy"
      onLoad={() => setLoaded(true)}
      // Our own dev-only frames: they need scripts and same-origin (seed fetch, height measure).
      // oxlint-disable-next-line react/iframe-missing-sandbox
      sandbox="allow-same-origin allow-scripts allow-forms"
      style={{ width: '100%', height: height ?? h, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--background)' }}
    />
  )
}

export function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
