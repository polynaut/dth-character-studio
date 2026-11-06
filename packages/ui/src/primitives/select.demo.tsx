import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../index.ts'

export const height = 260

const col = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxWidth: 280 } as const

const genesis = ['Genesis 9', 'Genesis 8.1', 'Genesis 8']

function Picker({ size, disabled }: { size?: 'sm' | 'default'; disabled?: boolean }) {
  return (
    <Select defaultValue="Genesis 9" disabled={disabled}>
      <SelectTrigger size={size} aria-label="Genesis generation">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {genesis.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function Default() {
  return <div style={col}><Picker /></div>
}

export function SmallAndDisabled() {
  return <div style={col}><Picker size="sm" /><Picker disabled /></div>
}

export function Open() {
  return (
    <div style={col}>
      <Select defaultValue="Genesis 9" defaultOpen>
        <SelectTrigger aria-label="Genesis generation"><SelectValue /></SelectTrigger>
        <SelectContent>
          {genesis.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  )
}
