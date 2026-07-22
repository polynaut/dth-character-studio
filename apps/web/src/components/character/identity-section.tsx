import { Label, NumberField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@dth/ui'
import { PanelOverrideToggle } from '#/components/character/panel-override-toggle.tsx'

import type { Character, GenesisVersion, SceneOverride } from '@dth/rom'
import type { ReactNode } from 'react'

/**
 * The character's identity block: Genesis generation + gender, and the
 * Genesis-9-specific fieldset (FACS/Flexion strengths, UE5 tear UV) that natively
 * disables on other generations. The G9 fieldset is also per-scene overridable:
 * with a non-primary Daz scene selected it disables until the top-right override
 * toggle arms it, then its three dials edit the scene's `identity` override
 * instead of the base character. Genesis/Gender are never per-scene.
 */
export function IdentitySection({
  character,
  patch,
  overrideEligible,
  identityOverrideActive,
  setIdentityOverrideEnabled,
  selectedSceneName,
  scenePath,
  sceneOverride,
  patchOverride,
  hairSlot,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** Scene-override arming, from useSceneSelection. */
  overrideEligible: boolean
  identityOverrideActive: boolean
  setIdentityOverrideEnabled: (enabled: boolean) => void
  selectedSceneName: string
  /** The selected scene's path — renders the override toggle label's mini render. */
  scenePath: string
  sceneOverride: SceneOverride | undefined
  patchOverride: (partial: Partial<SceneOverride>) => void
  /** The Hair-items field, rendered as the middle sidebar row (between Genesis/
   *  Gender and the Genesis-9 fieldset). It carries its OWN override toggle. */
  hairSlot: ReactNode
}) {
  // While armed on a non-primary scene the three dials read/write the scene's
  // identity override; otherwise the base character.
  const activeIdentity = identityOverrideActive ? sceneOverride?.identity : undefined
  const overriding = activeIdentity != null
  const facsDetailStrength = overriding ? activeIdentity.facsDetailStrength : character.facsDetailStrength
  const flexionStrength = overriding ? activeIdentity.flexionStrength : character.flexionStrength
  const applyUE5TearUV = overriding ? activeIdentity.applyUE5TearUV : character.applyUE5TearUV
  const setIdentity = (
    partial: Partial<Pick<Character, 'facsDetailStrength' | 'flexionStrength' | 'applyUE5TearUV'>>,
  ) => {
    if (overriding) patchOverride({ identity: { ...activeIdentity, ...partial } })
    else patch(partial)
  }
  // Disabled off Genesis 9 (the dials don't exist there) OR on a non-primary
  // scene that hasn't armed the identity override yet (shows the base values,
  // dimmed, until the user opts in).
  const fieldsetDisabled = character.genesis !== 'G9' || (overrideEligible && !overriding)

  return (
    // Sidebar rows: Genesis + Gender, then Hair items, then the Genesis-9 fieldset.
    // A roomy row gap so each row's override toggle + label has space to breathe.
    <div className="flex flex-col gap-12">
      {/* Genesis + Gender are CHARACTER-level, never per-scene — disabled while a
          non-primary scene is selected (switch back to the primary to change them). */}
      <div className="flex flex-col gap-5">
        <div
          className={`flex flex-wrap gap-4${overrideEligible ? ' text-muted-foreground' : ''}`}
          title={
            overrideEligible
              ? "Genesis and gender aren't per-scene — select the primary Daz scene to change them"
              : undefined
          }
        >
          <div>
            <Label className="mb-1">Genesis</Label>
            <Select
              value={character.genesis}
              onValueChange={(v) => patch({ genesis: v as GenesisVersion })}
              disabled={overrideEligible}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="G9">G9</SelectItem>
                <SelectItem value="G8.1">G8.1</SelectItem>
                <SelectItem value="G8">G8</SelectItem>
                <SelectItem value="G3">G3</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1">Gender</Label>
            <Select
              value={character.gender}
              onValueChange={(v) => patch({ gender: v as Character['gender'] })}
              disabled={overrideEligible}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Hair items — the middle sidebar row (carries its own override toggle). */}
      {hairSlot}

      {/* The legend is positioned absolutely (a notch on the border) so it
          doesn't consume a row of flow. The override toggle sits in its own row
          ABOVE the fieldset (right-aligned to the box) — OUTSIDE it, so it stays
          clickable while the fields are disabled, and with room for the scene
          name the border couldn't hold. The fieldset `disabled` turns off every
          control inside (the strengths and tear UV only exist on Genesis 9, and
          are locked on a non-primary scene until the override is armed) and the
          text goes muted. */}
      <div className="w-full">
        {character.genesis === 'G9' && (
          <div className="mb-4 flex w-full -translate-y-2.5 justify-end">
            <PanelOverrideToggle
              eligible={overrideEligible}
              active={identityOverrideActive}
              scenePath={scenePath}
              sceneName={selectedSceneName}
              noun="Genesis 9 settings"
              compact
              onToggle={setIdentityOverrideEnabled}
            />
          </div>
        )}
        {/* No bordered box — the three Genesis-9 dials sit bare, on the column's
            left baseline. The <fieldset> stays PURELY for its native group-disable:
            off Genesis 9, or a non-primary scene without the override armed, it
            greys + disables every control at once (NumberField has no disabled prop
            of its own). The strengths are stored raw (1 = 100%) but shown Daz-style
            as percentages, like every morph value field — NumberField's `percent`
            mode owns that conversion (and the "%" suffix). */}
        {/* A 2-row grid — three labels, then their three controls — so the labels
            share ONE bottom baseline (align-items:end) even if one wraps, and the
            controls line up on the row below. The FACS/Flexion inputs are w-40 to
            match the Genesis/Gender selects; the tear-UV switch is centred in an h-9
            box so it sits on the number fields' line. */}
        <fieldset
          disabled={fieldsetDisabled}
          className={`grid grid-cols-[auto_auto_auto] items-end gap-x-4 gap-y-1${fieldsetDisabled ? ' text-muted-foreground' : ''}`}
        >
          <Label title="G9 FACS Detail Strength, set at frame 0">FACS detail strength</Label>
          <Label title="G9 Flexion Automatic Strength, set at frame 0">Flexion strength</Label>
          <Label>UE5 tear UV</Label>
          <NumberField
            className="w-40 pr-6 text-right tabular-nums"
            percent
            value={facsDetailStrength}
            onCommit={(v) => setIdentity({ facsDetailStrength: v })}
          />
          <NumberField
            className="w-40 pr-6 text-right tabular-nums"
            percent
            value={flexionStrength}
            onCommit={(v) => setIdentity({ flexionStrength: v })}
          />
          <div className="flex h-9 items-center justify-center">
            <Switch
              checked={applyUE5TearUV}
              onCheckedChange={(v) => setIdentity({ applyUE5TearUV: v })}
            />
          </div>
        </fieldset>
      </div>
    </div>
  )
}
