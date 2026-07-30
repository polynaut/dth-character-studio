import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'

import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { GuideLink } from '#/components/guide-link.tsx'
import {
  Button,
  InfoPopup,
  Input,
  Label,
  OverrideMark,
  cn,
  overrideLabelClass,
} from '@dth/ui'
import { isDirectory } from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath, parentDir } from '#/lib/path.ts'
import { sceneOverrideSchema, sceneRecordEmpty } from '@dth/rom'

/** The guide's direct-export section — the single source of truth for how the
 *  export directory + its two switches behave (the panel's info popup links here
 *  instead of duplicating it). */
const EXPORT_GUIDE_URL =
  'https://polynaut.github.io/dth-character-studio/guide/05-rom-in-daz.html#direct-export-optional-recommended'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character, SceneOverride } from '@dth/rom'

/** Folder-name-safe: the Windows-illegal characters collapse to one space
 *  (mirrors defaultHoudiniProjectFolder's cleaning in @dth/rom). */
function cleanFolderName(value: string): string {
  return value
    .trim()
    .replace(/[\r\n<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The "Export directory" pane: the directory itself and the Houdini project
 * folder (a layer of that directory's layout). The two export SWITCHES live in
 * the "Daz scripts generated" section — they shape the scripts, not the folder.
 * Export settings only take effect once the script is regenerated (the export
 * block is emitted at generation time), so every control persists + regenerates
 * immediately via `persistPatch` — like the inline rename — instead of leaving
 * them as dirty edits a manual Save might miss. Otherwise the on-disk script
 * silently lags the chosen folder.
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

  // The Houdini project folder under the implicit-override model: with a
  // non-primary scene selected the field edits that scene's record — a value
  // differing from the base IS the override ('' included: "this scene exports
  // flat"). Committed on blur/Enter through persistPatch (the folder only
  // takes effect at generation time). Active only WITH an export directory —
  // the folder is a layer of the export layout.
  const projectOverridden = overrideEligible && sceneOverride?.houdiniProjectFolder !== undefined
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
    const record = sceneOverride ?? sceneOverrideSchema.parse({ scenePath: effectiveScene })
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
        {/* No Clear: an export directory can only be repointed, never removed —
            new characters start with one (the seeded houdini folder), and the
            whole export/Houdini pipeline builds on it existing. */}
        <Button type="button" variant="outline" onClick={onPickExportDir}>
          <FolderOpen /> {character.exportPath ? 'Change…' : 'Choose folder…'}
        </Button>
        {character.exportPath && (
          // Taller chip so it lines up with the h-9 button beside it.
          <PathCode path={displayPath(character.exportPath)} className={tallPathChipClass} />
        )}
      </div>
      {/* The Houdini project folder (schema v27): a LAYER of the export layout —
          when set, everything exports into <folder>/dth-export/<scene subfolder>/
          so a Houdini project can "Set Project" there and import JOB-relative.
          Overridable per Daz scene under the implicit model (like the identity
          dials). */}
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
            JOB-relative (<code>$JOB/dth-export/…</code>), or let the Houdini projects
            section&apos;s <em>Generate project</em> build the whole project for you. Leave
            it empty to export each scene&apos;s subfolder directly into the export
            directory. With a non-primary Daz scene selected the field overrides per scene —
            including emptied, for a scene that should export flat.
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
          disabled={!character.exportPath.trim() || saving}
          title={character.exportPath.trim() ? undefined : 'Set an export directory first'}
          value={projectDraft}
          onChange={(e) => setProjectDraft(e.target.value)}
          onBlur={() => commitProjectFolder(projectDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setProjectDraft(effectiveProject)
          }}
        />
        {character.exportPath.trim() !== '' && (
          <p className="mt-2 text-xs text-muted-foreground">
            {effectiveProject ? (
              <>
                This scene exports into{' '}
                <code>
                  {/* The gray ./<export-dir name> prefix anchors the chip: the path
                      is relative to the configured export directory. */}
                  <span className="opacity-60">
                    ./{character.exportPath.replace(/\\/g, '/').split('/').filter(Boolean).pop()}/
                  </span>
                  {effectiveProject}/dth-export/{'<scene subfolder>'}/
                </code>
                .
              </>
            ) : (
              <>
                Each scene exports into its own subfolder here, named after the scene&apos;s
                folder (e.g. <code>primary</code>).
              </>
            )}
          </p>
        )}
      </div>
    </section>
  )
}
