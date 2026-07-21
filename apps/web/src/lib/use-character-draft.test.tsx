// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/lib/rom/api.ts', () => ({
  saveCharacter: vi.fn(),
  generateCharacterFiles: vi.fn(),
}))
vi.mock('#/lib/use-unsaved-guard.ts', () => ({
  useUnsavedChangesGuard: vi.fn(() => ({ bypass: vi.fn() })),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn().mockResolvedValue(undefined) }),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { toast } from 'sonner'
import { characterSchema, defaultSections } from '@dth/rom'

import { generateCharacterFiles, saveCharacter } from '#/lib/rom/api.ts'
import { useCharacterDraft } from './use-character-draft.ts'

import type { Character, RomValidationError } from '@dth/rom'

const saveMock = vi.mocked(saveCharacter)
const generateMock = vi.mocked(generateCharacterFiles)

/** A resolvable-from-outside promise, to hold a save in flight mid-test. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  const now = '2026-07-20T00:00:00.000Z'
  return characterSchema.parse({
    id: 'test',
    name: 'Electra G9',
    createdAt: now,
    updatedAt: now,
    sections: defaultSections(),
    ...overrides,
  })
}

/** A character whose enabled custom FBM section has an EMPTY pose name — the
 *  exact save-blocking state validate() must refuse to persist. */
function makeInvalidCharacter(): Character {
  const character = makeCharacter()
  character.sections.FBM.enabled = true
  character.sections.FBM.mode = 'custom'
  character.sections.FBM.groups = [
    {
      id: 'g1',
      label: '',
      suffix: 'centre',
      method: 'default',
      calculateFrom: 'default',
      poses: [
        {
          id: 'p1',
          name: '', // empty — romValidationErrors flags it
          morphs: [{ id: 'm1', node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
          boneScaleRef: false,
        },
      ],
    },
  ]
  return character
}

/** What the real api returns: a re-stamped copy — a DIFFERENT identity and
 *  content than the submitted snapshot, so settle logic is actually exercised. */
function stamped(character: Character): Character {
  return { ...character, updatedAt: '2026-07-21T00:00:00.000Z' }
}

const generated = {
  outDir: 'X:/out',
  files: [{ fileName: 'ROM_Electra_G9.dsa', content: '', target: 'daz' }],
  scriptsDir: null,
  scriptsError: null,
} as Awaited<ReturnType<typeof generateCharacterFiles>>

function setup(initial: Character = makeCharacter()) {
  const onValidationErrors = vi.fn<(errors: Array<RomValidationError>) => void>()
  const hook = renderHook(() =>
    useCharacterDraft({ projectId: 'X:/proj', initial, onValidationErrors }),
  )
  return { ...hook, onValidationErrors }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useCharacterDraft save()', () => {
  it('persists the draft, regenerates, and settles draft + baseline in one go', async () => {
    const { result } = setup()
    act(() => result.current.patch({ name: 'Nova' }))
    expect(result.current.dirty).toBe(true)

    const saved = stamped({ ...result.current.character })
    saveMock.mockResolvedValueOnce(saved)
    generateMock.mockResolvedValueOnce(generated)
    await act(() => result.current.save())

    expect(saveMock).toHaveBeenCalledWith({
      data: { projectId: 'X:/proj', character: expect.objectContaining({ name: 'Nova' }) },
    })
    expect(generateMock).toHaveBeenCalledWith({ data: { projectId: 'X:/proj', id: 'test' } })
    // No interim edits → the draft is replaced by the persisted result too.
    expect(result.current.character).toEqual(saved)
    expect(result.current.dirty).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Saved “Nova” — 1 files')
  })

  it('preserves edits typed while the save was in flight (settleAfterSave)', async () => {
    const { result } = setup()
    act(() => result.current.patch({ name: 'Nova' }))

    const pending = deferred<Character>()
    saveMock.mockReturnValueOnce(pending.promise)
    generateMock.mockResolvedValueOnce(generated)
    let done!: Promise<void>
    act(() => {
      done = result.current.save()
    })
    expect(result.current.saving).toBe(true)

    // The form stays editable during the multi-second save+generate.
    act(() => result.current.patch({ gender: 'male' }))
    const saved = stamped(makeCharacter({ name: 'Nova' }))
    await act(async () => {
      pending.resolve(saved)
      await done
    })

    // The interim edit survives; the baseline is the persisted result — so the
    // editor correctly reports the interim edit as the only pending change.
    expect(result.current.character.name).toBe('Nova')
    expect(result.current.character.gender).toBe('male')
    expect(result.current.dirty).toBe(true)
    expect(result.current.saving).toBe(false)
  })

  it('is single-flight: re-entry while a save is in flight is ignored', async () => {
    const { result } = setup()
    act(() => result.current.patch({ name: 'Nova' }))
    const pending = deferred<Character>()
    saveMock.mockReturnValueOnce(pending.promise)
    generateMock.mockResolvedValueOnce(generated)

    let first!: Promise<void>
    act(() => {
      first = result.current.save()
    })
    // A keyboard shortcut re-fires Save while the first round is pending.
    await act(() => result.current.save())
    expect(saveMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve(stamped(result.current.character))
      await first
    })
  })

  it('settles sequential saves to the NEWEST persisted result', async () => {
    const { result } = setup()
    act(() => result.current.patch({ name: 'First' }))
    saveMock.mockResolvedValueOnce(stamped(makeCharacter({ name: 'First' })))
    generateMock.mockResolvedValue(generated)
    await act(() => result.current.save())

    act(() => result.current.patch({ name: 'Second' }))
    const newest = stamped(makeCharacter({ name: 'Second' }))
    saveMock.mockResolvedValueOnce(newest)
    await act(() => result.current.save())

    expect(result.current.character).toEqual(newest)
    expect(result.current.dirty).toBe(false)
  })

  it('refuses to persist an invalid draft: no save call, errors handed to the page', async () => {
    const { result, onValidationErrors } = setup(makeInvalidCharacter())
    await act(() => result.current.save())
    expect(saveMock).not.toHaveBeenCalled()
    expect(generateMock).not.toHaveBeenCalled()
    expect(onValidationErrors).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ section: 'FBM', poseId: 'p1' })]),
    )
    expect(toast.error).toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
  })

  it('surfaces a failed save as a toast and stays dirty', async () => {
    const { result } = setup()
    act(() => result.current.patch({ name: 'Nova' }))
    saveMock.mockRejectedValueOnce(new Error('disk full'))
    await act(() => result.current.save())
    expect(toast.error).toHaveBeenCalledWith('disk full')
    expect(result.current.dirty).toBe(true)
    expect(result.current.saving).toBe(false)
  })

  it('a generate failure AFTER a successful save settles the baseline and only warns', async () => {
    const { result } = setup()
    act(() => result.current.patch({ name: 'Nova' }))
    const saved = stamped({ ...result.current.character })
    saveMock.mockResolvedValueOnce(saved)
    generateMock.mockRejectedValueOnce(new Error('release folder offline'))

    await act(() => result.current.save())

    // The definition IS on disk — the editor must not claim unsaved changes
    // (the old behavior skipped the settle, and the next Save re-ran for nothing).
    expect(result.current.character).toEqual(saved)
    expect(result.current.dirty).toBe(false)
    expect(result.current.saving).toBe(false)
    // Warned (scriptsError family), never surfaced as a failed save.
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('release folder offline'),
    )
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe('useCharacterDraft persistPatch()', () => {
  it('applies the patch, persists, regenerates and settles the baseline', async () => {
    const { result } = setup()
    saveMock.mockImplementationOnce(async ({ data }) => stamped((data as { character: Character }).character))
    generateMock.mockResolvedValueOnce(generated)

    let saved: Character | null = null
    await act(async () => {
      saved = await result.current.persistPatch(
        { exportPath: 'D:/export' },
        { toast: 'Export folder set' },
      )
    })

    expect(saved).not.toBeNull()
    expect(saveMock).toHaveBeenCalledWith({
      data: {
        projectId: 'X:/proj',
        character: expect.objectContaining({ exportPath: 'D:/export' }),
      },
    })
    expect(generateMock).toHaveBeenCalledTimes(1)
    expect(result.current.character.exportPath).toBe('D:/export')
    expect(result.current.dirty).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Export folder set')
  })

  it('refuses while a save is in flight (single-flight) without touching the draft', async () => {
    const { result } = setup()
    act(() => result.current.patch({ name: 'Nova' }))
    const pending = deferred<Character>()
    saveMock.mockReturnValueOnce(pending.promise)
    generateMock.mockResolvedValueOnce(generated)
    let save!: Promise<void>
    act(() => {
      save = result.current.save()
    })

    let refused: Character | null = makeCharacter()
    await act(async () => {
      refused = await result.current.persistPatch({ exportPath: 'D:/export' })
    })
    expect(refused).toBeNull()
    expect(toast.info).toHaveBeenCalled()
    expect(result.current.character.exportPath).toBe('')
    expect(saveMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve(stamped(result.current.character))
      await save
    })
  })

  it('refuses an invalid draft before running the patch producer', async () => {
    const { result, onValidationErrors } = setup(makeInvalidCharacter())
    const produce = vi.fn().mockResolvedValue({ exportPath: 'D:/export' })
    let refused: Character | null = makeCharacter()
    await act(async () => {
      refused = await result.current.persistPatch(produce)
    })
    expect(refused).toBeNull()
    // The producer carries side effects (file copies/moves) — it must never run
    // when the persist is refused up front.
    expect(produce).not.toHaveBeenCalled()
    expect(saveMock).not.toHaveBeenCalled()
    expect(onValidationErrors).toHaveBeenCalled()
  })

  it('runs an async patch producer past the guards; returning null aborts cleanly', async () => {
    const { result } = setup()
    let saved: Character | null = makeCharacter()
    await act(async () => {
      saved = await result.current.persistPatch(async () => null)
    })
    expect(saved).toBeNull()
    expect(saveMock).not.toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()

    saveMock.mockImplementationOnce(async ({ data }) => stamped((data as { character: Character }).character))
    generateMock.mockResolvedValueOnce(generated)
    await act(async () => {
      saved = await result.current.persistPatch(async () => ({ exportPath: 'D:/export' }))
    })
    expect(saved).not.toBeNull()
    expect(result.current.character.exportPath).toBe('D:/export')
  })

  it('uses a custom persist step when given (relinkScene-style flows)', async () => {
    const { result } = setup()
    const persisted = stamped(makeCharacter({ scenePath: 'D:/scenes/Electra.duf' }))
    const persist = vi.fn().mockResolvedValue(persisted)
    generateMock.mockResolvedValueOnce(generated)

    await act(async () => {
      await result.current.persistPatch({ scenePath: 'D:/scenes/Electra.duf' }, { persist })
    })
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ scenePath: 'D:/scenes/Electra.duf' }),
    )
    expect(saveMock).not.toHaveBeenCalled()
    // The custom step's result IS the baseline (it may derive extra fields).
    expect(result.current.character).toEqual(persisted)
    expect(result.current.dirty).toBe(false)
  })

  it('preserves interim edits typed during the in-flight persist', async () => {
    const { result } = setup()
    const pending = deferred<Character>()
    saveMock.mockReturnValueOnce(pending.promise)
    generateMock.mockResolvedValueOnce(generated)

    let done!: Promise<Character | null>
    act(() => {
      done = result.current.persistPatch({ exportPath: 'D:/export' })
    })
    await waitFor(() => expect(result.current.saving).toBe(true))
    act(() => result.current.patch({ name: 'Interim' }))

    const saved = stamped(makeCharacter({ exportPath: 'D:/export' }))
    await act(async () => {
      pending.resolve(saved)
      await done
    })
    expect(result.current.character.name).toBe('Interim')
    expect(result.current.character.exportPath).toBe('D:/export')
    expect(result.current.dirty).toBe(true)
  })

  it('rolls back ONLY the patched fields on failure, keeping interim edits', async () => {
    const { result } = setup()
    const pending = deferred<Character>()
    saveMock.mockReturnValueOnce(pending.promise)

    let done!: Promise<Character | null>
    act(() => {
      done = result.current.persistPatch({ exportPath: 'D:/export' })
    })
    await waitFor(() => expect(result.current.character.exportPath).toBe('D:/export'))
    act(() => result.current.patch({ name: 'Interim' }))

    let saved: Character | null = makeCharacter()
    await act(async () => {
      pending.reject(new Error('save failed'))
      saved = await done
    })
    expect(saved).toBeNull()
    // The failed patch is rolled back (the form shows what's persisted) …
    expect(result.current.character.exportPath).toBe('')
    // … while the user's interim edit on another field survives.
    expect(result.current.character.name).toBe('Interim')
    expect(toast.error).toHaveBeenCalledWith('save failed')
    expect(result.current.saving).toBe(false)
  })

  it('preserves edits typed while a SLOW async producer runs (post-producer snapshot)', async () => {
    const { result } = setup()
    // The producer copies files for seconds while the form stays editable —
    // daz-scene-field's applyAdd. The old pre-producer snapshot clobbered
    // anything typed in the meantime when the patch was applied.
    const producing = deferred<Partial<Character> | null>()
    saveMock.mockImplementationOnce(async ({ data }) => stamped((data as { character: Character }).character))
    generateMock.mockResolvedValueOnce(generated)

    let done!: Promise<Character | null>
    act(() => {
      done = result.current.persistPatch(() => producing.promise)
    })
    await waitFor(() => expect(result.current.saving).toBe(true))
    // Typed while the producer is still copying.
    act(() => result.current.patch({ name: 'TypedDuringProducer' }))

    await act(async () => {
      producing.resolve({ exportPath: 'D:/export' })
      await done
    })
    expect(result.current.character.name).toBe('TypedDuringProducer')
    expect(result.current.character.exportPath).toBe('D:/export')
    // The typed edit was part of the persisted snapshot — nothing left dirty.
    expect(saveMock).toHaveBeenCalledWith({
      data: {
        projectId: 'X:/proj',
        character: expect.objectContaining({ name: 'TypedDuringProducer', exportPath: 'D:/export' }),
      },
    })
    expect(result.current.dirty).toBe(false)
  })

  it('interim edits that invalidate the MERGE: persists the patch against the pre-producer draft', async () => {
    const { result, onValidationErrors } = setup()
    const producing = deferred<Partial<Character> | null>()
    saveMock.mockImplementationOnce(async ({ data }) => stamped((data as { character: Character }).character))
    generateMock.mockResolvedValueOnce(generated)

    let done!: Promise<Character | null>
    act(() => {
      done = result.current.persistPatch(() => producing.promise)
    })
    await waitFor(() => expect(result.current.saving).toBe(true))
    // While the producer runs, the user types the draft into a save-blocking
    // state (an enabled custom FBM pose with an empty name). The producer's
    // side effect (a MOVED .duf / an uploaded avatar) already happened by the
    // time it resolves — refusing the persist outright would strand it. The
    // patch alone (against the pre-producer draft) is valid, so THAT persists.
    const invalidSections = makeInvalidCharacter().sections
    act(() => result.current.patch({ sections: invalidSections }))

    let saved: Character | null = null
    await act(async () => {
      producing.resolve({ exportPath: 'D:/export' })
      saved = await done
    })

    // The patch persisted — WITHOUT the invalid interim sections.
    expect(saved).not.toBeNull()
    expect(saveMock).toHaveBeenCalledWith({
      data: {
        projectId: 'X:/proj',
        character: expect.objectContaining({
          exportPath: 'D:/export',
          sections: makeCharacter().sections, // pre-producer, valid
        }),
      },
    })
    expect(generateMock).toHaveBeenCalledTimes(1)
    // The interim edits stay in the DRAFT as dirty edits on top of the new
    // baseline; the user was pointed at them (validate toasted + jumped).
    expect(result.current.character.sections).toEqual(invalidSections)
    expect(result.current.character.exportPath).toBe('D:/export')
    expect(result.current.dirty).toBe(true)
    expect(onValidationErrors).toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
    expect(result.current.saving).toBe(false)
  })

  it('refuses outright when the producer PATCH itself is invalid: nothing persisted', async () => {
    const { result, onValidationErrors } = setup()
    const producing = deferred<Partial<Character> | null>()

    let done!: Promise<Character | null>
    act(() => {
      done = result.current.persistPatch(() => producing.promise)
    })
    await waitFor(() => expect(result.current.saving).toBe(true))

    let saved: Character | null = makeCharacter()
    await act(async () => {
      // The producer hands back a save-blocking patch — invalid on its own, so
      // there is no valid state to persist at all.
      producing.resolve({ sections: makeInvalidCharacter().sections, exportPath: 'D:/export' })
      saved = await done
    })

    expect(saved).toBeNull()
    expect(saveMock).not.toHaveBeenCalled()
    expect(generateMock).not.toHaveBeenCalled()
    expect(onValidationErrors).toHaveBeenCalled()
    // The refused patch is NOT applied to the draft.
    expect(result.current.character.exportPath).toBe('')
    expect(result.current.dirty).toBe(false)
    expect(result.current.saving).toBe(false)
  })

  it('a generate failure AFTER a successful persist keeps the patch, warns, resolves saved', async () => {
    const { result } = setup()
    saveMock.mockImplementationOnce(async ({ data }) => stamped((data as { character: Character }).character))
    generateMock.mockRejectedValueOnce(new Error('generation blew up'))

    let saved: Character | null = null
    await act(async () => {
      saved = await result.current.persistPatch({ exportPath: 'D:/export' })
    })

    // The persist landed: no rollback, baseline settled, saved handed back.
    expect(saved).not.toBeNull()
    expect(result.current.character.exportPath).toBe('D:/export')
    expect(result.current.dirty).toBe(false)
    expect(result.current.saving).toBe(false)
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('generation blew up'))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('plumbs previousName into generation (the inline rename)', async () => {
    const { result } = setup()
    saveMock.mockImplementationOnce(async ({ data }) => stamped((data as { character: Character }).character))
    generateMock.mockResolvedValueOnce(generated)

    await act(async () => {
      await result.current.persistPatch(
        { name: 'Nova' },
        { toast: 'Renamed to “Nova”', previousName: 'Electra G9' },
      )
    })
    expect(generateMock).toHaveBeenCalledWith({
      data: { projectId: 'X:/proj', id: 'test', previousName: 'Electra G9' },
    })
    expect(toast.success).toHaveBeenCalledWith('Renamed to “Nova”')
  })

  it('rethrow: a persist failure still rolls back but rethrows instead of toasting', async () => {
    const { result } = setup()
    saveMock.mockRejectedValueOnce(new Error('folder locked'))

    await act(async () => {
      await expect(
        result.current.persistPatch({ name: 'Nova' }, { rethrow: true }),
      ).rejects.toThrow('folder locked')
    })
    // Rolled back — the draft doesn't keep the failed name as a dirty edit …
    expect(result.current.character.name).toBe('Electra G9')
    expect(result.current.dirty).toBe(false)
    expect(result.current.saving).toBe(false)
    // … and the caller owns the error surface (EditableTitle): no hook toast.
    expect(toast.error).not.toHaveBeenCalled()
  })
})
