import { useEffect, useState } from 'react'

import { scanDrift, type Drift } from '../lib/drift.ts'
import { loadSources } from '../lib/sources.ts'
import { s, Title } from '../lib/ui.tsx'

const KINDS: Drift['kind'][] = ['palette', 'arbitrary', 'hex', 'raw-control', 'duration']
const LABEL: Record<Drift['kind'], string> = {
  palette: 'Palette colors',
  arbitrary: 'Arbitrary values',
  hex: 'Hex literals',
  'raw-control': 'Raw controls',
  duration: 'One-off durations',
}

export function Audit() {
  const [hits, setHits] = useState<Drift[]>()
  useEffect(() => {
    // The kit is where raw controls belong: its primitives wrap them.
    void loadSources().then((files) =>
      setHits(scanDrift(files).filter((h) => !(h.kind === 'raw-control' && h.file.startsWith('packages/ui/')))),
    )
  }, [])
  if (!hits) return <Title>Scanning…</Title>
  const byFile = new Map<string, Drift[]>()
  for (const h of hits) byFile.set(h.file, [...(byFile.get(h.file) ?? []), h])
  const rows = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)
  const count = (list: Drift[], k: Drift['kind']) => list.filter((h) => h.kind === k).length
  return (
    <>
      <Title lead="Where product code bypasses the tokens and the kit. A static scan of *.tsx, excluding tests, demos and screens. It counts occurrences, not mistakes: a few are deliberate.">Drift audit</Title>
      <div style={s.grid}>
        {KINDS.map((k) => (
          <div key={k} style={s.card}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{count(hits, k)}</div>
            <div style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{LABEL[k]}</div>
          </div>
        ))}
      </div>
      <h2 style={s.h2}>{rows.length} files</h2>
      {rows.map(([file, list]) => (
        <details key={file} style={{ ...s.card, padding: '8px 12px', marginBottom: 6 }}>
          <summary style={{ cursor: 'pointer', display: 'flex', gap: 16, fontSize: 13 }}>
            <span style={{ ...s.mono, flex: 1 }}>{file}</span>
            {KINDS.map((k) => <span key={k} style={{ ...s.mono, width: 70, color: 'var(--muted-foreground)' }}>{count(list, k)} {k}</span>)}
          </summary>
          <div style={{ ...s.mono, marginTop: 8, display: 'grid', gridTemplateColumns: '48px 100px 1fr', gap: '2px 12px' }}>
            {list.flatMap((h, i) => [
              <span key={`${i}l`} style={{ color: 'var(--muted-foreground)' }}>{h.line}</span>,
              <span key={`${i}k`}>{h.kind}</span>,
              <span key={`${i}m`} style={{ wordBreak: 'break-all' }}>{h.match}</span>,
            ])}
          </div>
        </details>
      ))}
    </>
  )
}
