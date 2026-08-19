import { useEffect, useState } from 'react'

import { fetchCharactersWithProblems, sceneWearables } from '#/lib/rom/api.ts'
import {
  charactersLinkedScenes,
  primarySceneDerivation,
  sceneCompatFailed,
  sceneCompatHardFailed,
  sceneCompatRows,
  sceneCreateRows,
  sceneNotLinkedRow,
} from '#/lib/scene-compat.ts'
import { autoExportHair, seedSceneHair } from '#/lib/groom-detect.ts'
import { extrasWithoutPrimary, normalizePath } from '#/lib/path.ts'
import { genesisFromFigureNode } from '@dth/rom'

import type { LinkedSceneOwner, SceneCheckRow } from '#/lib/scene-compat.ts'
import type { SceneWearables } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

/**
 * The patch builders behind every scene-linking flow — extracted from
 * `DazSceneField` so the detected-files wizard links through the SAME rules
 * (hair seeding, GEN/gender derivation) instead of a drifting copy. Both take
 * the FINAL scene path (any copy-into-folder already happened) and stay
 * toast-free: user-facing notices go through `onNotice` so the caller keeps
 * owning presentation.
 */

/**
 * The add/link validation for ONE candidate scene — the wizard's per-page reads
 * (`DazSceneField`'s own dialog keeps its interleaved state machine). Mode
 * `'add'` runs the extra-scene checks against the primary (the geograft
 * reference); `'primary'` runs the create-subset (one figure, empty timeline)
 * — a scene-less character has no reference to compare against. Both get the
 * HARD "not already linked" row: other characters from a fresh library walk,
 * this character's own from the live draft. Reads are superseded on a
 * candidate change; a failed walk leaves the cross-character check unverified
 * rather than the dialog on "checking…" forever.
 */
