import { useEffect, useState } from 'react'

import { InfoPopup, MultiSelect, Switch } from '@dth/ui'
import { MIN_GROOM_EXPORTER_VERSION, exporterSupportsGroomHide } from '@dth/rom'

import * as api from '#/lib/rom/api.ts'

import type { Character } from '@dth/rom'
import type { SceneWearable } from '#/lib/rom/api/native-types.ts'

/** Hair-ish labels float to the top of the suggestions. */
const HAIRISH = /hair|brow|lash|beard|wig|cap\b|pony|braid|bang|bun\b|fur/i
/** Body followers + gen assets are never groom candidates. */
const BODY_FOLLOWER = /^genesis ?9|goldenpalace|dicktator/i

/** Decode a DSON ref ("#Black%20Tie%20Cap_1529") to the node id it points at. */
function refKey(ref: string): string {
  const raw = ref.replace(/^#/, '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * The groom (hair) block of the character editor's Export section. The lists
 * are PER SCENE (`groomScenes`) — outfit scenes carry different hair styles —
 * and this component edits the list of the SELECTED scene card (`selectedScene`,
 * the primary scene by default). The generated script bakes the whole map and
 * resolves the open scene's list at run time, so one script serves every scene.
 * Suggestions come from the selected scene's `.duf` (read natively, no Daz
 * needed); a listed label the scene doesn't contain gets a warning. `patch` is
 * the route's partial-Character updater — saved with the ordinary Save.
 */
export function GroomFields({
  character,
  patch,
  selectedScene,
  dazInstallFolder,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** The scene whose groom list is being edited (a linked scene path). */
  selectedScene: string
  /** The Daz install folder (from settings) — used to read the installed
   *  Exporter Plugin's DLL version and warn when it's too old for hide-only groom. */
  dazInstallFolder: string
}) {
  const [wearables, setWearables] = useState<Array<SceneWearable>>([])
  const [scanned, setScanned] = useState(false)
  // The installed Exporter Plugin version (read from the DLL). '' = not installed
  // / unknown — we don't warn then (see exporterSupportsGroomHide).
  const [exporterVersion, setExporterVersion] = useState('')

  // Read the installed plugin version only while groom is actually in use.
  useEffect(() => {
    if (character.groomMode !== 'scene') return
    let cancelled = false
    void api.installedExporterVersion(dazInstallFolder).then((v) => {
      if (!cancelled) setExporterVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [character.groomMode, dazInstallFolder])

  useEffect(() => {
    // Drop the previous scene's scan immediately — judging this scene's list
    // against another scene's wearables would flash bogus "not found" warnings.
    setWearables([])
    setScanned(false)
    if (!selectedScene) return
    let cancelled = false
    void api.sceneWearables({ data: { scenePath: selectedScene } }).then((result) => {
      if (cancelled) return
      setWearables(result.items)
      setScanned(result.error === '')
    })
    return () => {
      cancelled = true
    }
  }, [selectedScene])

  const entry = character.groomScenes.find((g) => g.scenePath === selectedScene)
  const nodes = entry?.nodes ?? []
  const setNodes = (next: Array<{ nodeLabel: string }>) =>
    patch({
      groomScenes: [
        ...character.groomScenes.filter((g) => g.scenePath !== selectedScene),
        ...(next.length > 0 ? [{ scenePath: selectedScene, nodes: next }] : []),
      ],
    })

  const ids = new Set(wearables.map((wearable) => wearable.id))
  const listed = nodes.map((groom) => groom.nodeLabel.trim()).filter((label) => label !== '')
  const candidates = wearables
    // Top-level followers only: an item fitted to another wearable (hair base on
    // its cap) rides along with its parent and needs no own entry.
    .filter((wearable) => !ids.has(refKey(wearable.conformTarget)))
    .filter((wearable) => !BODY_FOLLOWER.test(wearable.label))
    .filter(
      (wearable, index, arr) => arr.findIndex((other) => other.label === wearable.label) === index,
    )
    .sort(
      (a, b) =>
        Number(HAIRISH.test(b.label)) - Number(HAIRISH.test(a.label)) ||
        a.label.localeCompare(b.label),
    )
    .map((wearable) => wearable.label)
  const knownLabels = new Set(wearables.map((wearable) => wearable.label))
  const missing = scanned ? listed.filter((label) => !knownLabels.has(label)) : []
  const sceneName = selectedScene.split(/[\\/]/).pop()?.replace(/\.duf$/i, '') ?? ''

  // Groom exclusion is hide-only: an Exporter Plugin below MIN_GROOM_EXPORTER_VERSION
  // doesn't unparent the hidden items, so the hair would leak into the FBX. Warn
  // when the character actually lists groom AND the installed DLL is too old.
  const hasGroom = character.groomScenes.some((g) => g.nodes.length > 0)
  const exporterTooOld =
    character.groomMode === 'scene' && hasGroom && !exporterSupportsGroomHide(exporterVersion)

  return (
    <div className="max-w-xl">
      <div className="mb-3 flex items-center gap-3">
        <Switch
          checked={character.groomMode === 'scene'}
          onCheckedChange={(inScene) => patch({ groomMode: inScene ? 'scene' : 'separate' })}
        />
        <span className="flex items-center gap-1 text-sm">
          Hair items (groom) live in the Daz scenes
          <InfoPopup label="Hair items live in the Daz scenes — more information">
            <strong>On</strong>: each scene carries its full look, hair included — the groom
            items listed per scene are HIDDEN around the DTH export and shown again after, so
            hair never rides into the ROM artifacts. The DTH Exporter Plugin{' '}
            <strong>{MIN_GROOM_EXPORTER_VERSION}+</strong> unparents the hidden items itself, which
            keeps them out of both the FBX and the Alembic. The generated script carries every
            scene's list and applies the right one for the scene open in Daz.{' '}
            <strong>Off</strong>: the classic workflow — you keep hair in separate Daz scene
            files and nothing is excluded.
          </InfoPopup>
        </span>
      </div>
      {exporterTooOld && (
        <p className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Your installed DTH Exporter Plugin is <strong>{exporterVersion}</strong> — groom
          exclusion needs <strong>{MIN_GROOM_EXPORTER_VERSION}+</strong> (it unparents the hidden
          hair so it stays out of the FBX). Update the plugin in Settings, or this character's
          export will bake the hair into the FBX.
        </p>
      )}
      {character.groomMode !== 'scene' ? null : !selectedScene ? (
        <p className="text-sm text-muted-foreground">
          Link a Daz scene to define its groom items.
        </p>
      ) : (
        <>
          <MultiSelect
            values={listed}
            options={candidates}
            onChange={(labels) => setNodes(labels.map((nodeLabel) => ({ nodeLabel })))}
            placeholder="Pick the hair items of this scene…"
            allowCustom
            pillWarning={(label) =>
              scanned && !knownLabels.has(label) ? `Not found in “${sceneName}”` : null
            }
          />
          {missing.length > 0 && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
              Not found in “{sceneName}”: <strong>{missing.join(', ')}</strong> — the export
              would stop on a label that isn't in the open scene; check it against Daz's Scene
              pane.
            </p>
          )}
        </>
      )}
    </div>
  )
}
