import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, HardDriveDownload } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Modal } from '@dth/ui'
import {
  detectUnrealEngines,
  installUnrealDthContent,
  installUnrealPlugin,
  scanUnrealPlugins,
  unrealProjectState,
} from '#/lib/rom/api.ts'
import {
  EMPTY_UNREAL_SCAN,
  allPluginBuilds,
  engineVersionFromAssociation,
  matchPluginsToEngine,
  pluginBuildMismatch,
  pluginVersionLabel,
} from '#/lib/unreal-install.ts'

import type { UnrealEngineFound, UnrealPluginSource } from '#/lib/unreal-install.ts'

/** "D:\…\ThighGlutes.uproject" → "ThighGlutes". */
function uprojectDisplayName(uprojectPath: string): string {
  const fileName = uprojectPath.split(/[\\/]/).pop() ?? uprojectPath
  return fileName.replace(/\.[^./\\]+$/, '')
}

/** The checklist's non-plugin entry — DTH content is always offered. */
const DTH_CONTENT_KEY = 'dth-content'

interface ChecklistItem {
  /** DTH_CONTENT_KEY, or the plugin build's path (unique per build). */
  key: string
  label: string
  /** The muted badge: the content target, or the build's engine label. */
  detail: string
  /** Already in the project — a check reinstalls (overwrites) it. */
  installed: boolean
  /** Absent for the DTH content entry. */
  plugin?: UnrealPluginSource
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
      const files = item.plugin
        ? await installUnrealPlugin({
            data: { pluginPath: item.plugin.path, uprojectPath, overwrite: true },
          })
        : await installUnrealDthContent({ data: { uprojectPath, overwrite: true } })
      outcome.installed.push(`${item.label} (${files} file${files === 1 ? '' : 's'})`)
      if (!item.plugin) outcome.dthInstalled = true
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
      // an UNKNOWN engine leaves only the engine-independent DTH content, and
      // a build whose binaries are for another engine build is left off.
      setChecked(
        new Set(
          version === null
            ? [DTH_CONTENT_KEY]
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
          {items.length === 1 && <NoPluginsHint />}
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

export { uprojectDisplayName }
