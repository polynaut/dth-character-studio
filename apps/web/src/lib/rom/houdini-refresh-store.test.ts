import { describe, expect, it } from 'vitest'

import {
  classifyRefreshTargets,
  dthReleaseChanged,
  emptyRefreshStore,
  forgetRefreshed,
  noteReleaseSeen,
  parseRefreshStore,
  pruneRefreshStore,
  refreshStoreKey,
  refreshTargetPaths,
  stampRefreshed,
} from './houdini-refresh-store.ts'

import type { HoudiniRefreshStore, LinkedHoudiniProject } from './houdini-refresh-store.ts'

const KIRA = 'D:/Projects/Demo/Kira/houdini/Kira.hip'
const NOVA = 'D:/Projects/Demo/Nova/houdini/Nova.hip'
const SHARED = 'D:/Templates/Base.hip'

function linked(...hipPaths: Array<string>): Array<LinkedHoudiniProject> {
  return hipPaths.map((hipPath) => ({ hipPath, characters: ['Kira'] }))
}

function storeWith(
  entries: Record<string, string>,
  lastSeenDthVersion = '',
): HoudiniRefreshStore {
  const projects: HoudiniRefreshStore['projects'] = {}
  for (const [path, dthVersion] of Object.entries(entries)) {
    projects[refreshStoreKey(path)] = { dthVersion, refreshedAt: '2026-08-20T10:00:00.000Z' }
  }
  return { version: 1, lastSeenDthVersion, projects }
}

describe('refreshStoreKey', () => {
  it('normalizes separators and case, the way every other path lookup does', () => {
    expect(refreshStoreKey('D:\\Projects\\Demo\\Kira\\houdini\\Kira.hip')).toBe(
      'd:/projects/demo/kira/houdini/kira.hip',
    )
    expect(refreshStoreKey('  D:/A/B.hip  ')).toBe('d:/a/b.hip')
  })
})

describe('parseRefreshStore', () => {
  it('fills defaults for a partial store', () => {
    const store = parseRefreshStore('{"projects":{"d:/a.hip":{"dthVersion":"2.5"}}}')
    expect(store.version).toBe(1)
    expect(store.lastSeenDthVersion).toBe('')
    expect(store.projects['d:/a.hip']).toEqual({ dthVersion: '2.5', refreshedAt: '' })
  })

  it('degrades to an empty store rather than throwing — a lost store costs one extra offer', () => {
    expect(parseRefreshStore('not json')).toEqual(emptyRefreshStore())
    expect(parseRefreshStore('{"projects":42}')).toEqual(emptyRefreshStore())
  })
})

describe('classifyRefreshTargets', () => {
  it('buckets by the release each project was last refreshed under', () => {
    const store = storeWith({ [KIRA]: '2.5', [NOVA]: '2.6' })
    const out = classifyRefreshTargets(linked(KIRA, NOVA, SHARED), store, '2.6')
    expect(out.map((c) => c.bucket)).toEqual(['stale', 'current', 'unknown'])
    expect(out[0].lastVersion).toBe('2.5')
    expect(out[2].lastVersion).toBe('')
  })

  it('matches an entry stored under a differently-spelled path', () => {
    const store = storeWith({ 'd:\\projects\\demo\\kira\\houdini\\KIRA.HIP': '2.6' })
    expect(classifyRefreshTargets(linked(KIRA), store, '2.6')[0].bucket).toBe('current')
  })

  it('judges nothing without an active release — everything is unknown, not stale', () => {
    const store = storeWith({ [KIRA]: '2.5' })
    expect(classifyRefreshTargets(linked(KIRA), store, '')[0].bucket).toBe('unknown')
  })
})

describe('dthReleaseChanged', () => {
  it('is false on a first-ever look — "never looked" is not "it changed"', () => {
    const store = emptyRefreshStore()
    const candidates = classifyRefreshTargets(linked(KIRA, NOVA), store, '2.6')
    expect(candidates.every((c) => c.bucket === 'unknown')).toBe(true)
    expect(dthReleaseChanged(candidates, store, '2.6')).toBe(false)
  })

  it('fires on a recorded release change even when no project has an entry', () => {
    const store = storeWith({}, '2.5')
    const candidates = classifyRefreshTargets(linked(KIRA), store, '2.6')
    expect(dthReleaseChanged(candidates, store, '2.6')).toBe(true)
  })

  it('fires on a project refreshed under another release, whatever lastSeen says', () => {
    const store = storeWith({ [KIRA]: '2.5' }, '2.6')
    const candidates = classifyRefreshTargets(linked(KIRA), store, '2.6')
    expect(dthReleaseChanged(candidates, store, '2.6')).toBe(true)
  })

  it('is quiet once everything is on the active release', () => {
    const store = storeWith({ [KIRA]: '2.6' }, '2.6')
    const candidates = classifyRefreshTargets(linked(KIRA), store, '2.6')
    expect(dthReleaseChanged(candidates, store, '2.6')).toBe(false)
  })

  it('is quiet for a project ADDED under the active release — it was built with it', () => {
    const store = storeWith({ [KIRA]: '2.6' }, '2.6')
    const candidates = classifyRefreshTargets(linked(KIRA, NOVA), store, '2.6')
    expect(candidates.map((c) => c.bucket)).toEqual(['current', 'unknown'])
    expect(dthReleaseChanged(candidates, store, '2.6')).toBe(false)
  })

  it('cannot fire without an active release', () => {
    const store = storeWith({ [KIRA]: '2.5' }, '2.5')
    expect(dthReleaseChanged(classifyRefreshTargets(linked(KIRA), store, ''), store, '')).toBe(false)
  })
})

