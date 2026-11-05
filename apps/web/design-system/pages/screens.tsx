import { s, screenUrl, Title, useWidth, type Manifest } from '../lib/ui.tsx'

export function ScreenPage({ id, m }: { id: string; m: Manifest }) {
  const [ref, w] = useWidth()
  const sc = m.screens.find((x) => x.id === id)
  if (!sc) return <Title>No screen {id}</Title>
  const [sw, sh] = [sc.width ?? 1280, sc.height ?? 720]
  const scale = w > 0 ? Math.min(1, w / sw) : 1
  return (
    <>
      <Title lead={sc.description ?? `Route ${decodeURIComponent(sc.route)}`}>{sc.title}</Title>
      <p style={{ ...s.p, ...s.mono }}>
        {sw}x{sh} at {Math.round(scale * 100)}% <a style={s.link} href={screenUrl(sc)} target="_blank" rel="noreferrer">Open</a>
      </p>
      <div ref={ref} style={{ width: '100%', height: sh * scale }}>
        <iframe
          src={screenUrl(sc)}
          title={sc.title}
          // Our own dev-only frames: they need scripts and same-origin (seed fetch, height measure).
          // oxlint-disable-next-line react/iframe-missing-sandbox
          sandbox="allow-same-origin allow-scripts allow-forms"
          style={{ width: sw, height: sh, border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--background)', transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      </div>
    </>
  )
}
