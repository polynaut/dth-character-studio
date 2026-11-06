import { useState } from 'react'

import { MultiSelect } from '../index.ts'

export const height = 300

const options = ['Kira Hair', 'Kira Lashes', 'Summertide Dress', 'High Boots', 'Yoga Pants']

function Demo({ initial, ...rest }: { initial: string[] } & Partial<React.ComponentProps<typeof MultiSelect>>) {
  const [values, setValues] = useState(initial)
  return (
    <div style={{ padding: 16, maxWidth: 420 }}>
      <MultiSelect values={values} options={options} onChange={setValues} placeholder="Add hair item" {...rest} />
    </div>
  )
}

export function Default() {
  return <Demo initial={['Kira Hair']} />
}

export function WarningAndCustom() {
  return <Demo initial={['Kira Hair', 'Old Ponytail']} allowCustom pillWarning={(v) => (options.includes(v) ? null : 'Not in the scene')} />
}

export function Overridden() {
  return <Demo initial={['Kira Lashes']} overridden />
}

export function Disabled() {
  return <Demo initial={['Kira Hair']} disabled />
}
