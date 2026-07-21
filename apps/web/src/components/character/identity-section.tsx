import { InfoPopup, Label, NumberField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@dth/ui'

import type { Character, GenesisVersion } from '@dth/rom'

/**
 * The character's identity block: Genesis generation + gender, and the
 * Genesis-9-specific fieldset (FACS/Flexion strengths, UE5 tear UV) that
 * natively disables on other generations.
 */
export function IdentitySection({
  character,
  patch,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
}) {
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-5">
      <div className="flex flex-col gap-5 pt-2">
        <div className="flex flex-wrap gap-4">
          <div>
            <Label className="mb-1">Genesis</Label>
            <Select
              value={character.genesis}
              onValueChange={(v) => patch({ genesis: v as GenesisVersion })}
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

      {/* The legend is positioned absolutely (a notch on the border) so it
          doesn't consume a row of flow — that keeps the FACS / Flexion fields
          on the same baseline as the Genesis row on the left (-mt-2 lifts the
          box, pt-2 on the left column matches). The box always shows; on
          non-G9 characters the native fieldset `disabled` turns off every
          control inside (the strengths and tear UV only exist on Genesis 9
          figures) and the text goes muted. */}
      <fieldset
        disabled={character.genesis !== 'G9'}
        className="relative -mt-2 self-start rounded-md border px-4 pt-4 pb-4"
      >
        <legend className="absolute -top-2 left-3 bg-card px-1 text-xs font-medium text-muted-foreground uppercase">
          Genesis 9 Specific
        </legend>
        <div className={`space-y-4${character.genesis === 'G9' ? '' : ' text-muted-foreground'}`}>
          {/* The strengths are stored raw (1 = 100%) but shown Daz-style as
              percentages, same as every morph value field — NumberField's
              `percent` mode owns that conversion (and the "%" suffix). */}
          <div className="flex flex-wrap gap-4">
            <div>
              <Label className="mb-1" title="G9 FACS Detail Strength, set at frame 0">
                FACS detail strength
              </Label>
              <NumberField
                className="w-28 pr-6 text-right tabular-nums"
                percent
                value={character.facsDetailStrength}
                onCommit={(facsDetailStrength) => patch({ facsDetailStrength })}
              />
            </div>
            <div>
              <Label className="mb-1" title="G9 Flexion Automatic Strength, set at frame 0">
                Flexion strength
              </Label>
              <NumberField
                className="w-28 pr-6 text-right tabular-nums"
                percent
                value={character.flexionStrength}
                onCommit={(flexionStrength) => patch({ flexionStrength })}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={character.applyUE5TearUV}
              onCheckedChange={(applyUE5TearUV) => patch({ applyUE5TearUV })}
            />
            <span className="flex items-center gap-1 text-sm">
              Set UE5 tear UV
              <InfoPopup label="Set UE5 tear UV — more information">
                Switches the Genesis 9 Tear figure's shader UV set to “UE5” during the
                ROM build, so DTH's Lacrimal Fluid material lines up without the manual
                Surfaces-tab step.
              </InfoPopup>
            </span>
          </div>
        </div>
      </fieldset>
    </div>
  )
}
