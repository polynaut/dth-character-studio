import { Tag } from '../index.ts'

export function Tones() {
  return (
    <div style={{ display: 'flex', gap: 8, padding: 16 }}>
      <Tag>Project</Tag>
      <Tag tone="green">Primary</Tag>
    </div>
  )
}
