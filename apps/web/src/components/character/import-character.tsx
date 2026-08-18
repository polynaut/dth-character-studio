import { useMemo, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import { toast } from 'sonner'

import { Button, Modal, Switch } from '@dth/ui'
import { pickZipPath } from '#/lib/desktop.ts'
import { filledSections, sectionContentSummary } from '#/lib/fill-sections.ts'
import {
  importCharacterZip,
  readCharacterZipManifest,
  readCharacterZipSummary,
} from '#/lib/rom/api.ts'
import { SECTION_LABELS } from '@dth/rom'

import type { Character, Gender, GenesisVersion, RomSection } from '@dth/rom'
import type {
  CharacterZipImportChoices,
  CharacterZipManifest,
  CharacterZipSummary,
} from '#/lib/rom/api.ts'

/**
 * The whole Import-from-zip flow as ONE hook, shared by its two entry points.
 *
 * On a CHARACTER page (`target` set — the Import button + the page-wide zip
 * drop) it opens the OVERWRITE WIZARD: a Fill-style dialog where the user
 * renames the character (pre-filled with the zip's name), picks which of the
 * zip's ROM sections/extras to take, which of its Daz scenes to restore (the
 * primary is mandatory — the target's own scenes are always wiped), and which
 * Houdini projects to bring, added beside or replacing the target's own.
 *
 * On a PROJECT page (`target` null — the page-wide drop) the zip restores
 * wholesale as a new character behind a simple confirm.
 *
 * Either way the import surfaces every warning it couldn't fix silently
 * (Houdini paths, regeneration), then hands the imported character to
 * `onImported` for navigation/remount.
 */
export function useImportCharacterZip(opts: {
  projectId: string
  /** Overwrite mode: the character this page shows. Null = create mode. */
  target: { id: string; name: string; genesis: GenesisVersion; gender: Gender } | null
  onImported: (character: Character) => void | Promise<void>
}) {
  const [pending, setPending] = useState<
    | { kind: 'create'; zipPath: string; manifest: CharacterZipManifest }
    | { kind: 'overwrite'; zipPath: string; summary: CharacterZipSummary }
    | null
  >(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function openZip(zipPath: string) {
    try {
      if (opts.target) {
        const summary = await readCharacterZipSummary({ data: { zipPath } })
        setPending({ kind: 'overwrite', zipPath, summary })
      } else {
        const manifest = await readCharacterZipManifest({ data: { zipPath } })
        setPending({ kind: 'create', zipPath, manifest })
      }
      setError('')
    } catch (e) {
      // A foreign/newer zip never opens the dialog — the reason is the message.
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function openPicker() {
    const picked = await pickZipPath('Select a character export (.dcsc.zip)')
    if (picked) await openZip(picked)
  }

  async function onConfirm(choices?: CharacterZipImportChoices) {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      const result = await importCharacterZip({
        data: {
          projectId: opts.projectId,
          zipPath: pending.zipPath,
          mode: opts.target ? 'overwrite' : 'create',
          targetId: opts.target?.id,
          choices,
        },
      })
      setPending(null)
      toast.success(
        opts.target
          ? `Imported “${result.character.name}” over “${opts.target.name}”`
          : `Imported “${result.character.name}”`,
      )
      // Longer-lived than a success blip: each names something the import could
      // NOT fix and what to do about it.
      for (const warning of result.warnings) toast.warning(warning, { duration: 15000 })
      await opts.onImported(result.character)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const dialog =
    pending?.kind === 'overwrite' && opts.target ? (
      <ImportCharacterWizard
        summary={pending.summary}
        target={opts.target}
        busy={busy}
        error={error}
        onConfirm={(choices) => void onConfirm(choices)}
        onClose={() => {
          if (!busy) setPending(null)
        }}
      />
    ) : pending?.kind === 'create' ? (
      <ImportCreateDialog
        manifest={pending.manifest}
        busy={busy}
        error={error}
        onConfirm={() => void onConfirm()}
        onClose={() => {
          if (!busy) setPending(null)
        }}
      />
    ) : null

  return {
    openPicker: () => void openPicker(),
    openZip: (zipPath: string) => void openZip(zipPath),
    dialog,
  }
}

/** `2026-08-11T…` → a local date-time, or the raw string when unparsable. */
function exportedAtLabel(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/** Filename without its directory, for the scene/houdini rows. */
function fileLabel(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

const checkboxRow =
  'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground'

/**
 * The overwrite wizard (see {@link useImportCharacterZip}). Defaults lean
 * RESTORE: every offered section, extra, scene and Houdini project starts
 * checked and Houdini starts in replace mode — unchecking is how the user
 * keeps something of the target. A zip of a different generation/gender forces
 * the full ROM: keeping this character's sections would mix per-generation
 * morph names and frame math.
 */
function ImportCharacterWizard({
  summary,
  target,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  summary: CharacterZipSummary
  target: { id: string; name: string; genesis: GenesisVersion; gender: Gender }
  busy: boolean
  error: string
  onConfirm: (choices: CharacterZipImportChoices) => void
  onClose: () => void
}) {
  const zip = summary.character
  const offered = useMemo(() => filledSections(zip.sections), [zip.sections])
  // Cross-generation/gender: the target's ROM cannot survive (morph names,
  // preset assets and frame math are per-generation) — everything is the zip's.
  const forceAll = zip.genesis !== target.genesis || zip.gender !== target.gender

  const [name, setName] = useState(zip.name)
  const [checked, setChecked] = useState<ReadonlySet<RomSection>>(
    () => new Set(offered.filter((section) => section !== 'RET')),
  )
  const [extras, setExtras] = useState({ jcmRules: true, preserveNodeTransforms: true })
  const [scenes, setScenes] = useState<ReadonlySet<string>>(
    () => new Set(summary.scenes.map((scene) => scene.path)),
  )
  const [houdini, setHoudini] = useState<ReadonlySet<string>>(
    () => new Set(summary.houdiniProjects.map((hip) => hip.path)),
  )
  const [houdiniReplace, setHoudiniReplace] = useState(true)

  const nameTrimmed = name.trim()
  const nameError = /\.json$/i.test(nameTrimmed) ? 'A character name can’t end in “.json”.' : ''
  const canImport = Boolean(nameTrimmed) && !nameError

  const offeredExtras = [
    ...(zip.jcmMorphMods.length > 0 ? (['jcmRules'] as const) : []),
    ...(zip.preserveNodeTransforms.length > 0 ? (['preserveNodeTransforms'] as const) : []),
  ]
  const extraLabels = {
    jcmRules: `Modify JCM frames (${zip.jcmMorphMods.length})`,
    preserveNodeTransforms: `Preserve node transforms (${zip.preserveNodeTransforms.length})`,
  } as const

  function toggleSection(section: RomSection, on: boolean) {
    if (forceAll || section === 'RET') return
    const set = new Set(checked)
    if (on) set.add(section)
    else set.delete(section)
    setChecked(set)
  }

  function toggleIn(set: ReadonlySet<string>, value: string, on: boolean): Set<string> {
    const next = new Set(set)
    if (on) next.add(value)
    else next.delete(value)
    return next
  }

  function confirm() {
    if (!canImport) return
    // RET copies exactly when JCM does — the same tie as the Fill wizard.
    const sections = forceAll
      ? offered
      : offered.filter((section) => (section === 'RET' ? checked.has('JCM') : checked.has(section)))
    onConfirm({
      name: nameTrimmed,
      sections,
      extras: forceAll ? { jcmRules: true, preserveNodeTransforms: true } : extras,
      scenes: summary.scenes
        .filter((scene) => scene.primary || scenes.has(scene.path))
        .map((scene) => scene.path),
      houdini: {
        mode: houdiniReplace ? 'overwrite' : 'add',
        projects: summary.houdiniProjects
          .filter((hip) => houdini.has(hip.path))
          .map((hip) => hip.path),
      },
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Import over “${target.name}”`}
      dismissible={!busy}
      className="flex max-w-2xl flex-col overflow-hidden"
    >
      <p className="text-sm text-muted-foreground">
        Restore “{summary.manifest.characterName}”
        {summary.manifest.sourceProjectName
          ? ` (exported ${exportedAtLabel(summary.manifest.exportedAt)} from “${summary.manifest.sourceProjectName}”)`
          : ''}{' '}
        over this character. Its Daz scenes are <strong>replaced</strong> by the zip’s selection
        below; notes, avatar and the studio’s metadata come from the zip. This cannot be undone.
      </p>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Character name</span>
          <input
            type="text"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Character name"
          />
          {nameError && <span className="mt-1 block text-xs text-destructive">{nameError}</span>}
        </label>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            Daz scenes — the zip’s scenes replace this character’s
          </p>
          <ul className="space-y-1">
            {summary.scenes.length === 0 && (
              <li className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                The zip links no Daz scenes.
              </li>
            )}
            {summary.scenes.map((scene) => (
              <li key={scene.path}>
                <label
                  className={checkboxRow}
                  title={
                    scene.primary
                      ? 'The primary scene is always part of the import'
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    disabled={scene.primary}
                    checked={scene.primary || scenes.has(scene.path)}
                    onChange={(e) => setScenes(toggleIn(scenes, scene.path, e.target.checked))}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {fileLabel(scene.path)}
                  </span>
                  {scene.primary && (
                    <span className="shrink-0 text-xs text-muted-foreground">primary</span>
                  )}
                  {!scene.inZip && (
                    <span
                      className="shrink-0 text-xs text-muted-foreground"
                      title="The scene file itself is not in the zip (it was linked in place outside the character folder) — only the link is restored"
                    >
                      link only
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        </div>

        {summary.houdiniProjects.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Houdini projects</p>
            <ul className="space-y-1">
              {summary.houdiniProjects.map((hip) => (
                <li key={hip.path}>
                  <label className={checkboxRow}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={houdini.has(hip.path)}
                      onChange={(e) => setHoudini(toggleIn(houdini, hip.path, e.target.checked))}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {fileLabel(hip.path)}
                    </span>
                    {!hip.inZip && (
                      <span
                        className="shrink-0 text-xs text-muted-foreground"
                        title="The project file itself is not in the zip — only the link is restored"
                      >
                        link only
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            <label
              className="mt-2 flex h-9 w-fit items-center gap-2 text-sm"
              title="On: the character's existing Houdini projects are removed and the zip's take their place. Off: the zip's projects are added beside the existing ones."
            >
              <Switch checked={houdiniReplace} onCheckedChange={setHoudiniReplace} />
              Replace this character’s existing Houdini projects
            </label>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            ROM sections from the zip — unchecked keep “{target.name}”’s config
          </p>
          {forceAll && (
            <p className="mb-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              The zip is a {zip.genesis} {zip.gender} character, this one is {target.genesis}{' '}
              {target.gender} — ROM definitions don’t mix across generations or genders, so the
              zip’s full ROM is imported.
            </p>
          )}
          <ul className="space-y-1">
            {offered.map((section) => {
              const tiedToJcm = section === 'RET'
              return (
                <li key={section}>
                  <label
                    className={tiedToJcm || forceAll ? `${checkboxRow} cursor-default` : checkboxRow}
                    title={
                      tiedToJcm
                        ? 'The retargeting poses are part of the JCM base ROM — imported together with the JCM section'
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      disabled={tiedToJcm || forceAll}
                      checked={forceAll || (tiedToJcm ? checked.has('JCM') : checked.has(section))}
                      onChange={(e) => toggleSection(section, e.target.checked)}
                    />
                    <span className="font-medium">{SECTION_LABELS[section]}</span>
                    <span className="text-xs text-muted-foreground">{section}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {tiedToJcm ? 'with JCM' : sectionContentSummary(zip.sections[section])}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {offeredExtras.length > 0 && !forceAll && (
            <div className="mt-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Also from the zip</p>
              <ul className="space-y-1">
                {offeredExtras.map((extra) => (
                  <li key={extra}>
                    <label className={checkboxRow}>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={extras[extra]}
                        onChange={(e) => setExtras({ ...extras, [extra]: e.target.checked })}
                      />
                      <span className="font-medium">{extraLabels[extra]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {/* Fire and forget on purpose — `busy`/`error` are the dialog's channel. */}
        <Button variant="destructive" disabled={busy || !canImport} onClick={confirm}>
          <PackageOpen /> {busy ? 'Importing…' : 'Import'}
        </Button>
      </div>
    </Modal>
  )
}

/** The project-level (create) confirm: the zip restores wholesale as a new
 *  character — no granularity to collect, just an informed OK. */
function ImportCreateDialog({
  manifest,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  manifest: CharacterZipManifest
  busy: boolean
  error: string
  onConfirm: () => void
  onClose: () => void
}) {
  const exportedAt = exportedAtLabel(manifest.exportedAt)
  const includes = [
    manifest.includes.dazExports ? 'Daz exports included' : 'no Daz exports',
    manifest.includes.houdiniExports ? 'Houdini exports included' : 'no Houdini exports',
  ].join(', ')
  return (
    <Modal open onClose={onClose} title={`Import “${manifest.characterName}”`} dismissible={!busy}>
      <p className="text-sm text-muted-foreground">
        Restores the zip’s character — with all of its data — as a new character of this project.
      </p>
      <div className="space-y-1 rounded-md border bg-card p-3 text-sm">
        <div>
          <span className="text-muted-foreground">Character:</span> {manifest.characterName}
        </div>
        {exportedAt && (
          <div>
            <span className="text-muted-foreground">Exported:</span> {exportedAt}
            {manifest.sourceProjectName ? ` — from “${manifest.sourceProjectName}”` : ''}
          </div>
        )}
        <div className="text-xs text-muted-foreground">{includes}</div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {/* Fire and forget on purpose — `busy`/`error` are the dialog's channel. */}
        <Button disabled={busy} onClick={onConfirm}>
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </div>
    </Modal>
  )
}
