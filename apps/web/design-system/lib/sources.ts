const app = import.meta.glob<string>('../../src/**/*.tsx', { query: '?raw', import: 'default' })
const kit = import.meta.glob<string>('../../../../packages/ui/src/**/*.tsx', { query: '?raw', import: 'default' })

// Demos, screens and tests are fixtures, not product code.
const FIXTURE = /\.(demo|screens|test)\.tsx$/

let cached: Promise<Record<string, string>> | undefined

/** Product sources by repo-relative path (`apps/web/src/...`, `packages/ui/src/...`). */
export function loadSources(): Promise<Record<string, string>> {
  cached ??= (async () => {
    const entries = [...Object.entries(app), ...Object.entries(kit)].filter(([k]) => !FIXTURE.test(k))
    const loaded = await Promise.all(entries.map(async ([k, load]) => [k, await load()] as const))
    return Object.fromEntries(
      loaded.map(([k, src]) => [k.replace(/^(\.\.\/)+/, k.includes('packages/') ? '' : 'apps/web/'), src]),
    )
  })()
  return cached
}
