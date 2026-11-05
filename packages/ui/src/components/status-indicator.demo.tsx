import { StatusIndicator } from '../index.ts'

export function Default() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: 16 }}>
      <StatusIndicator tone="success">Active</StatusIndicator>
      <StatusIndicator tone="warning">differs</StatusIndicator>
      <StatusIndicator tone="error">Export failed</StatusIndicator>
      <StatusIndicator tone="info">Scanning</StatusIndicator>
      <StatusIndicator tone="neutral">matches</StatusIndicator>
    </div>
  )
}