describe('refreshTargetPaths', () => {
  it('runs on everything except what is already on the active release', () => {
    const store = storeWith({ [KIRA]: '2.5', [NOVA]: '2.6' }, '2.5')
    const candidates = classifyRefreshTargets(linked(KIRA, NOVA, SHARED), store, '2.6')
    expect(refreshTargetPaths(candidates)).toEqual([KIRA, SHARED])
  })
})

describe('stampRefreshed', () => {
  it('records the release per project without touching lastSeen', () => {
    const store = storeWith({}, '2.5')
    const next = stampRefreshed(store, [KIRA], '2.6', '2026-08-20T12:00:00.000Z')
    expect(next.projects[refreshStoreKey(KIRA)]).toEqual({
      dthVersion: '2.6',
      refreshedAt: '2026-08-20T12:00:00.000Z',
    })
    // The partial-sweep guard: a run that failed somewhere must leave the
    // release outstanding so the next refresh re-offers the remainder.
    expect(next.lastSeenDthVersion).toBe('2.5')
  })

  it('leaves a partly-failed sweep re-offering exactly what did not get done', () => {
    const store = storeWith({}, '2.5')
    // Two offered, one succeeded — no noteReleaseSeen, because it was not clean.
    const after = stampRefreshed(store, [KIRA], '2.6', '2026-08-20T12:00:00.000Z')
    const candidates = classifyRefreshTargets(linked(KIRA, NOVA), after, '2.6')
    expect(candidates.map((c) => c.bucket)).toEqual(['current', 'unknown'])
    expect(dthReleaseChanged(candidates, after, '2.6')).toBe(true)
    expect(refreshTargetPaths(candidates)).toEqual([NOVA])
  })

  it('converges once a clean sweep also records the release', () => {
    const store = storeWith({}, '2.5')
    const swept = noteReleaseSeen(
      stampRefreshed(store, [KIRA, NOVA], '2.6', '2026-08-20T12:00:00.000Z'),
      '2.6',
    )
    const candidates = classifyRefreshTargets(linked(KIRA, NOVA), swept, '2.6')
    expect(dthReleaseChanged(candidates, swept, '2.6')).toBe(false)
  })
})

describe('noteReleaseSeen', () => {
  it('records the active release', () => {
    expect(noteReleaseSeen(emptyRefreshStore(), '2.6').lastSeenDthVersion).toBe('2.6')
  })

  it('never records an unresolved release — that would consume a real change', () => {
    const store = storeWith({}, '2.5')
    expect(noteReleaseSeen(store, '')).toBe(store)
  })
})

describe('forgetRefreshed', () => {
  it('returns an undone project to `unknown`, so it is offered again', () => {
    const store = storeWith({ [KIRA]: '2.6', [NOVA]: '2.6' }, '2.6')
    const undone = forgetRefreshed(store, KIRA)
    // The restore put the file back on the previous release's definitions, so
    // the record must stop claiming otherwise — a kept entry would bucket the
    // project as `current` and quietly retire it from every future offer.
    const [kira, nova] = classifyRefreshTargets(linked(KIRA, NOVA), undone, '2.6')
    expect(kira?.bucket).toBe('unknown')
    expect(nova?.bucket).toBe('current')
  })

  it('leaves the release seen — one project going back does not unsee it', () => {
    // Clearing lastSeen would re-offer the WHOLE library to undo one project.
    expect(forgetRefreshed(storeWith({ [KIRA]: '2.6' }, '2.6'), KIRA).lastSeenDthVersion).toBe('2.6')
  })

  it('matches the stored key however the path is spelled, and is a no-op otherwise', () => {
    const store = storeWith({ [KIRA]: '2.6' }, '2.6')
    expect(forgetRefreshed(store, 'd:\\Projects\\Demo\\Kira\\houdini\\Kira.hip').projects).toEqual(
      {},
    )
    expect(forgetRefreshed(store, NOVA)).toBe(store)
  })
})

describe('pruneRefreshStore', () => {
  it('drops entries nothing links anymore, keeping the live ones', () => {
    const store = storeWith({ [KIRA]: '2.6', [NOVA]: '2.6' }, '2.6')
    const pruned = pruneRefreshStore(store, [KIRA])
    expect(Object.keys(pruned.projects)).toEqual([refreshStoreKey(KIRA)])
    expect(pruned.lastSeenDthVersion).toBe('2.6')
  })

  it('matches the live set by normalized path', () => {
    const store = storeWith({ [KIRA]: '2.6' })
    const pruned = pruneRefreshStore(store, ['D:\\Projects\\Demo\\Kira\\houdini\\Kira.hip'])
    expect(Object.keys(pruned.projects)).toHaveLength(1)
  })
})
