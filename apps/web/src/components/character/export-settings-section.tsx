import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { GuideLink } from '#/components/guide-link.tsx'
import { InfoPopup } from '@dth/ui'
import { displayPath } from '#/lib/path.ts'

/** The guide's direct-export section — the single source of truth for how the
 *  export directory + its two switches behave (the panel's info popup links here
 *  instead of duplicating it). */
const EXPORT_GUIDE_URL =
  'https://polynaut.github.io/dth-character-studio/guide/05-rom-in-daz.html#direct-export-optional-recommended'

import type { Character } from '@dth/rom'

/**
 * The "Export directory" pane — read-only since schema v29. The directory is
 * DERIVED (`<character>/<daz subfolder>/dth-exports`, created at character
 * creation and re-resolved on every save), so there is nothing to pick and
 * nothing that can drift; the panel exists to show where the exports land.
 *
 * The two export SWITCHES live in the "Daz scripts generated" section — they
 * shape the scripts, not the folder — and turning the export off is done there
 * ("Run the export with the ROM script"), not by clearing a path.
 */
export function ExportSettingsSection({ character }: { character: Character }) {
  return (
    <section className="mb-8 rounded-lg border bg-card p-5">
      <h2 className="mb-4 flex w-fit items-center gap-1 text-xl font-semibold">
        Export directory
        <InfoPopup label="Export directory — more information">
          How the export directory works —{' '}
          <GuideLink href={EXPORT_GUIDE_URL}>open the guide</GuideLink>
        </InfoPopup>
      </h2>
      {character.exportPath ? (
        <>
          <PathCode path={displayPath(character.exportPath)} className={tallPathChipClass} />
          <p className="mt-3 text-xs text-muted-foreground">
            Fixed, beside the character&apos;s Daz scenes. Each scene exports into its own
            subfolder here, named after the scene&apos;s folder (e.g. <code>primary</code>).
            A generated Houdini project reaches these files by a relative path
            (<code>$JOB/…</code>), so everything stays moveable.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          This character has no folder of its own (its definition sits in the project root), so
          it has no export directory. Move it into a folder to export.
        </p>
      )}
    </section>
  )
}
