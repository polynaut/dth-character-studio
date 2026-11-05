import { useEffect, useState } from 'react'
import * as Lucide from 'lucide-react'

import css from '#/styles.css?raw'

import { contrast, parseTokens } from '../lib/tokens.ts'
import { loadSources } from '../lib/sources.ts'
import { s, Title } from '../lib/ui.tsx'

const tokens = parseTokens(css)
const isColor = (v: string) => /^#[0-9a-f]{3,8}$/i.test(v)

const GROUPS: [string, RegExp][] = [
  ['Surfaces', /^(background|card|popover|muted|accent|secondary|sidebar)$/],
  ['Actions', /^(primary|destructive|ring|sidebar-primary|sidebar-ring)$/],
  ['Status', /^(warning|success|info|destructive)(-|$)/],
  ['Brand', /^(daz-green|houdini-orange|unreal-blue)$/],
  ['Chart', /^chart-/],
  ['Text', /foreground/],
  ['Lines', /^(border|input|sidebar-border)$/],
]

const groupOf = (name: string) => GROUPS.find(([, re]) => re.test(name))?.[0] ?? 'Other'

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ ...s.card, padding: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
      <div style={{ width: 36, height: 36, borderRadius: 6, background: `var(--${name})`, border: '1px solid var(--border)', flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ ...s.mono, fontWeight: 600 }}>--{name}</div>
        <div style={{ ...s.mono, color: 'var(--muted-foreground)' }}>{value}</div>
      </div>
    </div>
  )
}

const PAIRS: [string, string[]][] = [
  ['warning', ['background', 'card', 'warning-subtle']],
  ['success', ['background', 'card', 'success-subtle']],
  ['info', ['background', 'card', 'info-subtle']],
  ['destructive-text', ['background', 'card', 'destructive-subtle']],
]

export function Color() {
  const colors = Object.entries(tokens).filter(([, v]) => isColor(v))
  const groups = [...GROUPS.map(([g]) => g), 'Other']
  return (
    <>
      <Title lead="Every swatch is read from :root in styles.css. Change a token there and this page follows.">Color</Title>
      {groups.map((g) => {
        const rows = colors.filter(([n]) => groupOf(n) === g)
        return rows.length === 0 ? null : (
          <section key={g}>
            <h2 style={s.h2}>{g}</h2>
            <div style={s.grid}>{rows.map(([n, v]) => <Swatch key={n} name={n} value={v} />)}</div>
          </section>
        )
      })}
      <h2 style={s.h2}>Status text contrast</h2>
      <p style={s.p}>WCAG AA needs 4.5:1 for body text. Each status color is checked on the page, the card and its own subtle fill.</p>
      <div style={{ ...s.card, display: 'grid', gridTemplateColumns: 'repeat(4, auto)', gap: '8px 24px', width: 'fit-content', fontSize: 13 }}>
        <b>Text</b><b>on</b><b>Ratio</b><b>AA</b>
        {PAIRS.flatMap(([fg, bgs]) =>
          bgs.map((bg) => {
            const ratio = contrast(tokens[fg], tokens[bg])
            return [
              <span key={`${fg}${bg}a`} style={{ ...s.mono, color: `var(--${fg})` }}>--{fg}</span>,
              <span key={`${fg}${bg}b`} style={s.mono}>--{bg}</span>,
              <span key={`${fg}${bg}c`} style={s.mono}>{ratio.toFixed(2)}</span>,
              <span key={`${fg}${bg}d`} style={{ color: ratio >= 4.5 ? 'var(--success)' : 'var(--destructive-text)' }}>{ratio >= 4.5 ? 'pass' : 'fail'}</span>,
            ]
          }),
        )}
      </div>
    </>
  )
}

function useUsage(re: RegExp) {
  const [counts, setCounts] = useState<Record<string, number>>()
  useEffect(() => {
    void loadSources().then((files) => {
      const out: Record<string, number> = {}
      for (const src of Object.values(files)) for (const m of src.matchAll(re)) out[m[1]] = (out[m[1]] ?? 0) + 1
      setCounts(out)
    })
  }, [re])
  return counts
}

const SIZES: [string, number][] = [['xs', 12], ['sm', 14], ['base', 16], ['lg', 18], ['xl', 20], ['2xl', 24], ['3xl', 30]]
const SIZE_USE = /(?<![\w-])text-(xs|sm|base|lg|xl|2xl|3xl)(?![\w-])/g

