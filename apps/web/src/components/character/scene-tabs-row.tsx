import { Tabs, TabsList, TabsTrigger } from '@dth/ui'

import { SceneLabel } from '#/components/character/scene-label.tsx'

/**
 * The editor's tab bar (Character / Products / Notes) plus a PASSIVE, prominent
 * scene-context label — shown only while an EXTRA scene is selected (the primary IS
 * the base). No toggle: it just names the scene whose overrides you're editing.
 * Rendered inside the sticky "chrome" group (with the header) in the route, so it
 * stays pinned under the collapsing header with NO JS-measured CSS var.
 */
export function SceneTabsRow({
  activeTab,
  onTabChange,
  showProducts,
  scenePath,
  sceneName,
  showSceneLabel,
  overrideCount,
}: {
  activeTab: string
  onTabChange: (tab: 'character' | 'products' | 'notes') => void
  showProducts: boolean
  scenePath: string
  sceneName: string
  showSceneLabel: boolean
  /** Number of override panels armed for the selected scene → the label's eyebrow. */
  overrideCount: number
}) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => onTabChange(v === 'products' || v === 'notes' ? v : 'character')}
    >
      <div className="flex items-center gap-3 py-1 pb-4">
        <TabsList>
          <TabsTrigger value="character">Character</TabsTrigger>
          {showProducts && <TabsTrigger value="products">Products</TabsTrigger>}
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        {/* Double-click jumps back up to the Daz scenes section (the first panel, where
            you pick the scene) — it's at the top, so a smooth scroll-to-top lands it in
            view without fighting the collapsing chrome's height. */}
        {showSceneLabel && (
          <span
            className="ml-auto -mt-[23px] tabs-label-drop bg-background select-none"
            onDoubleClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <SceneLabel scenePath={scenePath} name={sceneName} eyebrow={`Overrides ${overrideCount}`} />
          </span>
        )}
      </div>
    </Tabs>
  )
}
