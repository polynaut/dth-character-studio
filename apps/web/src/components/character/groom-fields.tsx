import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'

import { Button, InfoPopup, MultiSelect } from '@dth/ui'
import { PanelOverrideToggle } from '#/components/character/panel-override-toggle.tsx'
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
 * means none — and this component edits the list of the SELECTED scene card
 * (`selectedScene`, the primary scene by default). The generated script bakes the
 * whole map and hides the open scene's list around the export at run time, so one
 * script serves every scene. Suggestions come from the selected scene's `.duf`
 * (read natively, no Daz needed); a listed label the scene doesn't contain gets a
 * warning. On a non-primary scene the list locks until its override is armed.
 * `patch` is the route's partial-Character updater — saved with the ordinary Save.
 */
export function GroomFields({
  character,
  patch,
  selectedScene,
  dazInstallFolder,
  overrideEligible,
  groomOverrideActive,
  setGroomOverrideEnabled,
  selectedSceneName,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** The scene whose groom list is being edited (a linked scene path). */
  selectedScene: string
  /** The Daz install folder (from settings) — used to read the installed
   *  Exporter Plugin's DLL version and warn when it's too old for hide-only groom. */
  dazInstallFolder: string
  /** Per-scene override arming, from useSceneSelection. On a non-primary scene the
   *  hair list is locked until the override is armed. Rendered as the compact override
   *  toggle (like Genesis-9 / ROM); the selected scene is named by the sticky label up
   *  in the tabs row. */
  overrideEligible: boolean
  groomOverrideActive: boolean
  setGroomOverrideEnabled: (enabled: boolean) => void
  selectedSceneName: string
}) {
  const [wearables, setWearables] = useState<Array<SceneWearable>>([])
  const [scanned, setScanned] = useState(false)
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
  // On a non-primary scene the per-scene hair list is locked until its override
  // is armed — the same opt-in gate the ROM / Genesis-9 panels use.
  const groomLocked = overrideEligible && !groomOverrideActive
  const exporterTooOld = hasGroom && !exporterSupportsGroomHide(exporterVersion)

  // The hair the scene's `.duf` actually contains (the HAIRISH suggestions) —
  // what the ✦ button grabs in one click. Detected hair the current list
  // doesn't already cover would ride into the ROM export; on a non-primary
  // scene that's a mismatch we arm + warn about (the outfit brought its own
  // hair, so the primary's list can't be trusted for it).
  const detectedHair = candidates.filter((label) => HAIRISH.test(label))
  const listedSet = new Set(listed)
  const unlistedHair = scanned ? detectedHair.filter((label) => !listedSet.has(label)) : []
  const hairMismatch = overrideEligible && unlistedHair.length > 0

  // Auto-arm the hair override ONCE when switching to a non-primary scene whose
  // detected hair isn't covered by its list. Only ever ARM (never disarm) and
  // never twice for the same scene, so a manual disarm within a visit sticks;
  // evaluated only after that scene's wearables have been scanned.
  const autoArmedScene = useRef<string | null>(null)
  useEffect(() => {
    if (!scanned || autoArmedScene.current === selectedScene) return
    autoArmedScene.current = selectedScene
    if (hairMismatch && !groomOverrideActive) setGroomOverrideEnabled(true)
  }, [scanned, selectedScene, hairMismatch, groomOverrideActive, setGroomOverrideEnabled])

  return (
    <div className="max-w-xl">
      <div className="mb-5 flex items-center gap-3">
        <span
          className={`flex items-center gap-1 text-sm font-medium${groomLocked ? ' text-muted-foreground' : ''}`}
        >
          Hair items
          <InfoPopup label="Hair items — more information">
            Each scene carries its own hair — the items you list here are hidden around the DTH
            export so they never ride into the ROM artifacts. None listed means the scene has no
            hair to exclude. For a hair-only variant, link it as its own scene (or use
            Attachments).
          </InfoPopup>
        </span>
        {/* Compact toggle like every other override — the selected scene is named by
            the sticky scene label up in the tabs row, not here. */}
        <span className="ml-auto">
          <PanelOverrideToggle
            eligible={overrideEligible}
            active={groomOverrideActive}
            scenePath={selectedScene}
            sceneName={selectedSceneName}
            noun="hair"
            compact
            onToggle={setGroomOverrideEnabled}
          />
        </span>
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
              disabled={groomLocked}
              pillWarning={(label) =>
                scanned && !knownLabels.has(label) ? `Not found in “${sceneName}”` : null
              }
            />
            <Button
              variant="outline"
              size="icon"
              title="Select all detected hair items"
              aria-label="Select all detected hair items"
              disabled={groomLocked || detectedHair.length === 0}
              onClick={() => setNodes(detectedHair.map((nodeLabel) => ({ nodeLabel })))}
            >
              <Sparkles />
            </Button>
          </div>
          {hairMismatch && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
              Unlisted hair: <strong>{unlistedHair.join(', ')}</strong> — it'd ride into the
              export. Override enabled; pick it or hit{' '}
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
