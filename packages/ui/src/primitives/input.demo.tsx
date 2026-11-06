import { Input, Label } from '../index.ts'

const col = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxWidth: 360 } as const

export function States() {
  return (
    <div style={col}>
      <Label htmlFor="i-name">Character name</Label>
      <Input id="i-name" defaultValue="Kira" />
      <Input placeholder="D:/DTH Projects/Demo" />
      <Input defaultValue="Kira_ROM.hip" disabled />
      <Input defaultValue="Kira?" aria-invalid />
    </div>
  )
}

export function Overridden() {
  return (
    <div style={col}>
      <Input defaultValue="Houdini 22.0.368" overridden />
    </div>
  )
}
