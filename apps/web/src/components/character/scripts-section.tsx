import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { GuideLink } from '#/components/guide-link.tsx'
import { InfoPopup } from '@dth/ui'
import { displayPath } from '#/lib/path.ts'

import type { RootedDir } from '#/lib/character-paths.ts'
import type { Character } from '@dth/rom'

/** The guide's direct-export section — the single source of truth for how the
 *  export directory behaves (the sub-section's info popup links here instead
 *  of duplicating it). */
const EXPORT_GUIDE_URL =
  'https://polynaut.github.io/dth-character-studio/guide/05-rom-in-daz.html#direct-export-optional-recommended'

/**
 * The "Daz scripts generated" pane: where the generated ROM_/Export_/
 * Export_Hair_ scripts install in the Daz library, so the user knows where to
 * find and run them in Daz — or the setup notice while no library is set.
 *
 * Purely informational: there is nothing to choose here. Every visible script
 * does ONE job (ROM_ builds the ROM, Export_ runs the exporter, Export_Hair_
 * exports the grooms) and all of them generate whenever they apply, so the pane
 * that used to carry the two export-shape switches now just says where they land.
 *
 * The "Export directory" sub-section lives at the bottom: read-only since
 * schema v29, the directory is DERIVED (`<character>/<houdini subfolder>/
 * daz-export`, created at character creation and re-resolved on every save),
 * so there is nothing to pick — it only shows where the export scripts
 * deliver.
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
          Where the generated Daz scripts install in your DAZ library on Save. Open{' '}
          <code>ROM_…</code> in Daz to build the ROM
          {exportSet ? (
            <>
              , then <code>Export_…</code> to export it and <code>Export_Hair_…</code> for the
              grooms — one script per job, so a re-export never rebuilds the ROM
            </>
          ) : null}
          .{' '}
          <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/04-first-character.html#save--generate" />
        </InfoPopup>
      </h2>
      {scriptsPath ? (
        // h-9 chip, matching the Export directory chip at the bottom of the panel.
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
      <div className="mt-5 border-t pt-4">
        <h3 className="mb-3 flex w-fit items-center gap-1 text-xl font-semibold">
          Export directory
          <InfoPopup label="Export directory — more information">
            How the export directory works —{' '}
            <GuideLink href={EXPORT_GUIDE_URL}>open the guide</GuideLink>
          </InfoPopup>
        </h3>
        {exportSet ? (
          <>
            <PathCode path={displayPath(character.exportPath)} className={tallPathChipClass} />
            <p className="mt-3 text-xs text-muted-foreground">
              Fixed, beside the character&apos;s Houdini projects — these files exist to be
              imported by Houdini, so they sit next to the <code>.hip</code> that reads them.
              Each scene exports into its own subfolder here, named after the scene&apos;s folder
              (e.g. <code>primary</code>). A generated Houdini project reaches them by a
              relative path (<code>$HIP/…</code>), so everything stays moveable.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            This character has no folder of its own (its definition sits in the project root), so
            it has no export directory. Move it into a folder to export.
          </p>
        )}
      </div>
    </section>
  )
}
