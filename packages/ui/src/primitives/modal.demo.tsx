import { useState } from 'react'

import { Button, Input, Label, Modal } from '../index.ts'

export const height = 380

function Open({ children, ...props }: Partial<React.ComponentProps<typeof Modal>>) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <div style={{ padding: 16 }}><Button variant="outline" onClick={() => setOpen(true)}>Reopen</Button></div>
      <Modal open={open} onClose={() => setOpen(false)} title="New project" {...props}>
        {children}
      </Modal>
    </>
  )
}

export function Default() {
  return (
    <Open showClose>
      <Label htmlFor="m-name">Project name</Label>
      <Input id="m-name" defaultValue="Demo" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Button variant="outline">Cancel</Button>
        <Button>Create</Button>
      </div>
    </Open>
  )
}

export function Busy() {
  return (
    <Open dismissible={false} title="Generating Houdini project">
      <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Writing Kira.hip to D:/DTH Projects/Demo/Kira/houdini.</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="outline" disabled>Cancel</Button>
      </div>
    </Open>
  )
}
