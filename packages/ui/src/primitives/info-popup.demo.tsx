import { InfoPopup } from '../index.ts'

export const height = 200

const row = { display: 'flex', alignItems: 'center', gap: 8, padding: 16, fontSize: 14 } as const

export function Default() {
  return (
    <div style={row}>
      Export directory
      <InfoPopup>Fixed at <strong>houdini/daz-export</strong> inside the character folder.</InfoPopup>
    </div>
  )
}

export function Sizes() {
  return (
    <div style={row}>
      <InfoPopup size="xs">Extra small</InfoPopup>
      <InfoPopup size="sm">Small</InfoPopup>
      <InfoPopup size="md">Medium</InfoPopup>
    </div>
  )
}
