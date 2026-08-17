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
  overrideLabelClass,
} from '@dth/ui'

import { SUBD_LEVELS } from '@dth/rom'

import type { Character, SceneOverride } from '@dth/rom'
import type { ReactNode } from 'react'

/**
 * The character's identity block: hair items, the Genesis-9 dials (FACS / flexion
 * strengths, UE5 tear UV) which only exist on Genesis 9, the Mesh SubD level
 * (every generation, character-wide), and Gender at the bottom.
 *
 * Per-scene overrides are IMPLICIT — no toggle. With a non-primary Daz scene
 * selected each dial is editable but shows the primary scene's value muted (a "can
 * be overridden per Daz scene" hint). Edit one to a value that differs from the
 * primary and it becomes a per-scene override: a green border + a green dot in its
 * label that swaps to a reset button on hover. `writeIdentity` stores the value and
 * derives the `identity.enabled` gate from "any dial differs". Genesis is set once
 * at creation (not shown here); Gender is character-level, never per-scene, and
 * READ-ONLY — derived from the primary scene (`primarySceneDerivation`). The Mesh
 * SubD level is character-level too, and editable on any scene: a level that
 * could differ per scene would put back the very mismatch it exists to remove.
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
  writeIdentity: (next: Partial<NonNullable<SceneOverride['identity']>>) => void
  /** The Hair-items field, rendered as the first sidebar row. */
  hairSlot: ReactNode
}) {
  const base = {
    facsDetailStrength: character.facsDetailStrength,
    flexionStrength: character.flexionStrength,
    applyUE5TearUV: character.applyUE5TearUV,
  }
  // The active identity override — armed by PRESENCE for this non-primary scene.
  // Untouched dials equal the base, so a dial "differs" iff the user changed it.
  const ov = overrideEligible ? sceneOverride?.identity : undefined
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
    <div className="flex flex-col gap-7">
      {/* Hair items — the first sidebar row. */}
      {hairSlot}

      {/* The Genesis-9 dials sit on one row. On a non-primary scene each dial is
          editable and overrides implicitly: a value differing from the primary
          shows a green border + a green dot (→ reset on hover). Off G9 they don't
          exist, so the borderless fieldset disables and mutes them all at once. */}
      <fieldset
        disabled={offG9}
        className="m-0 flex flex-wrap items-end gap-x-6 gap-y-5 border-0 p-0"
      >
        <div className="group/ovr">
          <Label className={cn('mb-1', overrideLabelClass(facsOv, overrideEligible))}>
            FACS detail strength
            {/* The override handle only exists in override context — with the
                primary scene selected there is nothing to override, so no cube. */}
            {overrideEligible && (
              <OverrideMark
                overridden={facsOv}
                onReset={() => writeIdentity({ facsDetailStrength: base.facsDetailStrength })}
              />
            )}
          </Label>
          <NumberField
            className={cn(
              'w-48 pr-6 text-right tabular-nums',
              inherited(facsOv) && 'text-muted-foreground',
            )}
            percent
            overridden={facsOv}
            value={facs}
            onCommit={setFacs}
          />
        </div>
        <div className="group/ovr">
          <Label className={cn('mb-1', overrideLabelClass(flexOv, overrideEligible))}>
            Flexion strength
            {overrideEligible && (
              <OverrideMark
                overridden={flexOv}
                onReset={() => writeIdentity({ flexionStrength: base.flexionStrength })}
              />
            )}
          </Label>
          <NumberField
            className={cn(
              'w-48 pr-6 text-right tabular-nums',
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
              'flex items-center gap-2 text-sm',
              overrideLabelClass(tearOv, overrideEligible),
            )}
          >
            Set UE5 tear UV
            <InfoPopup label="Set UE5 tear UV — more information" className="-translate-y-px">
              Switches the Genesis 9 Tear figure's shader UV set to “UE5” during the
              ROM build, so DTH's Lacrimal Fluid material lines up without the manual
              Surfaces-tab step.
            </InfoPopup>
            {overrideEligible && (
              <OverrideMark
                overridden={tearOv}
                onReset={() => writeIdentity({ applyUE5TearUV: base.applyUE5TearUV })}
              />
            )}
          </span>
        </div>
      </fieldset>

      {/* Mesh SubD level — character-level, every generation, and deliberately
          NOT per-scene: the whole point is one level everywhere, so a value that
          could differ per scene would reintroduce the mismatch it removes. It
          therefore sits OUTSIDE the fieldset above, and stays character-wide
          even with a non-primary scene selected — which its dials do not, so
          the popup has to say so or the neighbouring green override marks make
          the wrong promise. */}
      <div>
        <Label className="mb-1">
          Mesh SubD level
          <InfoPopup label="Mesh SubD level — more information">
            <div className="space-y-2">
              <p>
                Sets the <strong>viewport</strong> and <strong>render</strong> subdivision to
                the same level on the figure and everything under it — geografts, conformed
                clothing — at the start of the ROM build.
              </p>
              <p>
                Daz keeps those two as separate dials, so by default the mesh you judge a pose
                on is not the mesh that gets rendered and exported. When they agree, an artefact
                you can see in the viewport is an artefact that shipped — which is what makes
                “is this the exporter or the scene?” answerable by looking.
              </p>
              <p>
                <strong>Leave as-is</strong> touches nothing, which is how every character
                behaved before this existed. A level above 0 also switches those meshes to High
                Resolution, or the level would do nothing at all.
              </p>
              <p>
                Unlike the dials above it, this one is <strong>not per-scene</strong>: it
                applies to every Daz scene on this character, whichever one is selected.
                One level everywhere is the entire point.
              </p>
            </div>
          </InfoPopup>
        </Label>
        <Select
          value={String(character.subdLevel)}
          onValueChange={(value) => patch({ subdLevel: Number(value) })}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="-1">Leave as-is</SelectItem>
            {/* From the schema's own cap, never a hardcoded list — the picker
                must not be able to offer a level `characterSchema` rejects. */}
            {SUBD_LEVELS.map((level) => (
              <SelectItem key={level} value={String(level)}>
                Level {level}
                {level === 0 ? ' (base cage)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Gender — read-only: derived from the creation scene (the figure id
          for the gendered generations, the GP/DK geograft for the neutral G9 —
          `primarySceneDerivation`) and BAKED at creation; nothing changes it
          afterwards (even the missing-primary relink re-derives only GEN). Its
          only real jobs are picking the GP-vs-DK ROM blocks and the gendered
          figure node, both of which the scene answers better than a manual
          field ever did. Genesis is creation-only too, not shown here. */}
      <div>
        <Label className="mb-1">Gender</Label>
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          title="Read from the Daz scene at character creation (its figure / GP-DK geograft) — fixed from then on"
        >
          {/* The same ♀/♂ badge the create panel's scene preview wears. */}
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background/85 text-sm font-semibold"
          >
            {character.gender === 'female' ? '♀' : '♂'}
          </span>
          <span>
            {character.gender === 'female' ? 'Female' : 'Male'}
            {/* Reconstructs what decided it at creation (`genderForScan`): the
                gendered generations' figure id tells directly; the neutral G9
                figure's gender came from the GP/DK geograft, whose presence the
                GEN section's enabled state still records. A scene-less
                character has nothing detected yet — the first link derives it. */}
            <span className="ml-1.5 text-xs">
              —{' '}
              {!character.scenePath
                ? 'no scene linked yet — derived when the primary scene is linked'
                : character.genesis !== 'G9'
                  ? `detected ${character.genesis} ${character.gender}`
                  : character.sections.GEN.enabled
                    ? character.gender === 'female'
                      ? 'detected Golden Palace'
                      : 'detected Dicktator'
                    : 'no gendered figure or GP/DK geograft in the scene'}
            </span>
          </span>
        </p>
      </div>
    </div>
  )
}
