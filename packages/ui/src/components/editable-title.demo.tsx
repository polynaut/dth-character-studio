import { EditableTitle } from '../index.ts'

export function PageTitle() {
  return (
    <div style={{ padding: 16 }}>
      <EditableTitle name="Kira" onSave={() => {}} />
    </div>
  )
}

export function CardTitle() {
  return (
    <div style={{ padding: 16, maxWidth: 320 }}>
      <EditableTitle name="KiraDefault_G9_GP" as="div" subject="Scene" textClass="text-base font-medium" onSave={() => {}} />
    </div>
  )
}
