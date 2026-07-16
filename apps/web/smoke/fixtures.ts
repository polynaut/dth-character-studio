// Fixture world for the e2e smoke tests: one project ("Smoke Project") with one
// character ("Electra", G9 female) plus a configured app-data + DTH release
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

/** DTH release version the fixture ships — settings, provenance and the release
 *  folder name below must all agree on it (era-matching keeps staleness quiet). */
const DTH_VERSION = '2.4.3'

/** The virtual world's absolute paths (all '/'-separated — the fake fs is a
 *  string map; nothing here touches a real disk). */
export const P = {
  appData: 'C:/e2e/appdata',
  dazLib: 'C:/e2e/dazlib',
  release: `C:/e2e/dth/DazToHue-${DTH_VERSION}`,
  posesRoot: `C:/e2e/dth/DazToHue-${DTH_VERSION}/Daz Studio Content/DazToHue/Poses`,
  project: 'C:/e2e/projects/Smoke',
  dcsp: 'C:/e2e/projects/Smoke/smoke.dcsp',
  charFolder: 'C:/e2e/projects/Smoke/Electra',
  /** Where Save installs the character's Daz scripts (project/character names). */
  scriptsDir: 'C:/e2e/dazlib/Scripts/DTH-Character-Studio/Smoke Project/Electra',
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

export function buildSeed(opts: { activeProjectFile?: string } = {}): TauriMockSeed {
  const character = characterSchema.parse({
    schemaVersion: CHARACTER_SCHEMA_VERSION,
    id: 'char-electra',
    name: 'Electra',
    genesis: 'G9',
    gender: 'female',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    // CSV provenance matches the active release's era — keeps the startup
    // staleness probe from redirecting the whole window to /tools.
    generatedDthVersion: DTH_VERSION,
  })

  const files: Record<string, string> = {
    [`${P.appData}/settings.json`]: JSON.stringify({
      dazLibraryFolder: P.dazLib,
      dthPosesFolder: P.release,
      currentDthVersion: DTH_VERSION,
    }),
    // NOTE: no projects.json / network-drives.json — their absence keeps the
    // legacy migration and the drive remapping paths inert at startup.
    [`${P.appData}/recents.json`]: JSON.stringify([
      { path: P.dcsp, name: 'Smoke Project', lastOpenedAt: '2026-07-16T00:00:00.000Z' },
    ]),
    [P.dcsp]: JSON.stringify({
      schemaVersion: 2,
      id: 'proj-smoke',
      name: 'Smoke Project',
      createdAt: '2026-01-01T00:00:00.000Z',
      dazSubdir: 'daz3d',
      houdiniSubdir: 'houdini',
      createHoudiniSubdir: true,
      assetsEnabled: false,
      dazProductsEnabled: false,
      charactersSubdir: '',
      unrealProjects: [],
    }),
    [`${P.charFolder}/Electra.json`]: JSON.stringify(character, null, 2),
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
    [`${P.scriptsDir}/ROM_Electra_G9.dsa`]: `// DTH-Runtime: v${RUNTIME_VERSION}\n// e2e fixture — overwritten by the first real Save\n`,
  }

  return {
    files,
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
