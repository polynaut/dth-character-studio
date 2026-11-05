import { Label, NumberField } from '../index.ts'

const col = { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, maxWidth: 200 } as const

export function Default() {
  return (
    <div style={col}>
      <Label>Start frame</Label>
      <NumberField value={0} onCommit={() => {}} />
    </div>
  )
}

export function Percent() {
  return (
    <div style={col}>
      <Label>Pose value</Label>
      <NumberField value={0.75} percent onCommit={() => {}} />
    </div>
  )
}

export function States() {
  return (
    <div style={col}>
      <NumberField value={24} suffix="fps" overridden onCommit={() => {}} />
      <NumberField value={24} suffix="fps" disabled onCommit={() => {}} />
    </div>
  )
}
