import { ConfigError } from '#/components/config-error.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dth/ui'
import { genAssetGender } from '@dth/rom'

import type {
  DthPoseAsset,
  Gender,
  GenesisVersion,
  RomSection,
  RomSectionConfig,
} from '@dth/rom'

export interface PoseAssetCatalog {
  folder: string
  assets: Array<DthPoseAsset>
  error: string | null
}

export const PRESET_DESCRIPTIONS: Partial<Record<RomSection, string>> = {
  RET: 'Covered by the pre-defined DTH base ROM (RestPose, UnrealPose, TPose, …). Loads together with the Joint Corrective base ROM.',
  JCM: 'Pre-defined DTH base ROM (DQS / linear).',
  FAC: 'Pre-defined DTH face ROM (on Genesis 9 incl. the separate Mouth figure ROM).',
  GEN: 'Pre-defined genitalia ROM.',
  PHY: 'Pre-defined physics example ROM. Map its poses in the PoseAsset node manually for now.',
}

// Radix Select forbids an empty-string item value, so the "auto" asset choice
// (no explicit preset selected) uses a sentinel mapped back to [] on change.
const AUTO_ASSET = '__auto__'

export function PresetAssetPicker({
  section,
  config,
  genesis,
  gender,
  skinning,
  facEnabled,
  catalog,
  onChange,
}: {
  section: RomSection
  config: RomSectionConfig
  genesis: GenesisVersion
  gender: Gender
  skinning: 'linear' | 'dqs'
  facEnabled: boolean
  catalog: PoseAssetCatalog
  onChange: (presetAssets: Array<string>) => void
}) {
  const available = catalog.assets.filter(
    (asset) =>
      asset.section === section &&
      (asset.genesis === null || asset.genesis === genesis) &&
      // GEN assets are gender-specific: female → Golden Palace, male → Dicktator.
      (section !== 'GEN' || (genAssetGender(asset.name) ?? gender) === gender),
  )

  if (catalog.error) {
    return <ConfigError message={catalog.error} />
  }
  if (available.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No pre-defined {section} preset available for {genesis} in the Poses folder.
      </p>
    )
  }

  const fileNameOf = (asset: DthPoseAsset) => `${asset.name}.duf`
  const selectedFirst = config.presetAssets[0] ?? ''
  const selectedAsset = available.find((asset) => fileNameOf(asset) === selectedFirst)
  // The JCM asset IS the skinning choice (there is no separate skinning
  // setting), so without an explicit pick we preselect the DTH-recommended
  // DQS variant matching the FAC section state.
  const jcmDefault =
    section === 'JCM'
      ? (available.find((a) => a.skinning === 'dqs' && a.includesFac === facEnabled) ??
        available.find((a) => a.skinning === 'dqs') ??
        available[0])
      : undefined
  // With a single candidate there is nothing to choose — it IS the asset.
  const effectiveAsset =
    available.length === 1 ? available[0] : (selectedAsset ?? jcmDefault)

  const hints: Array<string> = []
  if (section === 'JCM' && effectiveAsset) {
    if (effectiveAsset.includesFac && !facEnabled) {
      hints.push('This asset bakes in the FAC poses but the FAC section is disabled.')
    }
    if (!effectiveAsset.includesFac && facEnabled) {
      hints.push('The FAC section is enabled but this asset has no FAC poses baked in.')
    }
  }

  // The FAC (mouth) ROM is not a choice: DthWorkflow resolves it from the
  // skinning, which the JCM asset defines — show the resolved file read-only.
  if (section === 'FAC') {
    const resolved = available.find((a) => a.skinning === skinning) ?? available[0]
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Asset:</span>
          <span
            className="cursor-default rounded-md border border-input bg-muted/40 px-2 py-1 text-sm text-muted-foreground"
            title="Follows the JCM asset — the workflow loads the mouth ROM matching its skinning variant"
          >
            {resolved.name}
          </span>
          <span className="text-xs text-muted-foreground">follows the JCM asset</span>
        </div>
        <p className="text-xs text-muted-foreground">{resolved.relPath}</p>
      </div>
    )
  }

  if (available.length === 1) {
    const only = available[0]
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Asset:</span>
          <span
            className="cursor-default rounded-md border border-input bg-muted/40 px-2 py-1 text-sm text-muted-foreground"
            title="The only available asset for this section and generation"
          >
            {only.name}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{only.relPath}</p>
        {hints.map((hint) => (
          <p key={hint} className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ {hint}
          </p>
        ))}
      </div>
    )
  }

  // GEN allows combining ROMs (e.g. Golden Palace + Dicktator) — multi-select.
  if (section === 'GEN') {
    return (
      <div className="space-y-2">
        {available.map((asset) => {
          const fileName = fileNameOf(asset)
          const checked = config.presetAssets.includes(fileName)
          return (
            <label key={asset.relPath} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={checked}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...config.presetAssets, fileName]
                      : config.presetAssets.filter((name) => name !== fileName),
                  )
                }
              />
              <span>{asset.name}</span>
              <span className="text-xs text-muted-foreground">{asset.relPath}</span>
            </label>
          )
        })}
        {config.presetAssets.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nothing selected — defaults to Golden Palace at generation time.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Asset:</span>
        <Select
          value={
            section === 'JCM'
              ? selectedFirst || (jcmDefault ? fileNameOf(jcmDefault) : '')
              : selectedFirst || AUTO_ASSET
          }
          onValueChange={(value) => onChange(value && value !== AUTO_ASSET ? [value] : [])}
        >
          <SelectTrigger size="sm" className="w-fit max-w-[20rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {section !== 'JCM' && (
              <SelectItem value={AUTO_ASSET}>auto — matched to {genesis} at generation</SelectItem>
            )}
            {available.map((asset) => (
              <SelectItem key={asset.relPath} value={fileNameOf(asset)}>
                {asset.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {effectiveAsset && (
        <p className="text-xs text-muted-foreground">{effectiveAsset.relPath}</p>
      )}
      {hints.map((hint) => (
        <p key={hint} className="text-xs text-amber-600 dark:text-amber-400">
          ⚠ {hint}
        </p>
      ))}
    </div>
  )
}
