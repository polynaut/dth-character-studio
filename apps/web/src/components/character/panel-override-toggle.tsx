import { InfoPopup, Switch } from '@dth/ui'

import { SceneLabel } from '#/components/character/scene-label.tsx'

import type { ReactNode } from 'react'

/**
 * The top-right per-scene override toggle shared by the overridable editor panels
 * (ROM, Genesis-9 identity, hair, preserve lists). It arms only while an EXTRA
 * (non-primary) Daz scene is selected in the scene cards — the primary scene IS
 * the base definition. Toggling off keeps the panel's stored override values, just
 * inactive. When eligible the label carries the selected scene as the same green
 * {@link SceneLabel} pill (mini render + name) the header tag uses; the info popup
 * ("i") explains it. `noun` names what's overridden (e.g. "ROM frames") and rides
 * the switch's `aria-label` — a stable, per-panel accessible name (no hover tooltip).
 */
export function PanelOverrideToggle({
  eligible,
  active,
  scenePath,
  sceneName,
  noun,
  info,
  onToggle,
}: {
  eligible: boolean
  active: boolean
  /** The selected scene's path — renders its `.tip.png` in the label pill. */
  scenePath: string
  /** The selected scene's prettified display name (see prettySceneName). */
  sceneName: string
  noun: string
  info: ReactNode
  onToggle: (enabled: boolean) => void
}) {
  return (
    <span className="flex items-center gap-2">
      <span
        className={`flex items-center gap-1.5 text-sm ${eligible ? '' : 'text-muted-foreground'}`}
      >
        Override
        {eligible && <SceneLabel scenePath={scenePath} name={sceneName} />}
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
