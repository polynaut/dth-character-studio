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
 * The "groom items" list of the character editor's Export section: scene items
 * (hair — usually the fitted cap; its children ride along) the generated script
 * unfits + unparents around the DTH export and restores afterwards, so one
 * scene carries full hair while the ROM export stays clean. (A hair-ONLY groom
 * export needs DTH Exporter plugin support and is not emitted — see the note
 * in @dth/rom generate.ts.)
 *
 * Suggestions come from the character's linked scene `.duf`s (read natively,
 * no Daz needed): the top-level items conformed to the figure, hair-ish names
 * first. A listed label the scenes don't contain gets a warning — the script
 * would abort loud on it at run time. `patch` is the route's partial-Character
 * updater — saved with the ordinary Save.
 */
export function GroomFields({
  character,
  patch,
}: {
  character: Character
  patch: (p: Partial<Character>) => void
}) {
  const [wearables, setWearables] = useState<Array<SceneWearable>>([])
  const [scanned, setScanned] = useState(false)
  const scenesKey = [character.scenePath, ...character.extraScenes].filter(Boolean).join('|')

  useEffect(() => {
    const scenes = scenesKey.split('|').filter(Boolean)
    if (scenes.length === 0) {
      setWearables([])
      setScanned(false)
      return
    }
    let cancelled = false
    void (async () => {
      const results = await Promise.all(
        scenes.map((scenePath) => api.sceneWearables({ data: { scenePath } })),
      )
      if (cancelled) return
      setWearables(results.flatMap((result) => result.items))
      // Only scenes that actually parsed may judge a label as missing.
      setScanned(results.some((result) => result.error === ''))
    })()
    return () => {
      cancelled = true
    }
  }, [scenesKey])

  const ids = new Set(wearables.map((wearable) => wearable.id))
  const listed = new Set(character.groomNodes.map((groom) => groom.nodeLabel.trim()))
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

  const addGroom = (nodeLabel: string) =>
    patch({
      // A freshly added empty row is replaced rather than left dangling.
      groomNodes: [
        ...character.groomNodes.filter((groom) => groom.nodeLabel.trim() !== ''),
        { nodeLabel },
      ],
    })

  return (
    <div className="max-w-xl">
      <div className="mb-3 flex items-center gap-3">
        <Switch
          checked={character.groomMode === 'scene'}
          onCheckedChange={(inScene) => patch({ groomMode: inScene ? 'scene' : 'separate' })}
        />
        <span className="flex items-center gap-1 text-sm">
          Groom (hair) lives in the ROM scene
          <InfoPopup label="Groom lives in the ROM scene — more information">
            On: one scene carries the full character — the groom items listed below are
            unfitted and moved out of the figure around the DTH export, then restored, so
            hair never rides into the ROM artifacts. Off: the classic workflow — you keep
            hair in separate Daz scene files (link them under Daz scenes) and nothing is
            excluded at export.
          </InfoPopup>
        </span>
      </div>
      {character.groomMode !== 'scene' ? null : (
        <>
      <Label className="mb-2 flex w-fit items-center gap-1">
        Groom items kept out of the export (hair)
        <InfoPopup label="Groom items kept out of the export — more information">
          Scene items listed here are unfitted and moved out of the figure right before the DTH
          Exporter runs, then restored — the exporter ignores visibility, so hiding hair is not
          enough. List the top fitted item (e.g. the hair cap); its children ride along. Enter the
          label exactly as shown in Daz's Scene pane, or pick from the items found in the linked
          scene.
        </InfoPopup>
      </Label>
      <KeyedListEditor
        items={character.groomNodes}
        onChange={(groomNodes) => patch({ groomNodes })}
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
          <span className="text-xs text-muted-foreground">In the scene:</span>
          {suggestions.map((wearable) => (
            <button
              key={wearable.label}
              type="button"
              className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent"
              onClick={() => addGroom(wearable.label)}
            >
              + {wearable.label}
            </button>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
          Not found in the linked scene{missing.length === 1 ? '' : 's'}:{' '}
          <strong>{missing.join(', ')}</strong> — the export would stop on a label that isn't in
          the scene; check it against Daz's Scene pane.
        </p>
      )}
        </>
      )}
    </div>
  )
}
