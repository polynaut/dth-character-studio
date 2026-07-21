import { FolderOpen, X } from 'lucide-react'

import { PathCode } from '#/components/path-code.tsx'
import { Button, InfoPopup, Switch } from '@dth/ui'
import { isDirectory } from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath, normalizePath } from '#/lib/path.ts'

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
    const charDir = normalizePath(definitionAbs).replace(/\/[^/]*$/, '')
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
      <h2 className="mb-4 flex w-fit items-center gap-1 text-xl font-semibold">
        Export directory
        <InfoPopup label="Export directory — more information">
          Set an export directory and the generated Daz script runs the DTH Exporter Plugin
          (v1.8.1+) automatically after building the ROM — writing{' '}
          {character.exportPath ? (
            <>
              <code>{character.name}</code>.abc / .dth and copying the PoseAsset CSV into that
              folder
            </>
          ) : (
            'straight into the DTH pipeline'
          )}
          . Leave empty to skip auto-export. Reference frames are taken from the ROM's
          reference-skeleton poses.
        </InfoPopup>
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={onPickExportDir}>
          <FolderOpen /> {character.exportPath ? 'Change…' : 'Choose folder…'}
        </Button>
        {character.exportPath && (
          <>
            <PathCode path={displayPath(character.exportPath)} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void persistPatch(
                  { exportPath: '' },
                  { toast: 'Export folder cleared — script regenerated' },
                )
              }
            >
              <X /> Clear
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
          className={`flex items-center gap-1 text-sm${character.exportPath ? '' : ' text-muted-foreground'}`}
        >
          Generate subfolders based on Daz scenes
          <InfoPopup label="Generate subfolders based on Daz scenes — more information">
            When on, the export is nested under a subfolder named after the Daz scene open in Daz
            when the script runs (resolved at run time) — so a character's scene/outfit variants
            export side by side. The exporter output and the PoseAsset CSV land directly in that
            scene subfolder. Falls back to the export root if no scene is saved.{' '}
            {!character.exportPath && 'Set an export folder above to enable this.'}
          </InfoPopup>
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
          className={`flex items-center gap-1 text-sm${character.exportPath ? '' : ' text-muted-foreground'}`}
        >
          Run the export with the ROM script
          <InfoPopup label="Run the export with the ROM script — more information">
            On: one <code>ROM_{character.name}_{character.genesis}.dsa</code> builds the ROM and
            runs the export. Off: the export splits into its own{' '}
            <code>Export_{character.name}_{character.genesis}.dsa</code> beside the ROM script, so
            you can re-export — for another Daz scene, or after a failed export — without rebuilding
            the ROM. Run the Export script after the ROM script in the same Daz session.{' '}
            {!character.exportPath && 'Set an export folder above to enable this.'}
          </InfoPopup>
        </span>
      </div>
    </section>
  )
}
