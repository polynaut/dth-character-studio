import { screenModules } from './screens.ts'

type Manifest = {
  screens: { module: string; id: string }[]
  demos: { module: string; export: string }[]
}

const demoModules = import.meta.glob<Record<string, unknown>>(
  '../../../packages/ui/src/**/*.demo.tsx',
)

async function buildManifest(): Promise<Manifest> {
  const screens = (
    await Promise.all(
      Object.entries(screenModules).map(async ([module, load]) =>
        (await load()).default.screens.map((s) => ({ module, id: s.id })),
      ),
    )
  ).flat()
  const demos = (
    await Promise.all(
      Object.entries(demoModules).map(async ([module, load]) =>
        Object.entries(await load())
          .filter(([, v]) => typeof v === 'function')
          .map(([name]) => ({ module, export: name })),
      ),
    )
  ).flat()
  return { screens, demos }
}

void buildManifest().then((m) => {
  ;(window as unknown as { __dsManifest: Manifest }).__dsManifest = m
  document.documentElement.setAttribute('data-ready', '')
})
