import { Button, Notice } from '../index.ts'

const col = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxWidth: 560 } as const

export function Tones() {
  return (
    <div style={col}>
      <Notice tone="success" title="Export finished">Kira was written to D:/DTH Projects/Demo/Kira.</Notice>
      <Notice tone="warning" title="Houdini path differs">The saved path points at another install.</Notice>
      <Notice tone="error" title="Export failed">hython.exe exited with code 1.</Notice>
      <Notice tone="info" title="Scanning">Opening scene 3 of 12 in Daz Studio.</Notice>
    </div>
  )
}

export function WithAction() {
  return (
    <div style={col}>
      <Notice
        tone="warning"
        title="Houdini 22.0.368 not found"
        action={<Button size="sm" variant="outline">Locate</Button>}
      >
        The installation recorded for this project is no longer on disk.
      </Notice>
    </div>
  )
}

export function LongContent() {
  return (
    <div style={{ ...col, maxWidth: 360 }}>
      <Notice
        tone="error"
        title="Could not read D:/DTH Projects/Demo/Kira/houdini/hip/Kira_RangeOfMotion_Final_v0012_backup_before_retarget.hip"
        action={<Button size="sm" variant="outline">Retry</Button>}
      >
        C:/Program Files/Side Effects Software/Houdini 22.0.368/bin/hython_with_a_very_long_name_that_cannot_break.exe
      </Notice>
    </div>
  )
}
