import { Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../index.ts'

const col = { display: 'flex', flexDirection: 'column', gap: 16, padding: 16, maxWidth: 360 } as const

export function Default() {
  return (
    <div style={col}>
      <Field label="Character name"><Input defaultValue="Kira" /></Field>
    </div>
  )
}

export function WithError() {
  return (
    <div style={col}>
      <Field label="Project folder" error="D:/DTH Projects/Demo already contains a project."><Input defaultValue="D:/DTH Projects/Demo" /></Field>
    </div>
  )
}

export function WithSelect() {
  return (
    <div style={col}>
      <Field label="Genesis" controlId="f-genesis">
        <Select defaultValue="G9">
          <SelectTrigger id="f-genesis"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="G9">Genesis 9</SelectItem><SelectItem value="G8">Genesis 8</SelectItem></SelectContent>
        </Select>
      </Field>
    </div>
  )
}
