import { FolderOpen, Trash2 } from 'lucide-react'

import { PathCode } from '#/components/path-code.tsx'
import { GuideLink } from '#/components/guide-link.tsx'
import { Button, InfoPopup, Switch } from '@dth/ui'
import { isDirectory } from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath, parentDir } from '#/lib/path.ts'

/** The guide's direct-export section — the single source of truth for how the
 *  export directory + its two switches behave (the panel's info popup links here
 *  instead of duplicating it). */
const EXPORT_GUIDE_URL =
  'https://polynaut.github.io/dth-character-studio/guide/05-rom-in-daz.html#direct-export-optional-recommended'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character } from '@dth/rom'

/**
 * The "Export directory" pane. Export settings only take effect once the
 * script is regenerated (the export block is emitted at generation time), so
 * every control persists + regenerates immediately via `persistPatch` — like
 * the inline rename — instead of leaving them as dirty edits a manual Save
 * might miss. Otherwise the on-disk script silently lags the chosen folder.
 */
export function ExportSettingsSection({
  character,
  saving,
  persistPatch,
  location,
  houdiniSubdir,
}: {
  character: Character
  saving: boolean
  persistPatch: PersistCharacterPatch
  location: CharacterLocation | null
  /** The project's Houdini subfolder name (guides the first folder pick). */
  houdiniSubdir: string | undefined
}) {
  // Guide the export-folder picker to where the export usually lands: re-choosing
  // starts at the current dir; a first pick opens in the character's folder —
  // already inside its Houdini subfolder when that subfolder exists on disk. The
  // user can still browse elsewhere; this is only where the dialog opens.
  async function defaultExportDir(): Promise<string | undefined> {
    if (character.exportPath.trim()) return character.exportPath
    const definitionAbs = location?.definitionAbs
    if (!definitionAbs) return undefined
    const charDir = parentDir(definitionAbs)
    const houSub = houdiniSubdir?.trim()
    if (houSub) {
      const houDir = `${charDir}/${houSub}`
      if (await isDirectory(houDir)) return houDir
    }
    return charDir
  }

  async function onPickExportDir() {
    const picked = await pickFolder(
      'Choose the export directory for the DTH Exporter',
      await defaultExportDir(),
    )
    if (picked)
      await persistPatch(
        { exportPath: picked },
        { toast: 'Export folder set — script regenerated' },
      )
  }

  return (
    <section className="mb-8 rounded-lg border bg-card p-5">
      <h2 className="sticky top-[var(--editor-header-h)] z-[6] -mx-5 -mt-5 flex items-center gap-1 rounded-t-lg bg-card px-5 pt-5 pb-4 text-xl font-semibold">
        Export directory
        <InfoPopup label="Export directory — more information">
          <GuideLink href={EXPORT_GUIDE_URL}>How the export directory works — open the guide</GuideLink>
        </InfoPopup>
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={onPickExportDir}>
          <FolderOpen /> {character.exportPath ? 'Change…' : 'Choose folder…'}
        </Button>
        {character.exportPath && (
          <>
            {/* Taller chip so it lines up with the h-9 buttons on either side. */}
            <PathCode
              path={displayPath(character.exportPath)}
              className="flex h-9 items-center"
            />
            {/* Clear button styled like the Advanced-options bin: a light-bordered
                ghost icon button with a red trash, matching that height + weight. */}
            <Button
              variant="ghost"
              size="icon"
              className="size-9 shrink-0 border border-input"
              aria-label="Clear the export directory"
              onClick={() =>
                void persistPatch(
                  { exportPath: '' },
                  { toast: 'Export folder cleared — script regenerated' },
                )
              }
            >
              <Trash2 className="size-3.5 text-destructive" />
            </Button>
          </>
        )}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Switch
          checked={character.exportSceneSubfolders}
          disabled={!character.exportPath || saving}
          onCheckedChange={(exportSceneSubfolders) =>
            void persistPatch(
              { exportSceneSubfolders },
              { toast: `Scene subfolders ${exportSceneSubfolders ? 'on' : 'off'} — script regenerated` },
            )
          }
        />
        <span
          className={`text-sm${character.exportPath ? '' : ' text-muted-foreground'}`}
        >
          Generate subfolders based on Daz scenes
        </span>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Switch
          checked={character.exportWithRomScript}
          disabled={!character.exportPath || saving}
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
        <span
          className={`text-sm${character.exportPath ? '' : ' text-muted-foreground'}`}
        >
          Run the export with the ROM script
        </span>
      </div>
    </section>
  )
}
