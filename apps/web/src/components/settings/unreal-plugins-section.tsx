import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen, Plus, X } from 'lucide-react'

import { Button, InfoPopup, Input, useRefetchOnFocus } from '@dth/ui'
import { scanUnrealPlugins } from '#/lib/rom/api.ts'
import { pluginVersionLabel } from '#/lib/unreal-install.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { browseStart, displayPath, normalizePath } from '#/lib/path.ts'

import type { UnrealPluginSource } from '#/lib/unreal-install.ts'

/**
 * "Unreal Engine Plugins" (Settings → General) — the folders the studio looks
 * in for UE plugins to offer when installing into a linked Unreal project.
 *
 * A folder can be a plugin itself, a folder of plugins, or a multi-build root
 * (`DazToUnrealBridge/UE_5.7/Plugins/…`) — the scan handles all three, and the
 * per-folder preview under each field shows exactly what was recognized, with
 * the engine version each build was matched to. Nothing is installed from
 * here: the project pages' install dialog picks the builds that fit each
 * project's engine version at install time.
 */
export function UnrealPluginsSection({
  folders,
  onFoldersChange,
}: {
  /** The configured plugin source folders (`unrealPluginFolders`). */
  folders: Array<string>
  onFoldersChange: (folders: Array<string>) => void
}) {
  const [found, setFound] = useState<Array<UnrealPluginSource> | null>(null)
  const [loading, setLoading] = useState(false)

  // Scanned from the FIELDS, not from settings.json: a folder just added is
  // unsaved, and reading the saved list would describe the list the user had
  // before they touched it.
  const foldersKey = folders.join('|')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setFound(await scanUnrealPlugins({ data: { folders } }))
    } catch {
      setFound(null)
    } finally {
      setLoading(false)
    }
    // The folder LIST is the input; `foldersKey` is its stable identity (a new
    // array every render would re-create this callback forever).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldersKey])

  // Re-read on focus (a new build dropped into a folder happens outside this
  // window), debounced on the list so TYPING a path doesn't walk a network
  // share on every keystroke — the same 350ms the other folder fields use.
  useRefetchOnFocus(
    () => {
      void load()
    },
    [load],
    { immediate: false },
  )
  useEffect(() => {
    const timer = setTimeout(() => void load(), 350)
    return () => clearTimeout(timer)
  }, [load])

  async function addFolder() {
    const picked = await pickFolder(
      'Unreal Engine plugins folder',
      browseStart(folders[folders.length - 1], folders.find(Boolean)),
    )
    if (picked && !folders.some((f) => f.toLowerCase() === picked.toLowerCase())) {
      onFoldersChange([...folders, picked])
    }
  }

  const normFolder = (p: string) => normalizePath(p.trim()).toLowerCase().replace(/\/+$/, '')
  const foundIn = (folder: string) =>
    (found ?? []).filter((plugin) => normFolder(plugin.sourceFolder) === normFolder(folder))

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 font-semibold">
          Unreal Engine Plugins
          <InfoPopup label="Unreal Engine Plugins — more information">
            <div className="space-y-2">
              <p>
                Folders holding Unreal Engine plugins. When you install into a linked Unreal
                project, the studio reads the project&apos;s engine version from its{' '}
                <span className="font-mono">.uproject</span> and offers the builds that fit it.
              </p>
              <p>
                A folder can be a plugin itself, a folder of plugins, or a folder with one build
                per engine version (e.g.{' '}
                <span className="font-mono">DazToUnrealBridge\UE_5.7\Plugins</span> next to{' '}
                <span className="font-mono">…\UE_5.6\Plugins</span>) — the right build is chosen
                per project. Which engine a build targets is read from a version in its path
                (deepest wins), falling back to the{' '}
                <span className="font-mono">.uplugin</span>&apos;s own EngineVersion; no version
                anywhere means it is offered for every engine.
              </p>
            </div>
          </InfoPopup>
        </h2>
        {/* Distinct accessible name — the Daz plugins panel above has its own
            "Add folder", and two identical names on one page are ambiguous for
            screen readers (and for the smoke selectors). */}
        <Button
          variant="outline"
          size="sm"
          aria-label="Add Unreal plugins folder"
          onClick={() => void addFolder()}
        >
          <Plus /> Add folder
        </Button>
      </div>

      {folders.length === 0 && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No plugin folder yet — add one holding an Unreal plugin, a set of plugins, or a
          multi-build bridge folder (one subfolder per UE version). The install dialog on a
          project&apos;s Unreal card then offers the builds matching that project&apos;s engine.
        </p>
      )}
      {folders.map((folder, i) => {
        const plugins = foundIn(folder)
        const scannedEmpty =
          !loading && found !== null && folder.trim() !== '' && plugins.length === 0
        return (
          <div key={i} className="space-y-1">
            <div className="flex gap-2">
              <Input
                value={displayPath(folder)}
                placeholder={'X:\\…\\DazToUnrealBridge'}
                onChange={(e) => onFoldersChange(folders.map((f, j) => (j === i ? e.target.value : f)))}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => {
                  void (async () => {
                    const picked = await pickFolder('Unreal Engine plugins folder', browseStart(folder))
                    if (picked) onFoldersChange(folders.map((f, j) => (j === i ? picked : f)))
                  })()
                }}
              >
                <FolderOpen /> Browse
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                title="Remove folder"
                onClick={() => onFoldersChange(folders.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </div>
            {plugins.length > 0 && (
              <ul className="space-y-1 pl-1 text-xs text-muted-foreground">
                {plugins.map((plugin) => (
                  <li key={plugin.path} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-foreground">{plugin.name}</span>
                    <span className="rounded bg-muted px-1 py-0.5 font-medium">
                      {pluginVersionLabel(plugin.engineVersion)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {scannedEmpty && (
              <p className="flex items-start gap-1.5 pl-1 text-xs text-amber-500">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  No Unreal plugin found here — expected a <span className="font-mono">.uplugin</span>{' '}
                  in this folder or up to three levels below it.
                </span>
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
