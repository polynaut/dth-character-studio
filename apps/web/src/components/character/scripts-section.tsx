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
 * Two read-only directory sub-sections live at the bottom, one per pipeline
 * stage: the **Daz export directory** (derived since schema v29 —
 * `<character>/<houdini subfolder>/daz-export`, where the export scripts
 * deliver and the `.hip`s read), and the **Export directory** (the project's
 * `exportSubdir` inside the character folder — where the Houdini DTH networks
 * write the files that are then imported into Unreal Engine). Nothing to pick
 * in either; they only say where things land.
 */
export function ScriptsSection({
  character,
  scriptsPath,
  finalExportDir,
}: {
  character: Character
  /** From lib/character-paths.ts; null until "My DAZ 3D Library" is set. */
  scriptsPath: RootedDir | null
  /** The FINAL export folder (`characterFinalExportDisplay`); null for a
   *  character without a folder of its own. */
  finalExportDir: string | null
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
          Daz export directory
          <InfoPopup label="Daz export directory — more information">
            How the Daz export directory works —{' '}
            <GuideLink href={EXPORT_GUIDE_URL}>open the guide</GuideLink>
          </InfoPopup>
        </h3>
        {exportSet ? (
          <>
            <PathCode path={displayPath(character.exportPath)} className={tallPathChipClass} />
            <p className="mt-3 text-xs text-muted-foreground">
              Where the Daz export scripts deliver, beside the Houdini projects that read it —
              one subfolder per scene (e.g. <code>primary</code>), reached from the{' '}
              <code>.hip</code>s by relative path.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            This character has no folder of its own (its definition sits in the project root), so
            it has no export directory. Move it into a folder to export.
          </p>
        )}
      </div>
      {exportSet && finalExportDir ? (
        <div className="mt-5 border-t pt-4">
          <h3 className="mb-3 flex w-fit items-center gap-1 text-xl font-semibold">
            Export directory
            <InfoPopup label="Export directory — more information">
              The pipeline&apos;s final stop: the DazToHue networks in the character&apos;s
              Houdini projects export here, and these files are what gets imported into Unreal
              Engine.
            </InfoPopup>
          </h3>
          <PathCode path={finalExportDir} className={tallPathChipClass} />
          <p className="mt-3 text-xs text-muted-foreground">
            The final export — what the Houdini DTH networks write, imported from here into
            Unreal Engine.
          </p>
        </div>
      ) : null}
    </section>
  )
}
