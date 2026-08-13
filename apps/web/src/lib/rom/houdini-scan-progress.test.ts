import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  houdiniScanningSnapshot,
  isHoudiniProjectScanning,
  markHoudiniScanning,
  resetHoudiniScanningForTests,
  subscribeHoudiniScanning,
} from './houdini-scan-progress.ts'

const HIP = 'D:/DTH Projects/Demo/Kira/houdini/Kira.hip'
const OTHER = 'D:/DTH Projects/Demo/Kira/houdini/Kira_Alt.hip'

beforeEach(() => {
  resetHoudiniScanningForTests()
})

describe('the Houdini scan-progress store', () => {
  it('marks a project while it is read and clears it on release', () => {
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), HIP)).toBe(false)

    const release = markHoudiniScanning([HIP])
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), HIP)).toBe(true)

    release()
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), HIP)).toBe(false)
  })

  it('matches a path separator- and case-insensitively, like every other lookup', () => {
    const release = markHoudiniScanning([HIP])
    // The card renders whatever the character JSON stored — which is not
    // guaranteed to be the spelling the scan was handed.
    expect(
      isHoudiniProjectScanning(
        houdiniScanningSnapshot(),
        'd:\\dth projects\\demo\\kira\\houdini\\kira.hip',
      ),
    ).toBe(true)
    release()
  })

  it('counts holders, so the first release does not clear a scan the second still owns', () => {
    // The real pair: the background sweep and the drawer's Rescan. They are
    // separate calls (only IDENTICAL batches coalesce), so the same project can
    // legitimately be held twice — and a flag would let the faster one turn off
    // a spinner the slower one still needs.
    const releaseSweep = markHoudiniScanning([HIP])
    const releaseRescan = markHoudiniScanning([HIP])

    releaseSweep()
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), HIP)).toBe(true)

    releaseRescan()
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), HIP)).toBe(false)
  })

  it('ignores a second call to the same release', () => {
    // `scanHoudiniMaterials` releases in a `finally`; a double-release would
    // decrement a count another scan owns and blink its spinner off.
    const release = markHoudiniScanning([HIP])
    const otherRelease = markHoudiniScanning([HIP])
    release()
    release()
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), HIP)).toBe(true)
    otherRelease()
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), HIP)).toBe(false)
  })

  it('keeps the snapshot reference stable until membership really changes', () => {
    // useSyncExternalStore re-renders whenever getSnapshot() returns a new
    // reference — handing back a fresh Set every call is an infinite loop.
    const before = houdiniScanningSnapshot()
    expect(houdiniScanningSnapshot()).toBe(before)

    const release = markHoudiniScanning([HIP])
    const during = houdiniScanningSnapshot()
    expect(during).not.toBe(before)

    // A second holder on the SAME path changes nothing observable.
    const second = markHoudiniScanning([HIP])
    expect(houdiniScanningSnapshot()).toBe(during)

    second()
    release()
  })

  it('notifies subscribers only on a real change, and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeHoudiniScanning(listener)

    const release = markHoudiniScanning([HIP])
    expect(listener).toHaveBeenCalledTimes(1)

    // Same path again — no membership change, no re-render.
    const second = markHoudiniScanning([HIP])
    expect(listener).toHaveBeenCalledTimes(1)

    // A different path IS a change.
    const other = markHoudiniScanning([OTHER])
    expect(listener).toHaveBeenCalledTimes(2)

    other()
    second()
    release()
    expect(listener).toHaveBeenCalledTimes(4)

    unsubscribe()
    markHoudiniScanning([HIP])
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('marks nothing for an empty list, so a fully-cached scan spins no card', () => {
    // The case that made this a counted set rather than a boolean "a sweep is
    // running": every project served from the mtime cache costs no process, and
    // spinning those cards on every page load would train the eye to ignore it.
    const listener = vi.fn()
    subscribeHoudiniScanning(listener)
    const release = markHoudiniScanning([])
    expect(houdiniScanningSnapshot().size).toBe(0)
    expect(listener).not.toHaveBeenCalled()
    release()
  })

  it('holds each path of a batch independently', () => {
    const release = markHoudiniScanning([HIP, OTHER])
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), HIP)).toBe(true)
    expect(isHoudiniProjectScanning(houdiniScanningSnapshot(), OTHER)).toBe(true)
    release()
    expect(houdiniScanningSnapshot().size).toBe(0)
  })
})
