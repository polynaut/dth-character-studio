import { InfoPopup, Switch } from '@dth/ui'

import { SceneLabel } from '#/components/character/scene-label.tsx'

import type { ReactNode } from 'react'

/**
 * The top-right per-scene override toggle shared by the overridable editor panels
 * (ROM, Genesis-9 identity, hair, preserve lists). It arms only while an EXTRA
 * (non-primary) Daz scene is selected in the scene cards — the primary scene IS
 * the base definition. Toggling off keeps the panel's stored override values, just
 * inactive. On the primary scene there's nothing to override, so it goes INVISIBLE
 * (visibility:hidden) rather than being removed — it keeps reserving its exact space
 * so picking an extra scene doesn't shift the surrounding rows. The selected scene
 * rides the same green {@link SceneLabel} pill the header tag uses — with a tiny
 * "OVERRIDE" eyebrow over the scene name and the info "i" inline after it. `noun`
 * names what's overridden (e.g. "ROM frames") and rides the switch's `aria-label` —
 * a stable, per-panel accessible name (no hover tooltip).
 */
export function PanelOverrideToggle({
  eligible,
  active,
  scenePath,
  sceneName,
  noun,
  info,
  onToggle,
  compact = false,
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
  /** A SMALLER pill: no mini render, no "OVERRIDE" eyebrow — just the scene name +
   *  info. Used for the second (Genesis-9) toggle in the identity sidebar, where the
   *  full pill already appears once (on the Hair row) right above it. */
  compact?: boolean
}) {
  // The primary scene IS the base — nothing to override. Rather than removing the
  // toggle (which would shift the rows below when an extra scene is picked), hide it
  // with visibility:hidden so it keeps reserving its exact space; aria-hidden +
  // disabled keep the hidden control out of the a11y tree and non-interactive.
  return (
    <span
      className={`flex items-center gap-2${eligible ? '' : ' invisible'}`}
      aria-hidden={!eligible || undefined}
    >
      {/* Full pill: mini render + "OVERRIDE" eyebrow over the scene name. Compact:
          just the scene name (no render, no eyebrow). Info "i" inline after the name. */}
      <SceneLabel
        scenePath={scenePath}
        name={sceneName}
        showAvatar={!compact}
        eyebrow={compact ? undefined : 'Override'}
        trailing={<InfoPopup label="Scene override — more information">{info}</InfoPopup>}
      />
      <Switch
        checked={active}
        disabled={!eligible}
        aria-label={`Override ${noun}`}
        onCheckedChange={onToggle}
      />
    </span>
  )
}
