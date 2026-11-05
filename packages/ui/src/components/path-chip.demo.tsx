import { PathChip } from '../index.ts'

const col = { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: 16 } as const

export function Default() {
  return (
    <div style={col}>
      <PathChip path="D:/DTH Projects/Demo/Kira" />
    </div>
  )
}

export function Secondary() {
  return (
    <div style={{ ...col, background: 'var(--secondary)' }}>
      <PathChip variant="secondary" path="D:/DTH Projects/Demo/Kira" />
    </div>
  )
}

export function WithRoot() {
  return (
    <div style={col}>
      <PathChip
        path="D:/DTH Projects/Demo/Kira/daz3d"
        display="D:/DTH Projects/Demo/Kira/daz3d"
        roots={['D:/DTH Projects/Demo/Kira', 'D:/DTH Projects/Demo']}
      />
    </div>
  )
}

export function Editable() {
  return (
    <div style={col}>
      <PathChip path="D:/DTH Projects/Demo/Kira/houdini" onEdit={() => {}} />
    </div>
  )
}

export function LongPath() {
  return (
    <div style={{ ...col, maxWidth: 360 }}>
      <PathChip path="C:/Program Files/Side Effects Software/Houdini 22.0.368/bin/hython.exe" />
    </div>
  )
}
