import { Plus } from 'lucide-react'

import { Button, Page, PageHeader, Section } from '../index.ts'

const pad = { padding: 16 } as const

export function SettingsSection() {
  return (
    <div style={pad}>
      <Page>
        <Section
          title="Daz installation"
          info="Reads the paths DAZ Install Manager already knows."
          description="Picked once instead of typed three times."
        >
          <p style={{ margin: 0 }}>D:/Daz 3D/Studio</p>
        </Section>
      </Page>
    </div>
  )
}

export function PlainSection() {
  return (
    <div style={pad}>
      <Page width="wide">
        <Section plain title="Range of Motion" description="Eight sections in canonical order.">
          <div style={{ border: '1px dashed var(--border)', padding: 24, color: 'var(--muted-foreground)' }}>
            Full-width ROM content for Kira
          </div>
        </Section>
      </Page>
    </div>
  )
}

export function HeaderWithActions() {
  return (
    <div style={pad}>
      <Page>
        <PageHeader
          title="Kira"
          description="D:/DTH Projects/Demo/Kira"
          actions={<Button size="sm" variant="outline"><Plus /> Add scene</Button>}
        />
      </Page>
    </div>
  )
}
