import { Label, Switch } from '../index.ts'

const row = { display: 'flex', alignItems: 'center', gap: 8 } as const
const col = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16 } as const

export function Variants() {
  return (
    <div style={col}>
      <div style={row}><Switch id="s1" defaultChecked /><Label htmlFor="s1">Hair items export with DTH Export</Label></div>
      <div style={row}><Switch id="s2" /><Label htmlFor="s2">Install scripts on save</Label></div>
      <div style={row}><Switch id="s3" variant="green" defaultChecked /><Label htmlFor="s3">Overridden for KiraSummertide</Label></div>
      <div style={row}><Switch id="s4" variant="green" /><Label htmlFor="s4">Not overridden</Label></div>
    </div>
  )
}

export function SizesAndDisabled() {
  return (
    <div style={col}>
      <div style={row}><Switch size="sm" defaultChecked aria-label="Small on" /><Switch size="sm" aria-label="Small off" /></div>
      <div style={row}><Switch disabled defaultChecked aria-label="Disabled on" /><Switch disabled aria-label="Disabled off" /></div>
    </div>
  )
}
