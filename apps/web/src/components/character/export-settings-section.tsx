import { useEffect, useState } from 'react'
import { FolderOpen, Trash2 } from 'lucide-react'

import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { GuideLink } from '#/components/guide-link.tsx'
import { Button, InfoPopup, Input, Label, OverrideMark, Switch, cn, overrideLabelClass } from '@dth/ui'
import { sceneOverrideSchema, sceneRecordEmpty } from '@dth/rom'
import { isDirectory } from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath, parentDir } from '#/lib/path.ts'

/** The guide's direct-export section — the single source of truth for how the
 *  export directory + its two switches behave (the panel's info popup links here
 *  instead of duplicating it). */
const EXPORT_GUIDE_URL =
  'https://polynaut.github.io/dth-character-studio/guide/05-rom-in-daz.html#direct-export-optional-recommended'

/** Folder-name-safe: the Windows-illegal characters collapse to one space
 *  (mirrors defaultHoudiniProjectFolder's cleaning in @dth/rom). */
function cleanFolderName(value: string): string {
  return value
    .trim()
    .replace(/[\r\n<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character, SceneOverride } from '@dth/rom'

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
  overrideEligible,
  sceneOverride,
  effectiveScene,
}: {
  character: Character
  saving: boolean
  persistPatch: PersistCharacterPatch
  location: CharacterLocation | null
  /** The project's Houdini subfolder name (guides the first folder pick). */
  houdiniSubdir: string | undefined
  /** True while an extra (non-primary) Daz scene is selected — the Houdini
   *  project folder can then be overridden per scene (useSceneSelection). */
  overrideEligible: boolean
  sceneOverride: SceneOverride | undefined
  /** The selected scene's path (keys the override record). */
  effectiveScene: string
}) {
  // The Houdini project folder under the implicit-override model: with a
  // non-primary scene selected the field edits that scene's record — a value
  // differing from the base IS the override ('' included: "this scene exports
  // flat"). Committed on blur/Enter through persistPatch, like everything in
  // this pane (the folder only takes effect at generation time).
  const projectOverridden =
    overrideEligible && sceneOverride?.houdiniProjectFolder !== undefined
  const effectiveProject = projectOverridden
    ? (sceneOverride?.houdiniProjectFolder ?? '')
    : character.houdiniProjectFolder
  const [projectDraft, setProjectDraft] = useState(effectiveProject)
  // Resync the local text when the effective value changes under it (scene
  // selection moved, a persist settled, another window saved).
  useEffect(() => setProjectDraft(effectiveProject), [effectiveProject, effectiveScene])

  function commitProjectFolder(raw: string) {
    const value = cleanFolderName(raw)
    setProjectDraft(value)
    if (value === effectiveProject) return
    if (!overrideEligible) {
      void persistPatch(
        { houdiniProjectFolder: value },
        {
          toast: value
            ? 'Houdini project folder set — script regenerated'
            : 'Houdini project folder cleared — exports go directly into the export directory',
        },
      )
      return
    }
    const record =
      sceneOverride ?? sceneOverrideSchema.parse({ scenePath: effectiveScene })
    const next: SceneOverride = {
      ...record,
      houdiniProjectFolder: value === character.houdiniProjectFolder ? undefined : value,
    }
    const others = character.sceneOverrides.filter((o) => o.scenePath !== effectiveScene)
    void persistPatch(
      { sceneOverrides: sceneRecordEmpty(next) ? others : [...others, next] },
      {
        toast:
          next.houdiniProjectFolder === undefined
            ? "Scene follows the character's Houdini project folder — script regenerated"
            : value
              ? 'Scene exports into its own Houdini project folder — script regenerated'
              : 'Scene exports directly into the export directory — script regenerated',
      },
    )
  }
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
      <h2 className="mb-4 flex w-fit items-center gap-1 text-xl font-semibold">
        Export directory
        <InfoPopup label="Export directory — more information">
          How the export directory works —{' '}
          <GuideLink href={EXPORT_GUIDE_URL}>open the guide</GuideLink>
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
              className={tallPathChipClass}
            />
            {/* Icon-only destructive button (gray border → red on hover) so Clear
                reads as a real action next to Change… (matching that chip/button
                height + weight) rather than a link. Bin glyph, like the preserve
                rows' delete. */}
            <Button
              variant="outline-destructive"
              size="icon"
              aria-label="Clear the export directory"
              onClick={() =>
                void persistPatch(
                  { exportPath: '' },
                  { toast: 'Export folder cleared — script regenerated' },
                )
              }
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
      {/* The Houdini project folder (schema v27): when set, everything nests
          under <folder>/dth-export/<scene subfolder>/ so a Houdini project can
          "Set Project" there and import JOB-relative. Overridable per Daz
          scene under the implicit model (like the identity dials). */}
      <div className="mt-4">
        <Label
          htmlFor="houdini-project-folder"
          className={cn('mb-1', overrideLabelClass(projectOverridden, overrideEligible))}
        >
          Houdini project folder
          {overrideEligible && (
            <OverrideMark
              overridden={projectOverridden}
              onReset={() => commitProjectFolder(character.houdiniProjectFolder)}
            />
          )}
          <InfoPopup label="Houdini project folder — more information">
            When set, everything exports into{' '}
            <code>{'<folder>/dth-export/<scene subfolder>/'}</code> inside the export
            directory — use Houdini&apos;s <em>Set Project</em> on that folder and import
            JOB-relative (<code>$JOB/dth-export/…</code>). Leave it empty to export each
            scene&apos;s subfolder directly into the export directory. With a non-primary
            Daz scene selected the field overrides per scene — including emptied, for a
            scene that should export flat.
          </InfoPopup>
        </Label>
        <Input
          id="houdini-project-folder"
          className={cn(
            'w-72',
            projectOverridden && 'border-daz-green',
            overrideEligible && !projectOverridden && 'text-muted-foreground',
          )}
          placeholder="No project folder — export directly"
          disabled={!character.exportPath || saving}
          value={projectDraft}
          onChange={(e) => setProjectDraft(e.target.value)}
          onBlur={() => commitProjectFolder(projectDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setProjectDraft(effectiveProject)
          }}
        />
      </div>
      {character.exportPath && (
        <p className="mt-3 text-xs text-muted-foreground">
          {effectiveProject ? (
            <>
              This scene exports into{' '}
              <code>
                {effectiveProject}/dth-export/{'<scene subfolder>'}/
              </code>{' '}
              — Set Project a Houdini project to{' '}
              <code>{displayPath(`${character.exportPath}/${effectiveProject}`)}</code> and
              import via <code>$JOB/dth-export/…</code>.
            </>
          ) : (
            <>
              Each scene exports into its own subfolder here, named after the scene&apos;s
              folder (e.g. <code>primary</code>).
            </>
          )}
        </p>
      )}
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
      <div className="mt-4 flex items-center gap-3">
        <Switch
          checked={character.exportHairAssets}
          disabled={!character.exportPath || saving}
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
          className={`text-sm${character.exportPath ? '' : ' text-muted-foreground'}`}
          title="After the main export, each of the open scene's hair items is exported on its own (the Export_Hair pass) — in the combined ROM script and the split Export script alike"
        >
          Export hair assets too
        </span>
      </div>
    </section>
  )
}
