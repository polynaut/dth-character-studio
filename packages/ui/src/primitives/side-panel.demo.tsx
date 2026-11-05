import { useState } from 'react'

import { Button, Input, Label, SidePanel } from '../index.ts'

export const height = 420

function Panel({ footer, ...props }: Partial<React.ComponentProps<typeof SidePanel>>) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <div style={{ padding: 16 }}><Button variant="outline" onClick={() => setOpen(true)}>Utils</Button></div>
      <SidePanel open={open} title="Utils: Kira" onClose={() => setOpen(false)} footer={footer} {...props}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label htmlFor="sp-job">Project folder ($JOB)</Label>
          <Input id="sp-job" defaultValue="D:/DTH Projects/Demo/Kira/houdini/daz-export" readOnly />
          <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Scanned with Houdini 22.0.368.</p>
        </div>
      </SidePanel>
    </>
  )
}

export function Default() {
  return <Panel />
}

export function WithFooter() {
  return (
    <Panel
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: 12 }}>
          <Button variant="ghost">Cancel</Button>
          <Button>Apply</Button>
        </div>
      }
    />
  )
}