export function useSceneAddValidation({
  projectId,
  character,
  scenePath,
  mode,
}: {
  projectId: string
  character: Character
  /** The candidate scene — '' renders no rows (an inactive page). */
  scenePath: string
  mode: 'add' | 'primary'
}): {
  rows: Array<SceneCheckRow>
  checking: boolean
  hardBlocked: boolean
  blocked: boolean
  force: boolean
  setForce: (force: boolean) => void
} {
  const [scan, setScan] = useState<SceneWearables | null>(null)
  const [primaryScan, setPrimaryScan] = useState<SceneWearables | null>(null)
  const [owners, setOwners] = useState<Array<LinkedSceneOwner> | null>(null)
  const [force, setForce] = useState(false)
  const primary = character.scenePath
  const needsPrimary = mode === 'add' && primary !== ''
  useEffect(() => {
    setScan(null)
    setPrimaryScan(null)
    setOwners(null)
    setForce(false)
    if (!scenePath) return
    let cancelled = false
    void sceneWearables({ data: { scenePath } }).then((s) => {
      if (!cancelled) setScan(s)
    })
    if (needsPrimary) {
      void sceneWearables({ data: { scenePath: primary } }).then((s) => {
        if (!cancelled) setPrimaryScan(s)
      })
    }
    void fetchCharactersWithProblems({ data: { projectId } })
      .then(({ characters }) => {
        if (!cancelled) {
          setOwners(charactersLinkedScenes(characters.filter((c) => c.id !== character.id)))
        }
      })
      .catch(() => {
        if (!cancelled) setOwners([])
      })
    return () => {
      cancelled = true
    }
    // primary/needsPrimary changes re-validate via the character draft below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenePath, mode, projectId, character.id, primary])
  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const rows: Array<SceneCheckRow> = scenePath
    ? [
        ...(mode === 'add'
          ? sceneCompatRows({ scan, primaryScan, character })
          : sceneCreateRows(scan)),
        sceneNotLinkedRow(
          scenePath,
          owners === null
            ? null
            : [
                ...owners,
                ...linkedScenes.map((path) => ({
                  path,
                  character: character.name,
                  characterId: character.id,
                })),
              ],
        ),
      ]
    : []
  const checking =
    scenePath !== '' && (scan === null || owners === null || (needsPrimary && primaryScan === null))
  const hardBlocked = sceneCompatHardFailed(rows)
  return {
    rows,
    checking,
    hardBlocked,
    blocked: checking || hardBlocked || (sceneCompatFailed(rows) && !force),
    force,
    setForce,
  }
}

/** The add-an-extra-scene patch: append + pre-select the scene's own hair (the
 *  one shared rule — see `seedSceneHair`; scanned on the FINAL path, the record
 *  keys on it). */
export async function addScenePatch(
  scenePath: string,
  character: Character,
): Promise<Partial<Character>> {
  const patch: Partial<Character> = {
    extraScenes: [...character.extraScenes, scenePath],
  }
  const seeded = seedSceneHair(
    scenePath,
    await sceneWearables({ data: { scenePath } }),
    character.sceneOverrides,
  )
  if (seeded) {
    // The seeded list is a hair-list "set" on a non-primary scene, so the
    // automatic "Export hair items" rule applies here like in the editor: an
    // outfit scene arriving with its OWN hair gets the export armed right
    // away. Only the freshly seeded record — an existing record (a re-add)
    // returns null above and keeps whatever the user had.
    const primary =
      character.sceneOverrides.find((o) => o.scenePath === character.scenePath)?.hair ?? []
    patch.sceneOverrides = seeded.map((record) =>
      record.scenePath === scenePath
        ? { ...record, exportHair: autoExportHair(primary, record.hair) }
        : record,
    )
  }
  return patch
}

/**
 * The primary link/relink patch. The very FIRST link (a character created
 * without a scene) completes what creation couldn't derive — gender, genesis,
 * seeded hair; a RELINK (a MISSING primary re-pointed) is narrower: gender was
 * derived from a real scene once and never changes again, and the old
 * primary's hair record FOLLOWS the file to its new path. Both flavors
 * re-derive the GEN section from the scene's GP/DK geograft
 * (`primarySceneDerivation`); an unreadable scene keeps the stored values.
 */
export async function primaryLinkPatch(
  scenePath: string,
  character: Character,
  firstLink: boolean,
  onNotice?: (message: string) => void,
): Promise<Partial<Character>> {
  // A scene is linked at most once: if the new primary is already an extra
  // (relinking the primary onto an existing outfit scene), drop it from the
  // extras so it isn't both — else it shows as two cards and collides the
  // footer's per-path key + view-transition-name.
  const patch: Partial<Character> = {
    scenePath,
    extraScenes: extrasWithoutPrimary(character.extraScenes, scenePath),
  }
  const scan = await sceneWearables({ data: { scenePath } })
  const derived = primarySceneDerivation(scan, character)
  if (derived.sections) {
    patch.sections = derived.sections
    const genEnabled = derived.sections.GEN.enabled
    if (genEnabled !== character.sections.GEN.enabled) {
      onNotice?.(
        genEnabled
          ? 'Genitalia section enabled — the scene contains a GP/DK geograft.'
          : 'Genitalia section disabled — no GP/DK geograft in the scene.',
      )
    }
  }
  if (firstLink) {
    if (derived.gender) patch.gender = derived.gender
    const figure = scan.error === '' ? (scan.figures[0] ?? null) : null
    const detected = figure ? genesisFromFigureNode(figure.id) : null
    if (detected && detected.genesis !== character.genesis) {
      patch.genesis = detected.genesis
      onNotice?.(`Genesis set to ${detected.genesis} — read from the linked scene.`)
    }
    // Pre-select the scene's detected hair, the one shared rule.
    const seeded = seedSceneHair(scenePath, scan, character.sceneOverrides)
    if (seeded) patch.sceneOverrides = seeded
  } else {
    // RELINK of a MISSING primary: the per-scene hair record keys on the
    // scene PATH, and a relink targets the SAME scene at a new path
    // (moved/renamed outside the app) — so the old primary's record
    // FOLLOWS the file, exactly like an in-app move/rename
    // (`repointLinkedScene`); a curated hair list must not strand on the
    // dead path, where the export would never match it again. When the
    // target already has a record of its own (relinking ONTO an existing
    // extra), that record wins and nothing repoints. A target with no
    // record either way gets its detected hair seeded — the one shared
    // rule (`seedSceneHair`), like every other scene-linking path.
    const oldKey = normalizePath(character.scenePath).toLowerCase()
    const newKey = normalizePath(scenePath).toLowerCase()
    const targetHasRecord = character.sceneOverrides.some(
      (o) => normalizePath(o.scenePath).toLowerCase() === newKey,
    )
    const repointed = targetHasRecord
      ? character.sceneOverrides
      : character.sceneOverrides.map((o) =>
          normalizePath(o.scenePath).toLowerCase() === oldKey ? { ...o, scenePath } : o,
        )
    if (repointed.some((o, i) => o !== character.sceneOverrides[i])) {
      patch.sceneOverrides = repointed
    }
    const seeded = seedSceneHair(scenePath, scan, repointed)
    if (seeded) patch.sceneOverrides = seeded
  }
  return patch
}
