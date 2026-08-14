// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/lib/rom/api.ts', () => ({
  fetchDetectedFiles: vi.fn(),
  ignoreDetectedFiles: vi.fn(),
}))

import { characterSchema, defaultSections } from '@dth/rom'

import { fetchDetectedFiles } from '#/lib/rom/api.ts'
import { useDetectedFiles } from './use-detected-files.ts'

import type { Character } from '@dth/rom'

const fetchMock = vi.mocked(fetchDetectedFiles)

const UNLINKED = 'C:/proj/Lara/daz3d/LaraCroft_G81_THICK.duf'

function character(extraScenes: Array<string> = []): Character {
  const now = '2026-06-11T00:00:00.000Z'
  return characterSchema.parse({
    id: 'lara',
    name: 'Lara',
    createdAt: now,
    updatedAt: now,
    sections: defaultSections(),
    scenePath: 'C:/proj/Lara/daz3d/LaraCroft_G8_1.duf',
    extraScenes,
  })
}

beforeEach(() => {
  // The folder always still holds the scene — which is the point: an unlink
  // keeps the file, and a delete removes it only AFTER the unlink persists.
  fetchMock.mockResolvedValue({ scenes: [UNLINKED], houdini: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useDetectedFiles', () => {
  it('offers an unlinked file in the folder', async () => {
    const { result } = renderHook(() => useDetectedFiles('C:/proj', character()))
    await waitFor(() => expect(result.current.detected.scenes).toEqual([UNLINKED]))
  })

  it('stops offering a scene the user just removed', async () => {
    const { result } = renderHook(() => useDetectedFiles('C:/proj', character([UNLINKED])))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await act(async () => {
      result.current.answerFor([UNLINKED])
    })
    expect(result.current.detected.scenes).toEqual([])
  })

  it('keeps it suppressed when a later scan still reports it', async () => {
    // The delete race: the unlink persists, which re-runs the scan while the
    // file is still on disk. That scan must not resurrect the banner.
    const { result } = renderHook(() => useDetectedFiles('C:/proj', character([UNLINKED])))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await act(async () => {
      result.current.answerFor([UNLINKED])
    })
    await act(async () => {
      result.current.refresh()
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current.detected.scenes).toEqual([])
  })

  it('matches case-insensitively — Windows paths reach it either way', async () => {
    const { result } = renderHook(() => useDetectedFiles('C:/proj', character([UNLINKED])))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    await act(async () => {
      result.current.answerFor([UNLINKED.toUpperCase()])
    })
    expect(result.current.detected.scenes).toEqual([])
  })

  it('still offers OTHER new files', async () => {
    const other = 'C:/proj/Lara/daz3d/Something_Else.duf'
    fetchMock.mockResolvedValue({ scenes: [UNLINKED, other], houdini: [] })
    const { result } = renderHook(() => useDetectedFiles('C:/proj', character([UNLINKED])))
    await waitFor(() => expect(result.current.detected.scenes.length).toBe(2))

    await act(async () => {
      result.current.answerFor([UNLINKED])
    })
    expect(result.current.detected.scenes).toEqual([other])
  })
})
