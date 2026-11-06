import { InfoPopup, Input, Label } from '../index.ts'

const col = { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, maxWidth: 360 } as const

export function Default() {
  return (
    <div style={col}>
      <Label htmlFor="l-scene">Daz scene</Label>
      <Input id="l-scene" defaultValue="KiraDefault_G9_GP.duf" />
    </div>
  )
}

export function WithInfo() {
  return (
    <div style={col}>
      <Label htmlFor="l-export">
        Export directory
        <InfoPopup>Derived from the project: <strong>D:/DTH Projects/Demo/Kira/houdini/daz-export</strong></InfoPopup>
      </Label>
      <Input id="l-export" defaultValue="D:/DTH Projects/Demo/Kira/houdini/daz-export" readOnly />
    </div>
  )
}
