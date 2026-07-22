import { Switch } from '@dth/ui'

import { SceneLabel } from '#/components/character/scene-label.tsx'

/**
 * The top-right per-scene override toggle shared by the overridable editor panels
 * (ROM, Genesis-9 identity, hair, preserve lists). It arms only while an EXTRA
 * (non-primary) Daz scene is selected in the scene cards — the primary scene IS
 * the base definition. Toggling off keeps the panel's stored override values, just
 * inactive. On the primary scene there's nothing to override, so it goes INVISIBLE
 * (visibility:hidden) rather than being removed — it keeps reserving its exact space
 * so picking an extra scene doesn't shift the surrounding rows. The selected scene
 * rides the same green {@link SceneLabel} pill the header tag uses — with a tiny
 * "OVERRIDE" eyebrow over the scene name. `noun` names what's overridden (e.g. "ROM
 * frames") and rides the switch's `aria-label` — a stable, per-panel accessible name
 * (no hover tooltip).
 */
export function PanelOverrideToggle({
  eligible,
  active,
  scenePath,
  sceneName,
  noun,
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
    <span className={eligible ? undefined : 'invisible'} aria-hidden={!eligible || undefined}>
      {/* The switch is folded INTO the pill's right edge (SceneLabel `end`) as a
          squared green/white switch, so the label + control read as ONE control.
          Compact: a bare "OVERRIDE" pill + the switch — the sticky scene label in the
          tabs row names the scene. */}
      <SceneLabel
        scenePath={scenePath}
        name={compact ? '' : sceneName}
        showAvatar={!compact}
        eyebrow="Override"
        active={active}
        end={
          <Switch
            variant="green"
            checked={active}
            disabled={!eligible}
            aria-label={`Override ${noun}`}
            onCheckedChange={onToggle}
          />
        }
      />
    </span>
  )
}
