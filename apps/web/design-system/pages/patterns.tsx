import { demoFile, demoUrl, s, Frame, Title, type Manifest } from '../lib/ui.tsx'

const SECTIONS = [
  { file: 'page', export: 'SettingsSection', title: 'A settings section', text: 'A titled card with a short description and its controls. Settings and Tools build every group this way, so a new group is a Section, not a new card.' },
  { file: 'side-panel', export: 'WithFooter', title: 'A side panel', text: 'A working surface with lists and several sections is a drawer. Its confirm row goes in the footer prop, so it stays at the bottom and never scrolls away. A one-question confirm stays a Modal.' },
  { file: 'tool-card', export: 'SideBySideFlex', title: 'Tool cards side by side', text: 'Cards in a flex row keep their own heights, tone and state. The tone names the tool (Daz, Houdini, Unreal); the state says whether it needs attention.' },
]

const BUTTONS: [string, string][] = [
  ['default', 'The single affirmative action of a surface: Save, Create, Generate ROM. One per view.'],
  ['secondary', 'A real alternative that is not the main path: Open in Houdini.'],
  ['outline', 'A bordered control beside a field or inside a card: Browse, Locate, Retry.'],
  ['ghost', 'Cancel in a modal or drawer footer, first and left of the primary, and any tertiary inline action: Show log, Open on a card.'],
  ['outline-destructive', 'A destructive action that is not the final confirmation: Clear, Unlink.'],
  ['destructive', 'The final confirmation of an irreversible action: Delete Kira. Never the first thing a user sees.'],
]

export function Patterns({ m }: { m: Manifest }) {
  return (
    <>
      <Title lead="How the kit components combine. Each example is a real demo, so it can't drift from the kit.">Patterns</Title>
      {SECTIONS.map((p) => {
        const d = m.demos.find((x) => demoFile(x.module) === p.file && x.export === p.export)
        return (
          <section key={p.title}>
            <h2 style={s.h2}>{p.title}</h2>
            <p style={s.p}>{p.text}</p>
            {d ? <Frame src={demoUrl(d)} title={p.title} height={d.height} /> : <p style={s.p}>Demo {p.file}.{p.export} is missing.</p>}
          </section>
        )
      })}
      <h2 style={s.h2}>Which button</h2>
      <div style={{ ...s.card, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 24px', fontSize: 13 }}>
        {BUTTONS.flatMap(([v, text]) => [
          <code key={v} style={s.mono}>{v}</code>,
          <span key={`${v}t`} style={{ color: 'var(--muted-foreground)' }}>{text}</span>,
        ])}
      </div>
    </>
  )
}
