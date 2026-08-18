import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { GuideLink } from '#/components/guide-link.tsx'
import { InfoPopup, Switch } from '@dth/ui'
import { displayPath } from '#/lib/path.ts'

import type { RootedDir } from '#/lib/character-paths.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character } from '@dth/rom'

/** The guide's direct-export section — the single source of truth for how the
 *  export directory behaves (the sub-section's info popup links here instead
 *  of duplicating it). */
const EXPORT_GUIDE_URL =
  'https://polynaut.github.io/dth-character-studio/guide/05-rom-in-daz.html#direct-export-optional-recommended'

/**
 * The "Daz scripts generated" pane: where the generated
 * ROM_/Export_ scripts install in the Daz library, so the user knows where to
 * find/run them in Daz — or the setup notice while no library is set. The two
 * export switches live here (they shape WHICH scripts generate and what the
 * export pass covers); like every export setting they persist + regenerate
 * immediately via `persistPatch`, so the on-disk scripts never lag the toggle.
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
      <div className="mt-5 border-t pt-4">
        <h3 className="mb-3 flex w-fit items-center gap-1 text-sm font-semibold">
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