export function Type() {
  const use = useUsage(SIZE_USE)
  return (
    <>
      <Title lead="Manrope Variable, self-hosted. Sizes are Tailwind's default scale; the counts are how often each class appears in product code.">Type</Title>
      <div style={s.card}>
        {SIZES.map(([name, px]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'baseline', gap: 16, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ ...s.mono, width: 90, color: 'var(--muted-foreground)' }}>text-{name} {px}px</span>
            <span style={{ fontSize: px, flex: 1 }}>Kira, Genesis 9, 1,240 frames</span>
            <span style={{ ...s.mono, color: 'var(--muted-foreground)' }}>{use ? (use[name] ?? 0) : '…'} uses</span>
          </div>
        ))}
      </div>
      <h2 style={s.h2}>Weights</h2>
      <div style={{ ...s.card, display: 'flex', gap: 32, fontSize: 18 }}>
        {[400, 500, 600, 700].map((w) => <span key={w} style={{ fontWeight: w }}>{w} Range of Motion</span>)}
      </div>
    </>
  )
}

const STEPS: [string, number][] = [['0.5', 2], ['1', 4], ['1.5', 6], ['2', 8], ['3', 12], ['4', 16], ['5', 20], ['6', 24], ['8', 32]]
const RECOMMENDED = ['gap-1', 'gap-2', 'gap-3', 'p-3', 'p-5']
const SPACE_USE = /(?<![\w-])(?:p|px|py|pt|pb|pl|pr|m|mx|my|gap|space-x|space-y)-(0\.5|1\.5|1|2|3|4|5|6|8)(?![\w.-])/g

export function Space() {
  const use = useUsage(SPACE_USE)
  return (
    <>
      <Title lead="Tailwind's 4px scale; no custom spacing tokens. The counts are how often each step appears in padding, margin and gap classes in product code.">Space</Title>
      <div style={s.card}>
        {STEPS.map(([name, px]) => (
          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span style={{ ...s.mono, width: 90, color: 'var(--muted-foreground)' }}>{name} {px}px</span>
            <div style={{ flex: 1 }}>
              <div style={{ width: px, height: 12, background: 'var(--primary)', borderRadius: 2 }} />
            </div>
            <span style={{ ...s.mono, color: 'var(--muted-foreground)' }}>{use ? (use[name] ?? 0) : '…'} uses</span>
          </div>
        ))}
      </div>
      <h2 style={s.h2}>Which steps to use</h2>
      <p style={s.p}>
        Most product spacing is {RECOMMENDED.map((c, i) => <span key={c}>{i > 0 && ', '}<span style={s.mono}>{c}</span></span>)}.
        Reach for those first; use another step only when the layout needs it.
      </p>
    </>
  )
}

const RADII = [...css.matchAll(/--radius-(\w+):\s*([^;]+);/g)].map((m) => [m[1], m[2]] as const)
const ROUNDED_USE = /(?<![\w-])rounded-(none|sm|md|lg|xl|2xl|full)(?![\w-])/g

export function Shape() {
  const use = useUsage(ROUNDED_USE)
  return (
    <>
      <Title lead={`One base radius, --radius: ${tokens.radius}. The steps are derived from it.`}>Shape</Title>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {RADII.map(([name, value]) => (
          <div key={name} style={{ ...s.card, width: 160 }}>
            <div style={{ height: 64, background: 'var(--secondary)', borderRadius: value, marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>radius-{name}</div>
            <div style={{ ...s.mono, color: 'var(--muted-foreground)' }}>{value}</div>
            <div style={{ ...s.mono, color: 'var(--muted-foreground)' }}>{use ? (use[name] ?? 0) : '…'} rounded-{name}</div>
          </div>
        ))}
      </div>
      {use && <p style={{ ...s.p, marginTop: 16 }}>Also in product code: rounded-full {use.full ?? 0}, rounded-2xl {use['2xl'] ?? 0}, rounded-none {use.none ?? 0}.</p>}
    </>
  )
}

const LUCIDE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g

export function Icons() {
  const [counts, setCounts] = useState<[string, number][]>()
  useEffect(() => {
    void loadSources().then((files) => {
      const out: Record<string, number> = {}
      for (const src of Object.values(files))
        for (const m of src.matchAll(LUCIDE_IMPORT))
          for (const part of m[1].split(',')) {
            const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]
            if (name) out[name] = (out[name] ?? 0) + 1
          }
      setCounts(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
    })
  }, [])
  const lib = Lucide as unknown as Record<string, React.ComponentType<{ size?: number }>>
  return (
    <>
      <Title lead="lucide-react, the only icon set. The count is the number of files importing each icon.">Icons</Title>
      <div style={s.grid}>
        {counts?.map(([name, n]) => {
          const Icon = lib[name]
          return (
            <div key={name} style={{ ...s.card, padding: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
              {Icon ? <Icon size={20} /> : <span style={{ width: 20 }} />}
              <span style={{ fontSize: 12, flex: 1 }}>{name}</span>
              <span style={{ ...s.mono, color: 'var(--muted-foreground)' }}>{n}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}
