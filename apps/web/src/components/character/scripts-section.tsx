import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { GuideLink } from '#/components/guide-link.tsx'
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
        <DirPathChip dir={scriptsPath.dir} roots={[scriptsPath.root]} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Set “My DAZ 3D Library” in Settings to install the character script.
        </p>
      )}
    </section>
  )
}
