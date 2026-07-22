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
    // gap-8 keeps clear air between the Hair-items override toggle and the
    // Genesis-9 one below it (the fieldset box that used to space them is gone).
    <div className="flex flex-col gap-8">
      {/* Genesis + Gender are CHARACTER-level, never per-scene — disabled while a
          non-primary scene is selected (switch back to the primary to change them). */}
      <div className="flex flex-col gap-5">
        <div
          className="flex flex-wrap gap-4"
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
          <div className="mb-2.5 flex w-full justify-end">
            <PanelOverrideToggle
              eligible={overrideEligible}
              active={identityOverrideActive}
              scenePath={scenePath}
              sceneName={selectedSceneName}
              noun="Genesis 9 settings"
              compact
              onToggle={setIdentityOverrideEnabled}
              info={
                <>
                  Give this Daz scene its own <strong>Genesis-9 FACS detail / flexion
                  strengths and tear UV</strong>: select one of the extra scenes in the Daz
                  scenes cards, enable the override, then set the dials for that scene. On Save
                  they ride the character's one Daz script and apply when this scene is open;
                  the base scene keeps its own.
                </>
              }
            />
          </div>
        )}
        {/* The "Genesis 9 Specific" fieldset box is gone — the three dials sit on
            ONE ROW. The bare <fieldset disabled> stays (no border/legend) purely
            for its disable cascade: it locks every control inside AND drives the
            NumberField "%"-suffix fade (group-has-[:disabled]). */}
        <fieldset disabled={fieldsetDisabled} className="min-w-0 border-0 p-0">
          {/* The strengths are stored raw (1 = 100%) but shown Daz-style as
              percentages, same as every morph value field — NumberField's
              `percent` mode owns that conversion (and the "%" suffix). */}
          <div
            className={`flex flex-wrap items-start justify-between gap-4${fieldsetDisabled ? ' text-muted-foreground' : ''}`}
          >
            <div>
              <Label className="mb-1" title="G9 FACS Detail Strength, set at frame 0">
                FACS detail strength
              </Label>
              <NumberField
                className="w-28 pr-6 text-right tabular-nums"
                percent
                value={facsDetailStrength}
                onCommit={(v) => setIdentity({ facsDetailStrength: v })}
              />
            </div>
            <div>
              <Label className="mb-1" title="G9 Flexion Automatic Strength, set at frame 0">
                Flexion strength
              </Label>
              <NumberField
                className="w-28 pr-6 text-right tabular-nums"
                percent
                value={flexionStrength}
                onCommit={(v) => setIdentity({ flexionStrength: v })}
              />
            </div>
            <div className="flex flex-col items-center">
              <Label className="mb-1" title="Set UE5 tear UV">
                UE5 tear UV
              </Label>
              {/* h-9 wrapper so the toggle sits on the same line as the two h-9
                  number inputs beside it; items-center centres it under its label. */}
              <span className="flex h-9 items-center">
                <Switch
                  checked={applyUE5TearUV}
                  onCheckedChange={(v) => setIdentity({ applyUE5TearUV: v })}
                />
              </span>
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  )
}
