import {
  InfoPopup,
  Label,
  NumberField,
  OverrideMark,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
} from '@dth/ui'

import type { Character, SceneOverride } from '@dth/rom'
import type { ReactNode } from 'react'

/**
 * The character's identity block: hair items, the Genesis-9 dials (FACS / flexion
 * strengths, UE5 tear UV) which only exist on Genesis 9, and Gender at the bottom.
 *
 * Per-scene overrides are IMPLICIT — no toggle. With a non-primary Daz scene
 * selected each dial is editable but shows the primary scene's value muted (a "can
 * be overridden per Daz scene" hint). Edit one to a value that differs from the
 * primary and it becomes a per-scene override: a green border + a green dot in its
 * label that swaps to a reset button on hover. `writeIdentity` stores the value and
 * derives the `identity.enabled` gate from "any dial differs". Genesis is set once
 * at creation (not shown here); Gender is character-level and never per-scene.
 */
export function IdentitySection({
  character,
  patch,
  overrideEligible,
  sceneOverride,
  writeIdentity,
  hairSlot,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** True while a non-primary Daz scene is selected — dials can then be overridden. */
  overrideEligible: boolean
  sceneOverride: SceneOverride | undefined
  /** Implicit-override writer for the three G9 dials (from useSceneSelection). */
  writeIdentity: (
    next: Partial<
      Pick<SceneOverride['identity'], 'facsDetailStrength' | 'flexionStrength' | 'applyUE5TearUV'>
    >,
  ) => void
  /** The Hair-items field, rendered as the first sidebar row. */
  hairSlot: ReactNode
}) {
  const base = {
    facsDetailStrength: character.facsDetailStrength,
    flexionStrength: character.flexionStrength,
    applyUE5TearUV: character.applyUE5TearUV,
  }
  // The active identity override (only when armed for this non-primary scene).
  // Untouched dials equal the base, so a dial "differs" iff the user changed it.
  const ov =
    overrideEligible && sceneOverride && sceneOverride.identity.enabled
      ? sceneOverride.identity
      : undefined
  const facs = ov ? ov.facsDetailStrength : base.facsDetailStrength
  const flex = ov ? ov.flexionStrength : base.flexionStrength
  const tear = ov ? ov.applyUE5TearUV : base.applyUE5TearUV
  const facsOv = !!ov && ov.facsDetailStrength !== base.facsDetailStrength
  const flexOv = !!ov && ov.flexionStrength !== base.flexionStrength
  const tearOv = !!ov && ov.applyUE5TearUV !== base.applyUE5TearUV
  // On the primary scene edits go straight to the base; on a non-primary scene they
  // route through the implicit override.
  const setFacs = (v: number) =>
    overrideEligible ? writeIdentity({ facsDetailStrength: v }) : patch({ facsDetailStrength: v })
  const setFlex = (v: number) =>
    overrideEligible ? writeIdentity({ flexionStrength: v }) : patch({ flexionStrength: v })
  const setTear = (v: boolean) =>
    overrideEligible ? writeIdentity({ applyUE5TearUV: v }) : patch({ applyUE5TearUV: v })
  // The dials only exist on Genesis 9; off G9 the whole set disables/mutes at once.
  const offG9 = character.genesis !== 'G9'
  // An overridable-but-still-inherited dial reads muted; the "can be overridden"
  // hint now lives on the OverrideMark icon (not the field).
  const inherited = (overridden: boolean) => overrideEligible && !overridden

  return (
    // Sidebar rows: Hair items, then the Genesis-9 dials, then Gender at the bottom.
    <div className="flex flex-col gap-5">
      {/* Hair items — the first sidebar row. */}
      {hairSlot}

      {/* The Genesis-9 dials sit on one row. On a non-primary scene each dial is
          editable and overrides implicitly: a value differing from the primary
          shows a green border + a green dot (→ reset on hover). Off G9 they don't
          exist, so the borderless fieldset disables and mutes them all at once. */}
      <fieldset
        disabled={offG9}
        className="m-0 flex flex-wrap items-end gap-x-6 gap-y-3 border-0 p-0"
      >
        <div className="group/ovr">
          <Label className="mb-1" title="G9 FACS Detail Strength, set at frame 0">
            FACS detail strength
            <OverrideMark
              overridden={facsOv}
              onReset={() => writeIdentity({ facsDetailStrength: base.facsDetailStrength })}
            />
          </Label>
          <NumberField
            className={cn(
              'w-28 pr-6 text-right tabular-nums',
              inherited(facsOv) && 'text-muted-foreground',
            )}
            percent
            overridden={facsOv}
            value={facs}
            onCommit={setFacs}
          />
        </div>
        <div className="group/ovr">
          <Label className="mb-1" title="G9 Flexion Automatic Strength, set at frame 0">
            Flexion strength
            <OverrideMark
              overridden={flexOv}
              onReset={() => writeIdentity({ flexionStrength: base.flexionStrength })}
            />
          </Label>
          <NumberField
            className={cn(
              'w-28 pr-6 text-right tabular-nums',
              inherited(flexOv) && 'text-muted-foreground',
            )}
            percent
            overridden={flexOv}
            value={flex}
            onCommit={setFlex}
          />
        </div>
        <div className="group/ovr flex h-9 items-center gap-3">
          <Switch variant={tearOv ? 'green' : 'default'} checked={tear} onCheckedChange={setTear} />
          <span
            className={cn(
              'flex items-center gap-1 text-sm',
              inherited(tearOv) && 'text-muted-foreground',
            )}
          >
            Set UE5 tear UV
            <InfoPopup label="Set UE5 tear UV — more information">
              Switches the Genesis 9 Tear figure's shader UV set to “UE5” during the
              ROM build, so DTH's Lacrimal Fluid material lines up without the manual
              Surfaces-tab step.
            </InfoPopup>
            <OverrideMark
              overridden={tearOv}
              onReset={() => writeIdentity({ applyUE5TearUV: base.applyUE5TearUV })}
            />
          </span>
        </div>
      </fieldset>

      {/* Gender — its own row at the bottom. Character-level ("global"): it's the
          same on every scene, so it stays editable no matter which scene is
          selected (never disabled). Genesis is creation-only, not shown here. */}
      <div>
        <Label className="mb-1">Gender</Label>
        <Select
          value={character.gender}
          onValueChange={(v) => patch({ gender: v as Character['gender'] })}
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
  )
}
