import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { InfoPopup } from '@dth/ui'

import type { RootedDir } from '#/lib/character-paths.ts'
import type { Character } from '@dth/rom'

/**
 * The "Daz scripts generated" pane: where the generated
 * ROM_/Export_ scripts install in the Daz library, so the user knows where to
 * find/run them in Daz — or the setup notice while no library is set.
 */
export function ScriptsSection({
  character,
  scriptsPath,
}: {
  character: Character
  /** From lib/character-paths.ts; null until "My DAZ 3D Library" is set. */
  scriptsPath: RootedDir | null
}) {
  // With an export folder set and the export NOT combined with the ROM script,
  // generation splits into the ROM_ build script + a standalone Export_ script
  // (see generate.ts toCharacterScriptDsa / toExportScriptDsa). Otherwise it's
  // one self-contained ROM_<Name>_<Genesis>.dsa. Drives the note below.
  const exportSet = character.exportPath.trim() !== ''
  const exportSplit = exportSet && character.exportWithRomScript === false

  return (
    <section className="mb-8 rounded-lg border bg-card p-5">
      <h2 className="mb-3 flex w-fit items-center gap-1 text-xl font-semibold">
        Daz scripts generated
        <InfoPopup label="Daz scripts generated — more information">
          {exportSplit ? (
            <>
              Where the generated <code>ROM_{character.name}_{character.genesis}.dsa</code> (builds
              the ROM) and <code>Export_{character.name}_{character.genesis}.dsa</code> (runs the
              exporter) scripts are installed in your DAZ library on Save — run the ROM script
              first, then the Export script in the same Daz session.
            </>
          ) : (
            <>
              Where the generated <code>ROM_{character.name}_{character.genesis}.dsa</code> script
              is installed in your DAZ library on Save — open it from Daz to build the ROM
              {exportSet ? ' and run the export' : ''}.
            </>
          )}{' '}
          The folder is created the first time a script is generated.
        </InfoPopup>
      </h2>
      {scriptsPath ? (
        <DirPathChip dir={scriptsPath.dir} roots={[scriptsPath.root]} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Set “My DAZ 3D Library” in Settings to install the character script.
        </p>
      )}
    </section>
  )
}
