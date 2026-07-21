/**
 * Generation entry point — a barrel over the three cohesive halves the old
 * monolith split into (public API unchanged; consumers keep importing from
 * here / the package index):
 *
 *  - resolve.ts — catalog/path resolution: which shipped preset `.duf`s the
 *    character's selections resolve to (`resolveRomPaths`,
 *    `sectionPresetAvailable`, `facPresetSupport`, `presetFramesSignature`).
 *  - csv.ts — the PoseAsset-CSV pipeline: template gate + splice, custom-row
 *    emitters, exporter reference frames (`toPoseAssetCsv`,
 *    `poseAssetCsvValidated`, `templateBakedPoseNames`, …).
 *  - dsa.ts — the `.dsa` generators + the `generateAll` entry point (per-scene
 *    overrides fold into the one character script).
 *
 * The embedded-DzScript snippet bodies live in dz-snippets.ts, which stays
 * package-internal (not re-exported).
 */
export * from './csv'
export * from './dsa'
export * from './resolve'
