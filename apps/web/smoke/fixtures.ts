// Fixture world for the e2e smoke tests: one project ("Smoke Project") with one
// character ("Kira", G9 female) plus a configured app-data + DTH release
// tree, seeded into the in-memory fake filesystem (see tauri-mock.ts).
//
// The character definition is built through the REAL `characterSchema`, so a
// schema bump can never leave a silently-invalid fixture behind — the parse
// throws at test time instead. Imported from the rom package's types module
// directly: the package root re-exports generate.ts, whose Vite-only `?raw`
// template imports Playwright's node-side loader can't resolve.
import {
  CHARACTER_SCHEMA_VERSION,
  RUNTIME_VERSION,
  characterSchema,
} from '../../../packages/rom/src/types.ts'

import type { TauriMockSeed } from './tauri-mock.ts'

import { readFileSync } from 'node:fs'
import { dirname, join as joinNodePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Kira's avatar — the Daz scene's `.tip.png`, inlined as a data URL
 *  (`canonicalImage` keeps `data:` URLs verbatim, so no fake-fs image file is
 *  needed to render it). */
const AVATAR = `data:image/png;base64,${readFileSync(joinNodePath(HERE, 'kira-avatar.png')).toString('base64')}`
/** A realistic FBM section (49 custom full-body morphs, lifted from a real Kira)
 *  so the docs show a populated ROM section instead of an empty one. */
const FBM_SECTION = JSON.parse(readFileSync(joinNodePath(HERE, 'kira-fbm.json'), 'utf8'))
/** A realistic Daz-Products scan CSV (the format `Scan_Products_<Name>.dsa`
 *  writes) — seeded into the character's scan folder so the Products tab shows a
 *  populated "Matched products" table. */
const PRODUCT_SCAN_CSV = readFileSync(joinNodePath(HERE, 'kira-products.csv'), 'utf8')

/** Realistic "Modify JCM frames" data (from a real DazToHue script): drive glute
 *  morphs proportionally to thigh-bone rotation, so the JCM-mods grid screenshot
 *  shows a real example instead of an empty grid. */
const JCM_MODS = [
  {
    boneLabel: 'Left Thigh',
    axis: 'XRotate',
    drives: [
      {
        morphName: 'SL_Glutes SS Left',
        range: { angle: { start: 0, end: -115 }, value: { start: 0, end: 0.33 } },
      },
      {
        morphName: 'SL_Glutes Up_Down Left',
        range: { angle: { start: 0, end: -115 }, value: { start: 0, end: 0.33 } },
      },
    ],
  },
  {
    boneLabel: 'Right Thigh',
    axis: 'XRotate',
    drives: [
      {
        morphName: 'SL_Glutes SS Right',
        range: { angle: { start: 0, end: -115 }, value: { start: 0, end: 0.33 } },
      },
      {
        morphName: 'SL_Glutes Up_Down Right',
        range: { angle: { start: 0, end: -115 }, value: { start: 0, end: 0.33 } },
      },
    ],
  },
]
/** Realistic "Preserve morphs after ROM loading" + "Preserve node transforms"
 *  examples (from the DazToHue script options) for the Advanced-options shot. */
const PRESERVE_MORPHS = [{ name: 'body_ctrl_BreastsUp-Down', keepValue: 1 }]
const PRESERVE_NODES = [{ nodeLabel: 'Left Eye' }, { nodeLabel: 'Right Eye' }]

/** DTH release version the fixture ships — settings, provenance and the release
 *  folder name below must all agree on it (era-matching keeps staleness quiet). */
const DTH_VERSION = '2.4.3'

/** The virtual world's absolute paths (all '/'-separated — the fake fs is a
 *  string map; nothing here touches a real disk). */
export const P = {
  appData: 'C:/Users/You/AppData/Local/com.polynaut.dthcharacterstudio',
  dazLib: 'D:/DAZ 3D/My DAZ 3D Library',
  release: `X:/DazToHue/Releases/DazToHue-${DTH_VERSION}`,
  posesRoot: `X:/DazToHue/Releases/DazToHue-${DTH_VERSION}/Daz Studio Content/DazToHue/Poses`,
  project: 'D:/DTH Projects/Demo',
  dcsp: 'D:/DTH Projects/Demo/Demo.dcsp',
  charFolder: 'D:/DTH Projects/Demo/Kira',
  /** Where Save installs the character's Daz scripts (project/character names). */
  scriptsDir: 'D:/DAZ 3D/My DAZ 3D Library/Scripts/DTH-Character-Studio/Demo/Kira',
  /** The character's primary Daz scene — mandatory in the real create flow, so
   *  the demo character carries one (the docs shot must show a linked scene). */
  scene: 'D:/DTH Projects/Demo/Kira/daz3d/KiraDefault_G9_GP.duf',
}

/** Fixture `.duf` pose assets. Paths follow the layout `classifyPose` expects
 *  (`<Genesis N>/<DQS|Linear|…>/<name>.duf`); the names carry the JCM/FAC/GEN/
 *  physics markers the classifier reads. */
export const DUF = {
  base: `${P.posesRoot}/Genesis 9/DQS/G9 DQS JCM FAC - Base.duf`,
  mouth: `${P.posesRoot}/Genesis 9/DQS/G9 DQS JCM FAC - Mouth.duf`,
  gp: `${P.posesRoot}/Genesis 9/Common/Golden Palace 9/GP9 - Golden Palace.duf`,
  dk: `${P.posesRoot}/Genesis 9/Common/Dicktator 9/DK9 - Dicktator.duf`,
  phys: `${P.posesRoot}/Genesis 9/Common/DTH Physics.duf`,
}

/** Frame lengths the fake `pose_asset_frames` measures for each block. */
export const FRAMES = { base: 328, mouth: 21, gp: 104, dk: 54, phys: 21 }

/** A linked Unreal project for the project-window footer-bar screenshot. */
export const UPROJECT = 'D:/Unreal Projects/DemoGame/DemoGame.uproject'
/** A realistic DAZ Install Manager manifests folder for the Daz-Products docs. */
export const DIM_FOLDER = 'E:/DAZ 3D/Install Manager/ManifestFiles'

export interface SeedOptions {
  activeProjectFile?: string
  /** The rich docs character (linked scene, avatar, populated FBM/JCM/preserve). */
  demo?: boolean
  /** `.dcsp` manifest: opt-in Attachments feature (adds the Attachments tab). */
  assetsEnabled?: boolean
  /** `.dcsp` manifest: opt-in Daz Products feature (adds the Products tab). */
  dazProductsEnabled?: boolean
  /** `.dcsp` manifest: linked Unreal `.uproject` paths (the footer bar). */
  unrealProjects?: Array<string>
  /** settings.json: the DIM manifests folder (Settings → Project product config). */
  dimManifestsFolder?: string
  /** What the native picker returns — a path to simulate a pick, else cancelled. */
  dialogPath?: string
  /** Seed a per-scene product-scan CSV into the demo character's scan folder so
   *  the Products tab renders a populated "Matched products" table. */
  productScan?: boolean
  /** No recent projects — the Home screen's first-run state (create-project shot). */
  emptyRecents?: boolean
  /** Omit the character definition, so the project overview shows its empty
   *  "no characters yet" state (the just-created project window shot). */
  emptyProject?: boolean
}

export function buildSeed(opts: SeedOptions = {}): TauriMockSeed {
  const character = characterSchema.parse({
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    id: 'char-kira',
    name: 'Kira',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    // CSV provenance matches the active release's era — keeps the startup
    // staleness probe from redirecting the whole window to /tools.
    generatedDthVersion: DTH_VERSION,
    // `demo` (the docs screenshots) wants a realistic character — a linked
    // primary Daz scene (mandatory in the real create flow), the scene's avatar,
    // and a populated FBM ROM section (49 morphs). The smoke suite omits all of
    // it so its generation assertions stay pinned to a minimal, stable character.
    ...(opts.demo
      ? {
          scenePath: P.scene,
          image: AVATAR,
          sections: { FBM: FBM_SECTION },
          jcmMorphMods: JCM_MODS,
          preserveMorphs: PRESERVE_MORPHS,
          preserveNodeTransforms: PRESERVE_NODES,
        }
      : {}),
  })

  const files: Record<string, string> = {
    [`${P.appData}/settings.json`]: JSON.stringify({
      dazLibraryFolder: P.dazLib,
      dthPosesFolder: P.release,
      currentDthVersion: DTH_VERSION,
      // Machine-wide, but edited on the Settings → Project tab (product scanning).
      ...(opts.dimManifestsFolder ? { dimManifestsFolder: opts.dimManifestsFolder } : {}),
    }),
    // NOTE: no projects.json / network-drives.json — their absence keeps the
    // legacy migration and the drive remapping paths inert at startup.
    [`${P.appData}/recents.json`]: JSON.stringify(
      opts.emptyRecents ? [] : [{ path: P.dcsp, name: 'Demo', lastOpenedAt: '2026-07-16T00:00:00.000Z' }],
    ),
    [P.dcsp]: JSON.stringify({
      schemaVersion: 2,
      id: 'proj-smoke',
      name: 'Demo',
      createdAt: '2026-01-01T00:00:00.000Z',
      dazSubdir: 'daz3d',
      houdiniSubdir: 'houdini',
      createHoudiniSubdir: true,
      assetsEnabled: opts.assetsEnabled ?? false,
      dazProductsEnabled: opts.dazProductsEnabled ?? false,
      charactersSubdir: '',
      unrealProjects: opts.unrealProjects ?? [],
    }),
    [`${P.charFolder}/Kira.json`]: JSON.stringify(character, null, 2),
    // The primary Daz scene the demo character links to (a fake `.duf`) plus its
    // `.tip.png` thumbnail — seeded as the avatar data URL so the scene card
    // shows the SAME image as the avatar, exactly as it would in the real app
    // (the mock decodes the data URL to real bytes for readFile).
    [P.scene]: 'duf-fixture',
    [`${P.scene}.tip.png`]: AVATAR,
    // A release root is marked by copyright.txt; the version parses from the
    // folder name (single-release mode).
    [`${P.release}/copyright.txt`]: 'DazToHue e2e fixture release',
    [DUF.base]: 'duf-fixture',
    [DUF.mouth]: 'duf-fixture',
    [DUF.gp]: 'duf-fixture',
    [DUF.dk]: 'duf-fixture',
    [DUF.phys]: 'duf-fixture',
    // A generated script on the CURRENT runtime, so the startup staleness probe
    // (schema + runtime + CSV era) finds nothing to refresh.
    [`${P.scriptsDir}/ROM_Kira_G9.dsa`]: `// DTH-Runtime: v${RUNTIME_VERSION}\n// e2e fixture — overwritten by the first real Save\n`,
  }

  // A per-scene product-scan CSV in the character's app-data scan folder
  // (`product-scans/<projectId>/<characterId>/`, keyed by the manifest id +
  // character id — see storage.productScanDir), so the Products tab reads and
  // renders it exactly as it would a real scan written from Daz.
  if (opts.productScan) {
    files[`${P.appData}/product-scans/proj-smoke/char-kira/KiraDefault_G9_GP.csv`] =
      PRODUCT_SCAN_CSV
  }

  // A freshly-created project has no characters yet — drop the definition so the
  // overview renders its empty "no characters yet" state.
  if (opts.emptyProject) delete files[`${P.charFolder}/Kira.json`]

  return {
    files,
    dialogPath: opts.dialogPath,
    dufFrames: {
      [DUF.base]: FRAMES.base,
      [DUF.mouth]: FRAMES.mouth,
      [DUF.gp]: FRAMES.gp,
      [DUF.dk]: FRAMES.dk,
      [DUF.phys]: FRAMES.phys,
    },
    appDataDir: P.appData,
    activeProjectFile: opts.activeProjectFile ?? '',
    version: '0.0.0-e2e',
  }
}
