import { useEffect, useState } from 'react'

import { InfoPopup, Input, KeyedListEditor, Label, Switch } from '@dth/ui'

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
}: {
  character: Character
  patch: (p: Partial<Character>) => void
  /** The scene whose groom list is being edited (a linked scene path). */
  selectedScene: string
}) {
  const [wearables, setWearables] = useState<Array<SceneWearable>>([])
  const [scanned, setScanned] = useState(false)

  useEffect(() => {
    if (!selectedScene) {
      setWearables([])
      setScanned(false)
      return
    }
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
  const listed = new Set(nodes.map((groom) => groom.nodeLabel.trim()))
  const suggestions = wearables
    // Top-level followers only: an item fitted to another wearable (hair base on
    // its cap) rides along with its parent and needs no own entry.
    .filter((wearable) => !ids.has(refKey(wearable.conformTarget)))
    .filter((wearable) => !BODY_FOLLOWER.test(wearable.label))
    .filter(
      (wearable, index, arr) => arr.findIndex((other) => other.label === wearable.label) === index,
    )
    .filter((wearable) => !listed.has(wearable.label))
    .sort(
      (a, b) =>
        Number(HAIRISH.test(b.label)) - Number(HAIRISH.test(a.label)) ||
        a.label.localeCompare(b.label),
    )
  const knownLabels = new Set(wearables.map((wearable) => wearable.label))
  const missing = scanned
    ? [...listed].filter((label) => label !== '' && !knownLabels.has(label))
    : []
  const sceneName = selectedScene.split(/[\\/]/).pop()?.replace(/\.duf$/i, '') ?? ''

  return (
    <div className="max-w-xl">
      <div className="mb-3 flex items-center gap-3">
        <Switch
          checked={character.groomMode === 'scene'}
          onCheckedChange={(inScene) => patch({ groomMode: inScene ? 'scene' : 'separate' })}
        />
        <span className="flex items-center gap-1 text-sm">
          Groom (hair) lives in the ROM scenes
          <InfoPopup label="Groom lives in the ROM scenes — more information">
            On: each scene carries its full look, hair included — the groom items listed per
            scene are unfitted and moved out of the figure around the DTH export, then restored,
            so hair never rides into the ROM artifacts. The generated script carries every
            scene's list and applies the right one for the scene open in Daz. Off: the classic
            workflow — you keep hair in separate Daz scene files and nothing is excluded.
          </InfoPopup>
        </span>
      </div>
      {character.groomMode !== 'scene' ? null : !selectedScene ? (
        <p className="text-sm text-muted-foreground">
          Link a Daz scene to define its groom items.
        </p>
      ) : (
        <>
          <Label className="mb-2 flex w-fit items-center gap-1">
            Groom items in “{sceneName}” kept out of the export
            <InfoPopup label="Groom items kept out of the export — more information">
              Click a scene card above to pick which scene's hair you're listing. Items listed
              here are unfitted and moved out of the figure right before the DTH Exporter runs,
              then restored — the exporter ignores visibility, so hiding hair is not enough.
              List the top fitted item (e.g. the hair cap); its children ride along. Enter the
              label exactly as shown in Daz's Scene pane, or pick from the items found in the
              scene. A scene with no items listed exports as-is.
            </InfoPopup>
          </Label>
          <KeyedListEditor
            items={nodes}
            onChange={setNodes}
            newItem={() => ({ nodeLabel: '' })}
            addLabel="Add groom item"
          >
            {(item, set) => (
              <Input
                value={item.nodeLabel}
                placeholder="dForce Black Tie Cap"
                onChange={(e) => set({ nodeLabel: e.target.value })}
              />
            )}
          </KeyedListEditor>
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">In this scene:</span>
              {suggestions.map((wearable) => (
                <button
                  key={wearable.label}
                  type="button"
                  className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent"
                  onClick={() =>
                    setNodes([
                      ...nodes.filter((groom) => groom.nodeLabel.trim() !== ''),
                      { nodeLabel: wearable.label },
                    ])
                  }
                >
                  + {wearable.label}
                </button>
              ))}
            </div>
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
