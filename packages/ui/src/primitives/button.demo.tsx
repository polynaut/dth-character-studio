import { Download, FolderOpen, Trash2 } from 'lucide-react'

import { Button } from '../index.ts'

const row = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12', padding: 16 } as const
const col = { display: 'flex', flexDirection: 'column', gap: 12 } as const
const label = { color: 'var(--muted-foreground)', fontSize: 12 } as const

export function Variants() {
  return (
    <div style={row}>
      <Button>Generate ROM</Button>
      <Button variant="secondary">Open in Houdini</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="ghost">Show log</Button>
      <Button variant="outline-destructive">Clear</Button>
      <Button variant="destructive">Delete Kira</Button>
    </div>
  )
}

export function Sizes() {
  return (
    <div style={row}>
      <Button size="xs">Browse</Button>
      <Button size="sm">Browse</Button>
      <Button>Browse</Button>
      <Button size="lg">Browse</Button>
      <Button size="icon-xs" variant="outline" aria-label="Remove"><Trash2 /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Remove"><Trash2 /></Button>
      <Button size="icon" variant="outline" aria-label="Remove"><Trash2 /></Button>
    </div>
  )
}

export function Disabled() {
  return (
    <div style={{ ...col, padding: 16 }}>
      <span style={label}>Enabled</span>
      <div style={{ ...row, padding: 0 }}>
        <Button>Save</Button>
        <Button variant="secondary">Open in Houdini</Button>
        <Button variant="outline">Cancel</Button>
        <Button variant="ghost">Show log</Button>
        <Button variant="outline-destructive">Clear</Button>
        <Button variant="destructive">Delete Kira</Button>
      </div>
      <span style={label}>Disabled</span>
      <div style={{ ...row, padding: 0 }}>
        <Button disabled>Saved</Button>
        <Button variant="secondary" disabled>Open in Houdini</Button>
        <Button variant="outline" disabled>Cancel</Button>
        <Button variant="ghost" disabled>Show log</Button>
        <Button variant="outline-destructive" disabled>Clear</Button>
        <Button variant="destructive" disabled>Delete Kira</Button>
      </div>
    </div>
  )
}

export function WithIcon() {
  return (
    <div style={row}>
      <Button><Download /> Export CSV</Button>
      <Button variant="outline"><FolderOpen /> D:/DTH Projects/Demo</Button>
      <Button variant="outline" size="sm"><FolderOpen /> Houdini 22.0.368</Button>
      <Button variant="outline-destructive" size="xs"><Trash2 /> Clear</Button>
    </div>
  )
}
