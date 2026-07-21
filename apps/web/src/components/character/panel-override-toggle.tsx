import { InfoPopup, Switch } from '@dth/ui'

import type { ReactNode } from 'react'

/**
 * The top-right per-scene override toggle shared by the overridable editor panels
 * (ROM, Genesis-9 identity, hair, preserve lists). It arms only while an EXTRA
 * (non-primary) Daz scene is selected in the scene cards — the primary scene IS
 * the base definition. Toggling off keeps the panel's stored override values, just
 * inactive. The label names the selected scene (bold); the info popup ("i")
 * explains it. `noun` names what's overridden (e.g. "ROM frames") and rides the
 * switch's `aria-label` — a stable, per-panel accessible name (no hover tooltip).
 */
export function PanelOverrideToggle({
  eligible,
  active,
  sceneName,
  noun,
  info,
  onToggle,
}: {
  eligible: boolean
  active: boolean
  sceneName: string
  noun: string
  info: ReactNode
  onToggle: (enabled: boolean) => void
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={`flex items-center gap-1 text-sm ${eligible ? '' : 'text-muted-foreground'}`}
      >
        Override
        {eligible && (
          <span>
            for <span className="font-bold">“{sceneName}”</span>
          </span>
        )}
        <InfoPopup label="Scene override — more information">{info}</InfoPopup>
      </span>
      <Switch
        checked={active}
        disabled={!eligible}
        aria-label={`Override ${noun}`}
        onCheckedChange={onToggle}
      />
    </span>
  )
}
