import { Label, NumberField, OverrideMark, overrideLabelClass } from '../index.ts'

export function Overridden() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, maxWidth: 240 }}>
      <Label className={overrideLabelClass(true, true)}>
        Pose value <OverrideMark overridden onReset={() => {}} />
      </Label>
      <NumberField value={0.5} percent overridden onCommit={() => {}} />
    </div>
  )
}

export function Inherited() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, maxWidth: 240 }}>
      <Label className={overrideLabelClass(false, true)}>
        Pose value <OverrideMark overridden={false} onReset={() => {}} />
      </Label>
      <NumberField value={1} percent onCommit={() => {}} />
    </div>
  )
}
