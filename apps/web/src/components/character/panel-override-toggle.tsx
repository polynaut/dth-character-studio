import { InfoPopup, Switch } from '@dth/ui'

import type { ReactNode } from 'react'

/**
 * The top-right per-scene override toggle shared by the overridable editor
 * panels (ROM, Genesis-9 identity, hair). It arms only while an EXTRA
 * (non-primary) Daz scene is selected in the scene cards — the primary scene IS
 * the base definition. Toggling off keeps the panel's stored override values,
 * just inactive. `noun` names what's overridden (e.g. "ROM frames"); the switch's
 * accessible name always carries it so each panel's toggle stays uniquely
 * targetable. `showScene` drops the inline "for <scene>" where space is tight
 * (the tooltip still names it); the scene is also in the header tag.
 */
export function PanelOverrideToggle({
  eligible,
  active,
  sceneName,
  noun,
  info,
  onToggle,
  showScene = true,
}: {
  eligible: boolean
  active: boolean
  sceneName: string
  noun: string
  info: ReactNode
  onToggle: (enabled: boolean) => void
  showScene?: boolean
}) {
  const title = !eligible
    ? `Override ${noun} — select one of the extra Daz scenes (not the primary) in the Daz scenes cards first`
    : active
      ? `Disable the ${noun} override for “${sceneName}” (the stored values are kept)`
      : `Override ${noun} for “${sceneName}”`
  return (
    <span className="flex items-center gap-2">
      <span
        className={`flex items-center gap-1 text-sm ${eligible ? '' : 'text-muted-foreground'}`}
      >
        Override
        {eligible && showScene && <span className="font-medium">for “{sceneName}”</span>}
        <InfoPopup label="Scene override — more information">{info}</InfoPopup>
      </span>
      <Switch checked={active} disabled={!eligible} title={title} onCheckedChange={onToggle} />
    </span>
  )
}
