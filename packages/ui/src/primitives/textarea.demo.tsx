import { Textarea } from '../index.ts'

const col = { padding: 16, maxWidth: 420 } as const

export function Default() {
  return (
    <div style={col}>
      <Textarea defaultValue={'Kira, Genesis 9.\nOutfit scene links to KiraSummertide_G9_GP.duf.'} rows={4} />
    </div>
  )
}

export function Empty() {
  return (
    <div style={col}>
      <Textarea placeholder="Notes for this character" rows={3} />
    </div>
  )
}

export function Disabled() {
  return (
    <div style={col}>
      <Textarea defaultValue="Locked while the export runs." disabled rows={2} />
    </div>
  )
}
