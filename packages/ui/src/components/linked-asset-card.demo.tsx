import { LinkedAssetCard, PathChip } from '../index.ts'

// The busy bar's animated stripes overflow the frame, so auto-measuring would read them as content.
export const height = 150

const noop = () => {}

const media = (
  <div
    style={{
      width: 58,
      height: 78,
      borderRadius: 6,
      background: 'var(--muted)',
      color: 'var(--muted-foreground)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 20,
    }}
  >
    K
  </div>
)

const common = { media, altHeld: false, openTitle: 'Open in Daz', accentClass: 'group-hover:text-daz-green', cardClass: 'daz-card', barClass: 'bg-daz-green', checkClass: 'bg-daz-green', onOpen: noop } as const
const path = <PathChip path="D:/DTH Projects/Demo/Kira/daz3d/KiraDefault_G9_GP.duf" />
const wrap = { padding: 16 } as const

export function Default() {
  return <div style={wrap}><LinkedAssetCard {...common} title="KiraDefault_G9_GP" extra={path} /></div>
}

export function WithActions() {
  return (
    <div style={wrap}>
      <LinkedAssetCard {...common} title="KiraDefault_G9_GP" extra={path} onRename={noop} onRemove={noop} onReplace={noop} onUtils={noop} />
    </div>
  )
}

export function Selected() {
  return <div style={wrap}><LinkedAssetCard {...common} title="KiraSummertide_G9_GP" selected onSelect={noop} /></div>
}

export function Busy() {
  return <div style={wrap}><LinkedAssetCard {...common} title="Kira.hip" busy busyLabel="Reading this project in Houdini…" /></div>
}

export function BusyNoBar() {
  return <div style={wrap}><LinkedAssetCard {...common} barClass={undefined} title="Kira.hip" busy /></div>
}
