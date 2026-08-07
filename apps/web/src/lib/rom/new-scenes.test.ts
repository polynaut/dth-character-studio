import { describe, expect, it } from 'vitest'

import {
  emptyDismissed,
  isDismissed,
  isGeneratedScene,
  offerableScenes,
  parseDismissed,
  pruneDismissed,
  withDismissed,
} from './new-scenes.ts'
import type { FoundScene } from './new-scenes.ts'

const CHARS = 'D:/DTH Projects/Demo'

function scene(path: string, mtimeMs = 1000): FoundScene {
  return { path, characterId: 'kira', characterName: 'Kira', mtimeMs }
}

describe('which loose scenes are worth offering', () => {
  const LOOSE = `${CHARS}/Kira/daz3d/Kira_Yoga.duf`
  const PRIMARY = `${CHARS}/Kira/daz3d/primary/Kira.duf`

  it('offers a file nobody links', () => {
    expect(
      offerableScenes({
        found: [scene(LOOSE)],
        linked: [PRIMARY],
        dismissed: emptyDismissed(),
      }).map((s) => s.path),
    ).toEqual([LOOSE])
  })

  it('never offers a scene a character already links', () => {
    expect(
      offerableScenes({ found: [scene(PRIMARY)], linked: [PRIMARY], dismissed: emptyDismissed() }),
    ).toEqual([])
  })

  it('matches a linked path by separator and case, like every other path compare', () => {
    // The definition stores what the picker gave it; the scan builds its own.
    // A backslash or a capital must never turn one file into two.
    expect(
      offerableScenes({
        found: [scene(LOOSE)],
        linked: ['D:\\DTH Projects\\Demo\\Kira\\daz3d\\KIRA_YOGA.duf'],
        dismissed: emptyDismissed(),
      }),
    ).toEqual([])
  })

  it('stops offering a file that was declined — until it changes', () => {
    const store = withDismissed(emptyDismissed(), [{ path: LOOSE, mtimeMs: 1000 }])
    expect(offerableScenes({ found: [scene(LOOSE, 1000)], linked: [], dismissed: store })).toEqual(
      [],
    )
    // Saved over in Daz since: the user who just re-saved it expects to be asked.
    expect(
      offerableScenes({ found: [scene(LOOSE, 2000)], linked: [], dismissed: store }).map(
        (s) => s.path,
      ),
    ).toEqual([LOOSE])
  })

  it('keys a dismissal on the file version, not the path', () => {
    const store = withDismissed(emptyDismissed(), [{ path: LOOSE, mtimeMs: 1000 }])
    expect(isDismissed(store, LOOSE, 1000)).toBe(true)
    expect(isDismissed(store, LOOSE, 1001)).toBe(false)
    expect(isDismissed(store, `${CHARS}/Kira/daz3d/Other.duf`, 1000)).toBe(false)
  })
})

describe('the studio’s own generated scenes', () => {
  it('never offers a ROM animation it wrote itself', () => {
    // These are `.duf`s sitting in exactly the tree the scan walks — offering
    // to "add" one would be the tool tripping over its own output.
    expect(isGeneratedScene('rom-animations/Kira_ROM.duf')).toBe(true)
    expect(isGeneratedScene('primary/rom-animations/Kira_ROM.duf')).toBe(true)
    // The retired folder name is still on disk in older projects.
    expect(isGeneratedScene('.ROM_Animations/Kira_ROM.duf')).toBe(true)
    expect(isGeneratedScene('PRIMARY/ROM-ANIMATIONS/Kira_ROM.duf')).toBe(true)
  })

  it('matches a path SEGMENT, so a user folder cannot be caught by its name', () => {
    expect(isGeneratedScene('my rom-animations backup/Kira.duf')).toBe(false)
    expect(isGeneratedScene('rom-animations-old/Kira.duf')).toBe(false)
    expect(isGeneratedScene('Kira_rom-animations.duf')).toBe(false)
  })
})

describe('the dismissal record', () => {
  it('drops records for scenes that are no longer loose', () => {
    // Otherwise it grows for the life of the project: every scene ever declined,
    // every one later added or deleted, kept forever in a file nothing prunes.
    const store = withDismissed(emptyDismissed(), [
      { path: `${CHARS}/Kira/daz3d/A.duf`, mtimeMs: 1 },
      { path: `${CHARS}/Kira/daz3d/Gone.duf`, mtimeMs: 2 },
    ])
    const pruned = pruneDismissed(store, [`${CHARS}/Kira/daz3d/A.duf`])
    expect(Object.keys(pruned.scenes)).toEqual([`${CHARS}/kira/daz3d/a.duf`.toLowerCase()])
  })

  it('reads a torn or hand-edited store as empty instead of failing', () => {
    // The worst an empty record costs is one more offer.
    expect(parseDismissed('not json').scenes).toEqual({})
    expect(parseDismissed('{"version":9,"scenes":{"x":"nope"}}').scenes).toEqual({})
    expect(parseDismissed('{}').scenes).toEqual({})
  })

  it('round-trips what it recorded', () => {
    const store = withDismissed(emptyDismissed(), [{ path: 'D:/a/B.duf', mtimeMs: 7 }])
    expect(parseDismissed(JSON.stringify(store))).toEqual(store)
  })
})
