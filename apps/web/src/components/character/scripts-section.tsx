import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { tallPathChipClass } from '#/components/path-code.tsx'
import { GuideLink } from '#/components/guide-link.tsx'
import { InfoPopup, Switch } from '@dth/ui'

import type { RootedDir } from '#/lib/character-paths.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character } from '@dth/rom'

/**
 * The "Daz scripts generated" pane: where the generated
 * ROM_/Export_ scripts install in the Daz library, so the user knows where to
 * find/run them in Daz — or the setup notice while no library is set. The two
 * export switches live here (they shape WHICH scripts generate and what the
 * export pass covers); like every export setting they persist + regenerate
 * immediately via `persistPatch`, so the on-disk scripts never lag the toggle.
 */
export function ScriptsSection({
  character,
  scriptsPath,
  saving,
  persistPatch,
}: {
  character: Character
  /** From lib/character-paths.ts; null until "My DAZ 3D Library" is set. */
  scriptsPath: RootedDir | null
  saving: boolean
  persistPatch: PersistCharacterPatch
}) {
  const exportSet = character.exportPath.trim() !== ''

  return (
    <section className="mb-8 rounded-lg border bg-card p-5">
      <h2 className="mb-3 flex w-fit items-center gap-1 text-xl font-semibold">
        Daz scripts generated
        <InfoPopup label="Daz scripts generated — more information">
          Where the generated Daz script installs in your DAZ library on Save — open it in Daz to
          build the ROM{exportSet ? ' and run the export' : ''}.{' '}
          <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/04-first-character.html#save--generate" />
        </InfoPopup>
      </h2>
      {scriptsPath ? (
        // h-9 chip, matching the Export directory chip beside its buttons.
        <DirPathChip
          dir={scriptsPath.dir}
          roots={[scriptsPath.root]}
          className={tallPathChipClass}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Set “My DAZ 3D Library” in Settings to install the character script.
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Switch
          checked={character.exportWithRomScript}
          disabled={!exportSet || saving}
          onCheckedChange={(exportWithRomScript) =>
            void persistPatch(
              { exportWithRomScript },
              {
                toast: exportWithRomScript
                  ? 'Combined ROM + export script'
                  : 'Separate ROM and Export scripts',
              },
            )
          }
        />
        <span className={`text-sm${exportSet ? '' : ' text-muted-foreground'}`}>
          Run the export with the ROM script
        </span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Switch
          checked={character.exportHairAssets}
          disabled={!exportSet || saving}
          onCheckedChange={(exportHairAssets) =>
            void persistPatch(
              { exportHairAssets },
              {
                toast: exportHairAssets
                  ? 'Hair assets export with the main export — script regenerated'
                  : 'Hair export off — script regenerated',
              },
            )
          }
        />
        <span
          className={`text-sm${exportSet ? '' : ' text-muted-foreground'}`}
          title="After the main export, each of the open scene's hair items is exported on its own (the Export_Hair pass) — in the combined ROM script and the split Export script alike"
        >
          Export hair assets too
        </span>
      </div>
    </section>
  )
}
