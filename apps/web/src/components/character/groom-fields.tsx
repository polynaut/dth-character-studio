import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

import { Button, InfoPopup, MultiSelect, OverrideMark, useRefetchOnFocus } from '@dth/ui'
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
 * The hair (groom) block of the character editor's identity card. Hair is always
 * PER SCENE (`groomScenes`) — a scene's listed items ARE its hair, none listed
 * means none (empty scenes are dropped at generation). Every scene owns its list;
 * there is NO "inherit from the primary", so hair carries no per-scene override
 * chrome — the list is simply editable on whatever scene is selected. This edits
 * the SELECTED scene card's list (`selectedScene`, the primary by default). The
 * generated script bakes the whole map and hides the open scene's list around the
 * export at run time, so one script serves every scene. Suggestions come from the
 * selected scene's `.duf` (read natively, no Daz needed); a listed label the scene
 * doesn't contain gets a warning. `patch` is the route's partial-Character updater.
 */
export function GroomFields({
  character,
  patch,
  selectedScene,
  dazInstallFolder,
  overrideEligible,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** The scene whose groom list is being edited (a linked scene path). */
  selectedScene: string
  /** The Daz install folder (from settings) — used to read the installed
   *  Exporter Plugin's DLL version and warn when it's too old for hide-only groom. */
  dazInstallFolder: string
  /** True while a non-primary Daz scene is selected — only scopes the "unlisted
   *  hair would ride into the export" warning to outfit scenes. */
  overrideEligible: boolean
}) {
  const [wearables, setWearables] = useState<Array<SceneWearable>>([])
  const [scanned, setScanned] = useState(false)
  // Reset the scan DURING render (not in an effect) the instant the selected scene
  // changes, so this render never judges the NEW scene's hair list against the OLD
  // scene's wearables — that one-frame mismatch flashed a bogus "not found /
  // unlisted" warning before the effect below could clear it.
  const [scannedScene, setScannedScene] = useState(selectedScene)
  if (scannedScene !== selectedScene) {
    setScannedScene(selectedScene)
    setWearables([])
    setScanned(false)
  }
  // The installed Exporter Plugin version (read from the DLL). '' = not installed
  // / unknown — we don't warn then (see exporterSupportsGroomHide).
  const [exporterVersion, setExporterVersion] = useState('')

  // Groom exclusion is hide-only: an Exporter Plugin below MIN_GROOM_EXPORTER_VERSION
  // doesn't unparent the hidden items, so the hair would leak into the FBX.
  const hasGroom = character.groomScenes.some((g) => g.nodes.length > 0)

  // Read the installed plugin version only when this character actually lists hair.
  useEffect(() => {
    if (!hasGroom) return
    let cancelled = false
    void api.installedExporterVersion(dazInstallFolder).then((v) => {
      if (!cancelled) setExporterVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [hasGroom, dazInstallFolder])

  useEffect(() => {
    // The scan reset happens at render time (above) so no stale-scene frame paints;
    // here we just kick off the new scene's async scan.
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

  // Re-read the scene when the window regains focus — the user may have just added
  // or removed a hair item in Daz and Alt-Tabbed back. No reset here (the scene is
  // unchanged, so don't flash the pills away): the fresh read overwrites in place.
  useRefetchOnFocus(() => {
    if (!selectedScene) return
    void api.sceneWearables({ data: { scenePath: selectedScene } }).then((result) => {
      setWearables(result.items)
      setScanned(result.error === '')
    })
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
  const exporterTooOld = hasGroom && !exporterSupportsGroomHide(exporterVersion)

  // Detected hair the scene's list doesn't cover would ride into the ROM export.
  // Flagged on an outfit (non-primary) scene, where the brought-along hair most
  // often isn't listed yet.
  const detectedHair = candidates.filter((label) => HAIRISH.test(label))
  const listedSet = new Set(listed)
  const unlistedHair = scanned ? detectedHair.filter((label) => !listedSet.has(label)) : []
  const hairMismatch = overrideEligible && unlistedHair.length > 0

  return (
    <div className="group/ovr max-w-xl">
      <div className="mb-1 flex items-center gap-1 text-sm font-medium">
        Hair items
        <InfoPopup label="Hair items — more information">
          Each scene carries its own hair — the items you list here are hidden around the DTH
          export so they never ride into the ROM artifacts. None listed means the scene has no
          hair to exclude. For a hair-only variant, link it as its own scene (or use
          Attachments).
        </InfoPopup>
        {/* The glyph marks hair like the other Daz-scene fields. Hair is per-scene by
            nature, so it goes green once THIS non-primary scene lists its own hair,
            and the reset just clears it (there's no primary hair to fall back to). */}
        <OverrideMark
          overridden={overrideEligible && listed.length > 0}
          onReset={() => setNodes([])}
          resetTitle="Clear this scene's hair items"
        />
      </div>
      {exporterTooOld && (
        <p className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Your installed DTH Exporter Plugin is <strong>{exporterVersion}</strong> — hair
          exclusion needs <strong>{MIN_GROOM_EXPORTER_VERSION}+</strong> (it unparents the hidden
          hair so it stays out of the FBX). Update the plugin in Settings, or this character's
          export will bake the hair into the FBX.
        </p>
      )}
      {!selectedScene ? (
        <p className="text-sm text-muted-foreground">Link a Daz scene to define its hair items.</p>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <MultiSelect
              className="flex-1"
              values={listed}
              options={candidates}
              onChange={(labels) => setNodes(labels.map((nodeLabel) => ({ nodeLabel })))}
              placeholder="Pick the hair items of this scene…"
              allowCustom
              pillWarning={(label) =>
                scanned && !knownLabels.has(label) ? `Not found in “${sceneName}”` : null
              }
            />
            <Button
              variant="outline"
              size="icon"
              title="Select all detected hair items"
              aria-label="Select all detected hair items"
              disabled={detectedHair.length === 0}
              onClick={() => setNodes(detectedHair.map((nodeLabel) => ({ nodeLabel })))}
            >
              <Sparkles />
            </Button>
          </div>
          {hairMismatch && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
              Unlisted hair: <strong>{unlistedHair.join(', ')}</strong> — it'd ride into the
              export. Pick it or hit{' '}
              <Sparkles className="inline size-3.5 -translate-y-px" aria-hidden />.
            </p>
          )}
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
