import { Button, StatusIndicator, ToolCard } from '../index.ts'

const col = { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxWidth: 520 } as const

export function Daz() {
  return (
    <div style={col}>
      <ToolCard tone="daz" title="Kira.duf" subtitle="D:/DTH Projects/Demo/Kira/daz3d/Kira.duf" actions={<Button size="sm" variant="ghost">Open</Button>} />
    </div>
  )
}

export function Houdini() {
  return (
    <div style={col}>
      <ToolCard tone="houdini" title="Kira_ROM.hip" subtitle="Houdini 22.0.368">Last exported today</ToolCard>
    </div>
  )
}

export function Unreal() {
  return (
    <div style={col}>
      <ToolCard tone="unreal" title="KiraSandbox" subtitle="D:/Unreal/KiraSandbox/KiraSandbox.uproject" />
    </div>
  )
}

export function Selected() {
  return (
    <div style={col}>
      <ToolCard tone="daz" state="selected" title="Kira.duf" subtitle="D:/DTH Projects/Demo/Kira/daz3d/Kira.duf" />
    </div>
  )
}

export function Attention() {
  return (
    <div style={col}>
      <ToolCard tone="houdini" state="attention" title="Kira_ROM.hip" subtitle="Houdini 22.0.368">
        <StatusIndicator tone="warning">Scene file is missing.</StatusIndicator>
      </ToolCard>
    </div>
  )
}

export function LongTitleAndPath() {
  return (
    <div style={{ ...col, maxWidth: 360 }}>
      <ToolCard
        tone="daz"
        title="Kira_RangeOfMotion_Final_v0012_backup_before_retarget.duf"
        subtitle="D:/DTH Projects/Demo/Kira/daz3d/scenes/rom/Kira_RangeOfMotion_Final_v0012_backup_before_retarget.duf"
        actions={<Button size="sm" variant="ghost">Open</Button>}
      >
        C:/Program Files/Side Effects Software/Houdini 22.0.368/bin/hython_with_a_very_long_name.exe
      </ToolCard>
    </div>
  )
}

export function SideBySide() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 16, maxWidth: 760 }}>
      <ToolCard tone="daz" title="Kira.duf" subtitle="D:/DTH Projects/Demo/Kira/daz3d/Kira.duf" />
      <ToolCard tone="houdini" title="Kira_ROM.hip" subtitle="Houdini 22.0.368">
        Last exported today. Generated 8 sections, 1,240 frames.
      </ToolCard>
    </div>
  )
}

export function SideBySideFlex() {
  return (
    <div style={{ display: 'flex', gap: 12, padding: 16, maxWidth: 760 }}>
      <ToolCard tone="daz" title="Kira.duf" subtitle="D:/DTH Projects/Demo/Kira/daz3d/Kira.duf" />
      <ToolCard tone="houdini" title="Kira_ROM.hip" subtitle="Houdini 22.0.368">
        Last exported today. Generated 8 sections, 1,240 frames, written to D:/DTH Projects/Demo/Kira/houdini/daz-export.
      </ToolCard>
    </div>
  )
}
