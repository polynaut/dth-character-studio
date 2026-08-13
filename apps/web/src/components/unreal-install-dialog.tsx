import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FolderOpen, HardDriveDownload, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import {
  Button,
  InfoPopup,
  Input,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dth/ui'
import {
  createUnrealProject,
  detectUnrealEngines,
  fileExists,
  installUnrealBridge,
  installUnrealDthContent,
  installUnrealPlugin,
  scanUnrealPlugins,
  unrealProjectState,
} from '#/lib/rom/api.ts'
import { UNREAL_BRIDGE_FOLDER, UNREAL_BRIDGE_NAME } from '#/lib/rom/unreal-jobs.ts'
import {
  EMPTY_UNREAL_SCAN,
  allPluginBuilds,
  defaultUnrealEngine,
  engineVersionFromAssociation,
  matchPluginsToEngine,
  pluginBuildMismatch,
  pluginVersionLabel,
  unrealProjectNameError,
} from '#/lib/unreal-install.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { browseStart, displayPath, normalizePath } from '#/lib/path.ts'

import type { UnrealEngineFound, UnrealPluginSource } from '#/lib/unreal-install.ts'

/** "D:\…\ThighGlutes.uproject" → "ThighGlutes". */
function uprojectDisplayName(uprojectPath: string): string {
  const fileName = uprojectPath.split(/[\\/]/).pop() ?? uprojectPath
  return fileName.replace(/\.[^./\\]+$/, '')
}

/** The two entries that are not a scanned plugin build — always offered, and
 *  both engine-independent (content, and a content-only Python plugin). */
const DTH_CONTENT_KEY = 'dth-content'
const DTH_BRIDGE_KEY = 'dth-bridge'
/** Pre-checked even when the project's engine is unknown, unlike a build. */
const ENGINE_FREE_KEYS = [DTH_CONTENT_KEY, DTH_BRIDGE_KEY]

interface ChecklistItem {
  /** One of the two keys above, or the plugin build's path (unique per build). */
  key: string
  label: string
  /** The muted badge: the content target, or the build's engine label. */
  detail: string
  /** Already in the project — a check reinstalls (overwrites) it. */
  installed: boolean
  /** Absent for the studio's own two entries (content and bridge). */
  plugin?: UnrealPluginSource
  /** Ships INSIDE the app rather than coming from the user's plugin folders —
   *  said out loud on the row, because every other line in this list is
   *  something they downloaded and pointed the studio at. */
  builtIn?: boolean
  /** Its binaries were built against a DIFFERENT engine build than the one this
   *  project uses — Unreal will refuse to load it. Such an item is listed but
   *  never pre-checked (same rule as an unknown engine association). */
  buildMismatch?: boolean
}

/** The checklist items for one plugin scan + engine verdict. `null` engine
 *  (unknown association) lists EVERY build; the caller then pre-checks none of
 *  them — only the user knows what their source build fits. */
function buildItems(
  scan: ReadonlyArray<UnrealPluginSource>,
  engineVersion: string | null,
  state?: { dthPresent: boolean; installedPlugins: ReadonlyArray<string> },
  /** The engine this project actually uses, when the studio found it — its
   *  `buildId` both PICKS the build to offer per name (a matching one beats a
   *  mismatching one that only sorts first) and marks the one that is left. */
  engine?: UnrealEngineFound | null,
): Array<ChecklistItem> {
  const builds =
    engineVersion === null ? allPluginBuilds(scan) : matchPluginsToEngine(scan, engineVersion, engine)
  const installed = new Set((state?.installedPlugins ?? []).map((name) => name.toLowerCase()))
  return [
    {
      key: DTH_CONTENT_KEY,
      label: 'DTH content',
      detail: 'Content/DazToHue',
      installed: state?.dthPresent ?? false,
    },
    {
      // The studio's own plugin, installed like any other rather than appearing
      // on its own the first time a character is sent. Content-only Python, so
      // it fits every engine and carries no build to mismatch.
      key: DTH_BRIDGE_KEY,
      label: 'DTH Studio Bridge',
      detail: UNREAL_BRIDGE_FOLDER,
      installed: installed.has(UNREAL_BRIDGE_NAME.toLowerCase()),
      builtIn: true,
    },
    ...builds.map((plugin) => ({
      key: plugin.path,
      label: plugin.name,
      detail: pluginVersionLabel(plugin.engineVersion),
      installed: installed.has(plugin.name.toLowerCase()),
      plugin,
      buildMismatch: pluginBuildMismatch(plugin, engine),
    })),
  ]
}

/** What one dialog install run produced, for the toast + the caller. */
interface InstallOutcome {
  /** Success summaries, in run order ("DTH content (12 files)"). */
  installed: Array<string>
  /** `key` kept so a partial-failure retry can re-check exactly these. */
  failed: Array<{ key: string; label: string; message: string }>
  dthInstalled: boolean
}

/** What one item's install is, by key — three destinations, one uniform "how
 *  many files" answer so every row reports the same way. */
function installItem(item: ChecklistItem, uprojectPath: string): Promise<number> {
  if (item.plugin) {
    return installUnrealPlugin({
      data: { pluginPath: item.plugin.path, uprojectPath, overwrite: true },
    })
  }
  if (item.key === DTH_BRIDGE_KEY) return installUnrealBridge({ data: { uprojectPath } })
  return installUnrealDthContent({ data: { uprojectPath, overwrite: true } })
}

/** Run every checked item, sequentially (installs write into one project —
 *  parallel copies buy nothing and interleave errors). One failure does not
 *  stop the rest: each item is its own verdict. `overwrite: true` throughout —
 *  in a dialog, a CHECKED item is the explicit "make it this" intent the old
 *  Ctrl+click used to carry. */
async function runChecked(
  uprojectPath: string,
  items: ReadonlyArray<ChecklistItem>,
  checked: ReadonlySet<string>,
): Promise<InstallOutcome> {
  const outcome: InstallOutcome = { installed: [], failed: [], dthInstalled: false }
  for (const item of items) {
    if (!checked.has(item.key)) continue
    try {
      const files = await installItem(item, uprojectPath)
      outcome.installed.push(`${item.label} (${files} file${files === 1 ? '' : 's'})`)
      if (item.key === DTH_CONTENT_KEY) outcome.dthInstalled = true
    } catch (e) {
      outcome.failed.push({
        key: item.key,
        label: item.label,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return outcome
}

function toastOutcome(target: string, outcome: InstallOutcome) {
  const failedText = outcome.failed.map((f) => `${f.label}: ${f.message}`).join('; ')
  if (outcome.failed.length === 0) {
    toast.success(`Installed into ${target} — ${outcome.installed.join(', ')}`)
  } else if (outcome.installed.length > 0) {
    toast.warning(`Installed ${outcome.installed.join(', ')} — failed: ${failedText}`)
  } else {
    toast.error(`Install failed — ${failedText}`)
  }
}

function InstallChecklist({
  items,
  checked,
  busy,
  onToggle,
}: {
  items: Array<ChecklistItem>
  checked: ReadonlySet<string>
  busy: boolean
  onToggle: (key: string, on: boolean) => void
}) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.key}>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm hover:bg-accent/50">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-primary"
              disabled={busy}
              checked={checked.has(item.key)}
              onChange={(e) => onToggle(item.key, e.target.checked)}
            />
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{item.label}</span>
              <span className="rounded bg-muted px-1 py-0.5 text-xs font-medium">{item.detail}</span>
              {/* Every other row is a plugin the USER downloaded and pointed
                  the studio at; this one comes out of the app itself, and
                  where a build came from is the first thing you want to know
                  about a row you didn't put there. */}
              {item.builtIn && (
                <span
                  className="rounded bg-primary/15 px-1 py-0.5 text-xs font-medium text-primary"
                  title="Ships with DTH Character Studio — it is what Send to Unreal hands its jobs to. Not from your plugin folders."
                >
                  built in
                </span>
              )}
              {item.installed && (
                <span className="text-xs text-muted-foreground">
                  installed — a check overwrites it
                </span>
              )}
              {/* The one thing the version label CANNOT tell you: what the
                  binaries were actually compiled against. Left unchecked
                  rather than refused — the user may know something the
                  BuildId doesn't. */}
              {item.buildMismatch && (
                <span
                  className="flex items-center gap-1 text-xs text-amber-500"
                  title={`This build's binaries carry BuildId ${item.plugin?.buildId} — this project's engine expects a different one. Unreal would report it as "missing or built with a different engine version" and offer to rebuild.`}
                >
                  <AlertTriangle className="size-3.5 shrink-0" />
                  built for another engine build
                </span>
              )}
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}

/** Whether the checklist holds any SCANNED build — the studio's own two entries
 *  are always there and don't count as "plugins were found". */
function hasPluginBuilds(items: ReadonlyArray<ChecklistItem>): boolean {
  return items.some((item) => item.plugin !== undefined)
}

/** The dashed hint when the scan offered no plugin builds. */
function NoPluginsHint() {
  return (
    <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
      No matching plugins — add or check your plugin folders in Settings → General →{' '}
      <strong>Unreal Engine Plugins</strong>. DTH content installs either way.
    </p>
  )
}

/**
 * The install dialog behind a linked Unreal card's install button: what to
 * install — DTH content plus every configured plugin build matching the
 * project's engine version — pre-checked, uncheckable, one primary Install.
 *
 * The engine version is read from the `.uproject` when the dialog opens (never
 * stored — the user can retarget a project in Unreal at any time). An unknown
 * association (a source build's GUID) lists every build UNCHECKED instead:
 * only the user knows what fits, and a wrong plugin binary is a startup error
 * in Unreal.
 */
export function UnrealInstallDialog({
  uprojectPath,
  onClose,
  onInstalled,
}: {
  uprojectPath: string
  onClose: () => void
  /** DTH content was (re)installed — the card's probe cache adopts it. */
  onInstalled: (dthInstalled: boolean) => void
}) {
  const displayName = uprojectDisplayName(uprojectPath)
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [loadError, setLoadError] = useState('')
  const [engineVersion, setEngineVersion] = useState<string | null>(null)
  const [association, setAssociation] = useState('')
  const [items, setItems] = useState<Array<ChecklistItem>>([])
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<Array<ChecklistItem> | null> => {
    setLoadState('loading')
    try {
      const [state, scan, engines] = await Promise.all([
        unrealProjectState({ data: { uprojectPath } }),
        scanUnrealPlugins(),
        // The engine's own BuildId is what a plugin's binaries are judged
        // against; a failed detection just means no build check.
        detectUnrealEngines().catch(() => EMPTY_UNREAL_SCAN),
      ])
      const version = engineVersionFromAssociation(state.engineAssociation)
      const engine = engines.installs.find((e) => e.version === version) ?? null
      const list = buildItems(scan, version, state, engine)
      setAssociation(state.engineAssociation)
      setEngineVersion(version)
      setItems(list)
      // Everything pre-checked — the user unchecks. Two exceptions, same
      // reasoning both times (never pre-check what cannot be known to work):
      // an UNKNOWN engine leaves only the engine-independent items (DTH content
      // and the bridge — neither carries a binary), and a build whose binaries
      // are for another engine build is left off.
      setChecked(
        new Set(
          version === null
            ? ENGINE_FREE_KEYS
            : list.filter((item) => !item.buildMismatch).map((item) => item.key),
        ),
      )
      setLoadState('ready')
      return list
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setLoadState('error')
      return null
    }
  }, [uprojectPath])
  useEffect(() => {
    void load()
  }, [load])

  async function onInstall() {
    setBusy(true)
    try {
      const outcome = await runChecked(uprojectPath, items, checked)
      toastOutcome(displayName, outcome)
      if (outcome.dthInstalled) onInstalled(true)
      if (outcome.failed.length === 0) {
        onClose()
      } else {
        // Partial failure: stay open and re-probe, so the checklist tells the
        // truth about what IS there now instead of repeating the stale state —
        // and keep only the FAILED items checked: the retry redoes what went
        // wrong, not what already succeeded (and never discards a hand-picked
        // GUID-project selection back to the DTH-only default).
        const fresh = await load()
        const failedKeys = new Set(outcome.failed.map((f) => f.key))
        if (fresh) {
          setChecked(new Set(fresh.filter((item) => failedKeys.has(item.key)).map((item) => item.key)))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title={
        <span className="flex items-center gap-1.5">
          Install into {displayName}
          <InfoPopup label="Install into Unreal project — more information">
            <div className="space-y-2">
              <p>
                Installs the checked items into the linked Unreal project: the active DTH
                release&apos;s <strong>Unreal Engine Content</strong> into{' '}
                <code>Content/DazToHue</code>, and each checked plugin build into{' '}
                <code>Plugins/</code>.
              </p>
              <p>
                <strong>DTH Studio Bridge</strong> is the studio&apos;s own small plugin (pure
                Python, no binaries): it lets <em>Send to Unreal</em> hand this project a
                character&apos;s Houdini export. Unreal loads plugins at startup, so restart the
                editor once after installing it.
              </p>
              <p>
                Plugins come from your configured folders (Settings → General →{' '}
                <strong>Unreal Engine Plugins</strong>), matched to this project&apos;s engine
                version — read from its <code>.uproject</code> when this dialog opens.
              </p>
              <p>Installing copies over existing files; it never deletes anything first.</p>
            </div>
          </InfoPopup>
        </span>
      }
    >
      {loadState === 'loading' && (
        <p className="text-sm text-muted-foreground">Reading the project…</p>
      )}
      {loadState === 'error' && (
        <div className="space-y-2 text-sm">
          <p className="text-destructive">Couldn&apos;t read the Unreal project: {loadError}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {loadState === 'ready' && (
        <>
          {engineVersion !== null ? (
            <p className="text-sm text-muted-foreground">
              Project engine: <span className="font-medium text-foreground">Unreal Engine {engineVersion}</span>
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-amber-500">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Engine version unknown ({association === '' ? 'no engine association' : `association “${association}”`}{' '}
                — a source build?). Every found build is listed; check only what you know fits
                this engine. DTH content is engine-independent.
              </span>
            </p>
          )}
          <InstallChecklist
            items={items}
            checked={checked}
            busy={busy}
            onToggle={(key, on) =>
              setChecked((current) => {
                const next = new Set(current)
                if (on) next.add(key)
                else next.delete(key)
                return next
              })
            }
          />
          {!hasPluginBuilds(items) && <NoPluginsHint />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || checked.size === 0} onClick={() => void onInstall()}>
              <HardDriveDownload /> {busy ? 'Installing…' : 'Install'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

/**
 * The Generate dialog behind the Unreal bar's ✨ button: create a fresh
 * Blueprint-only project for a DETECTED engine version and install the
 * checked DTH content + plugins into it in the same run, then link it.
 *
 * Mirrors the character pages' Generate Houdini project: name + location +
 * live collision check, then one Create that hands the result back to the
 * bar's own linking path.
 */
export function UnrealGenerateDialog({
  suggestedDir,
  suggestedName = '',
  onClose,
  onGenerated,
}: {
  /** Starting parent folder — the DTH project's own `unreal` subfolder, so a
   *  generated project lands with the rest of the project by default. Editable,
   *  and Browse still takes it anywhere. */
  suggestedDir: string
  /** Prefilled project name — the DTH project's, made legal for Unreal (see
   *  `unrealProjectNameFrom`). '' leaves the field empty. */
  suggestedName?: string
  onClose: () => void
  /** Links the created `.uproject` (the caller owns the persist + toast). */
  onGenerated: (uprojectPath: string) => void
}) {
  const [name, setName] = useState(suggestedName)
  const [dir, setDir] = useState(suggestedDir)
  const [engines, setEngines] = useState<Array<UnrealEngineFound> | null>(null)
  const [engineVersion, setEngineVersion] = useState('')
  const [plugins, setPlugins] = useState<Array<UnrealPluginSource>>([])
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [taken, setTaken] = useState(false)

  useEffect(() => {
    let active = true
    // Separate loads: the plugin scan can fail (settings read, transport) and
    // must not take the engine list down with it — engines render either way,
    // a failed scan just offers no builds. Unguarded, a rejection would pin
    // the dialog on "Looking for engines…" forever.
    void detectUnrealEngines()
      .then((scan) => {
        if (!active) return
        setEngines(scan.installs)
        setEngineVersion(defaultUnrealEngine(scan.installs)?.version ?? '')
      })
      .catch(() => {
        if (active) setEngines([])
      })
    void scanUnrealPlugins()
      .then((builds) => {
        if (active) setPlugins(builds)
      })
      .catch(() => {
        if (active) setPlugins([])
      })
    return () => {
      active = false
    }
  }, [])

  // The checklist follows the chosen engine; switching resets it (the match
  // list itself changes, so per-item choices don't carry over). The engine
  // object — not just its version — because a build's BINARIES are checked
  // against that engine's BuildId, and a generated project is exactly where an
  // unloadable plugin is most expensive: nothing has been opened yet, so the
  // first sign of trouble is Unreal's missing-modules dialog.
  const selectedEngine = useMemo(
    () => (engines ?? []).find((e) => e.version === engineVersion) ?? null,
    [engines, engineVersion],
  )
  const items = useMemo(
    () =>
      engineVersion === '' ? [] : buildItems(plugins, engineVersion, undefined, selectedEngine),
    [plugins, engineVersion, selectedEngine],
  )
  useEffect(() => {
    // Same rule as the install dialog: a build whose binaries cannot load in
    // this engine is listed, marked, and left for the user to tick knowingly.
    setChecked(new Set(items.filter((item) => !item.buildMismatch).map((item) => item.key)))
  }, [items])

  const nameError = name.trim() === '' ? null : unrealProjectNameError(name)
  const target = dir.trim() === '' || name.trim() === '' ? '' : `${normalizePath(dir.trim()).replace(/\/+$/, '')}/${name.trim()}`

  // Live collision check — the create refuses an existing folder anyway, but
  // the dialog should say so under the field, not as an error toast.
  useEffect(() => {
    setTaken(false)
    if (target === '' || nameError !== null) return
    let active = true
    const timer = setTimeout(() => {
      void fileExists({ data: { path: target } }).then((exists) => {
        if (active) setTaken(exists)
      })
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [target, nameError])

  const canCreate =
    !busy && engineVersion !== '' && dir.trim() !== '' && name.trim() !== '' && nameError === null && !taken

  async function onCreate() {
    setBusy(true)
    try {
      // Re-probe at click time — a collision renders as form validation under
      // the input, never as an error toast.
      if (target !== '' && (await fileExists({ data: { path: target } }))) {
        setTaken(true)
        return
      }
      const created = await createUnrealProject({
        data: { parentDir: dir.trim(), name: name.trim(), engineVersion },
      })
      const outcome = await runChecked(created.uprojectPath, items, checked)
      if (outcome.failed.length === 0) {
        toast.success(
          `Created ${name.trim()} (Unreal Engine ${engineVersion})${
            outcome.installed.length > 0 ? ` — installed ${outcome.installed.join(', ')}` : ''
          }`,
        )
      } else {
        // The project EXISTS either way — say what worked and what didn't.
        toastOutcome(name.trim(), outcome)
      }
      onGenerated(created.uprojectPath)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const noEngines = engines !== null && engines.every((engine) => !engine.exists)

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title={
        <span className="flex items-center gap-1.5">
          Generate Unreal project
          <InfoPopup label="Generate Unreal project — more information">
            <div className="space-y-2">
              <p>
                Creates a fresh <strong>Blueprint-only</strong> Unreal project (no C++ modules —
                Unreal opens it without compiling) bound to the chosen engine version, installs
                the checked DTH content and plugins into it, and links it to this DTH project.
              </p>
              <p>
                The engine versions come from what the Epic launcher has installed on this
                machine (Settings → General → Unreal Engine).
              </p>
            </div>
          </InfoPopup>
        </span>
      }
    >
      {engines === null && <p className="text-sm text-muted-foreground">Looking for engines…</p>}
      {engines !== null && noEngines && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No Unreal Engine detected on this machine — install one via the Epic Games launcher
          first. Linking an existing project works without one.
        </p>
      )}
      {engines !== null && !noEngines && (
        <>
          <div>
            <Label htmlFor="generate-unreal-name" className="mb-1">
              Project name
            </Label>
            <Input
              id="generate-unreal-name"
              className="w-full"
              value={name}
              disabled={busy}
              autoFocus
              placeholder="MyDthProject"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canCreate) void onCreate()
              }}
            />
            {nameError !== null && <p className="mt-1 text-xs text-destructive">{nameError}</p>}
            {taken && (
              <p className="mt-1 text-xs text-destructive">
                {`A folder named “${name.trim()}” already exists there — choose another name or location.`}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="generate-unreal-dir" className="mb-1">
              Create in
            </Label>
            <div className="flex gap-2">
              <Input
                id="generate-unreal-dir"
                className="w-full"
                value={displayPath(dir)}
                disabled={busy}
                placeholder={'D:\\Unreal Projects'}
                onChange={(e) => setDir(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    const picked = await pickFolder(
                      'Folder for the new Unreal project',
                      browseStart(dir, suggestedDir),
                    )
                    if (picked) setDir(picked)
                  })()
                }}
              >
                <FolderOpen /> Browse
              </Button>
            </div>
            {target !== '' && !taken && (
              <p className="mt-1 text-xs text-muted-foreground">
                Creates <code>{displayPath(`${target}/${name.trim()}.uproject`)}</code>
              </p>
            )}
          </div>
          <div>
            <Label className="mb-1">Engine version</Label>
            <Select value={engineVersion} onValueChange={setEngineVersion} disabled={busy}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Pick an engine" />
              </SelectTrigger>
              <SelectContent>
                {engines.map((engine) => (
                  <SelectItem key={engine.version} value={engine.version} disabled={!engine.exists}>
                    {engine.name}
                    {engine.exists ? '' : ' — folder not found'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {items.length > 0 && (
            <div className="space-y-1.5">
              <Label>Install into it</Label>
              <InstallChecklist
                items={items}
                checked={checked}
                busy={busy}
                onToggle={(key, on) =>
                  setChecked((current) => {
                    const next = new Set(current)
                    if (on) next.add(key)
                    else next.delete(key)
                    return next
                  })
                }
              />
              {!hasPluginBuilds(items) && <NoPluginsHint />}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!canCreate} onClick={() => void onCreate()}>
              <Sparkles /> {busy ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}

export { uprojectDisplayName }
