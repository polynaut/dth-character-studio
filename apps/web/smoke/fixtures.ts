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

import { installTauriMock } from './tauri-mock.ts'

import type { TauriMockSeed } from './tauri-mock.ts'
import type { Page } from '@playwright/test'

import { readFileSync } from 'node:fs'
import { dirname, join as joinNodePath } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Shared page helpers for the docs suites (guide.screenshots / guide.clips) ─

/** Every date/time the app renders resolves against this frozen instant — file
 *  mtimes from the mock (statOf uses Date.now IN the page), "saved …" stamps,
 *  recents. Frozen so a regeneration never diffs on timestamps alone. */
export const FIXED_TIME = new Date('2026-07-01T12:00:00')

/** Prime the page BEFORE the app bundle runs: freeze the clock (see
 *  FIXED_TIME — timers keep running, only Date is pinned), set the flag that
 *  gates the dev TanStack devtools trigger off (so it stays out of the shots —
 *  a DOM/CSS hack loses to the widget re-mounting during the capture), then
 *  install the in-memory Tauri fake with the fixture world. */
export async function prime(page: Page, seed: TauriMockSeed) {
  await page.clock.setFixedTime(FIXED_TIME)
  await page.addInitScript(() => {
    ;(window as unknown as { __dthHideDevtools?: boolean }).__dthHideDevtools = true
  })
  await page.addInitScript(installTauriMock, seed)
}

/** Let the route settle (fonts/images/layout) before measuring or shooting. */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
}

const HERE = dirname(fileURLToPath(import.meta.url))
/** Kira's avatar image bytes — the Daz scene's `.tip.png`, inlined as a data
 *  URL. Serves double duty: the primary scene's tip thumbnail AND the bytes
 *  behind the stored avatar snapshot ({@link AVATAR_FILE}). */
const AVATAR = `data:image/png;base64,${readFileSync(joinNodePath(HERE, 'kira-avatar.png')).toString('base64')}`
/** The character's STORED avatar reference: a snapshot of the primary scene's
 *  tip (`<id>--sc-<ts>`), the realistic state once a primary scene is linked —
 *  the app derives the avatar from that scene. Being an `sc` name makes
 *  `avatarShowsPrimaryScene` true, so the header shows NO counterpart badge on
 *  the primary scene and a ZOOMED badge when a non-primary scene is previewed
 *  (editor-header). Served from the project's `.dcsmeta/images` below. */
const AVATAR_FILE = 'char-kira--sc-1767225600000.png'
/** The Summertide outfit scene's own `.tip.png` — the extra scene card (and
 *  the header when that scene is selected) must show a different look. */
const AVATAR_SUMMERTIDE = `data:image/png;base64,${readFileSync(joinNodePath(HERE, 'kira-avatar-summertide.png')).toString('base64')}`
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

/** The GEN section enabled in preset mode (Golden Palace, female) with one
 *  art-direction morph on the VaginaOpen frame — so the ROM shows GEN enabled and
 *  the GEN art-direction screenshot has a populated example. */
const GEN_SECTION = {
  enabled: true,
  mode: 'preset',
  presetAssets: ['GP9 - Golden Palace.duf'],
  artDirection: [
    {
      id: 'ad-gp-vagina-open',
      rom: 'gp',
      frame: 96,
      name: 'VaginaOpen',
      morphs: [{ node: 'Genesis9', prop: 'GP_Vagina_Open_Stretch', value: 1 }],
    },
  ],
}

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
  /** An extra (outfit) scene for the multi-scene docs/smoke states — linked via
   *  `extraScenes` when SeedOptions.extraScene is on. */
  scene2: 'D:/DTH Projects/Demo/Kira/daz3d/KiraSummertide_G9_GP.duf',
  /** A linked Houdini project (inside the char folder → the card chip reads %CHAR%\houdini). */
  houdini: 'D:/DTH Projects/Demo/Kira/houdini/Kira.hip',
}

/** The hair item the demo character lists on its primary scene (Hair-items
 *  feature). Seeded as a scene wearable too, so it resolves instead of flagging. */
const HAIR_ITEM = 'CHT Sevenly Hair'
/** The extra (outfit) scene's own hair item — per-SCENE hair lists are the
 *  point of the multi-scene docs, so the outfit carries a different style. */
const HAIR_ITEM_2 = 'Nova Ponytail Hair'

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
  /** Files `probe_locked_files` reports as locked — drives the move dialog. */
  lockedFiles?: Array<string>
  /** The rich docs character (linked scene, avatar, populated FBM/JCM/preserve). */
  demo?: boolean
  /** Link a second (outfit) Daz scene with its own hair item — the multi-scene
   *  states (per-scene hair, the header scene tag, ROM overrides). Demo only. */
  extraScene?: boolean
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
          image: AVATAR_FILE,
          sections: { FBM: FBM_SECTION, GEN: GEN_SECTION },
          jcmMorphMods: JCM_MODS,
          preserveMorphs: PRESERVE_MORPHS,
          preserveNodeTransforms: PRESERVE_NODES,
          // A linked Houdini project + the "Hair items live in the Daz scenes"
          // feature: the primary scene lists one hair item (groomMode defaults to
          // 'scene', so the toggle is on).
          houdiniProjects: [P.houdini],
          groomScenes: [
            { scenePath: P.scene, nodes: [{ nodeLabel: HAIR_ITEM }] },
            // The outfit scene carries its own style — hair lists are per scene.
            ...(opts.extraScene
              ? [{ scenePath: P.scene2, nodes: [{ nodeLabel: HAIR_ITEM_2 }] }]
              : []),
          ],
          ...(opts.extraScene ? { extraScenes: [P.scene2] } : {}),
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
    // Morph index (a Scan_Morphs_G9.dsa run's output) — feeds the Morph-name
    // autocomplete (and its guide screenshot).
    [`${P.appData}/morphs_G9.json`]: JSON.stringify({
      morphs: [
        { node: 'Genesis9', nodeLabel: 'Kira', label: 'Glute UpDown', name: 'SS_body_bs_Glute UpDown' },
        { node: 'Genesis9', nodeLabel: 'Kira', label: 'Glute Width', name: 'SS_body_bs_Glute Width' },
        { node: 'Genesis9', nodeLabel: 'Kira', label: 'Glute Width Upper', name: 'SS_body_bs_Glute Width Upper' },
        { node: 'Genesis9', nodeLabel: 'Kira', label: 'Glute Height Inner', name: 'SS_body_bs_Glute Height Inner' },
        { node: 'Genesis9', nodeLabel: 'Kira', label: 'Glute Angle', name: 'SS_body_bs_Glute Angle' },
        { node: 'Genesis9', nodeLabel: 'Kira', label: 'Glutes Widen (GP)', name: 'GP_GlutesWiden1_Both' },
      ],
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
    // The stored avatar snapshot the character references — the app resolves it
    // from the project's hidden meta images (resolveImageSrc). Same bytes as the
    // primary scene's tip, since in the real app the snapshot IS that render.
    [`${P.project}/.dcsmeta/images/${AVATAR_FILE}`]: AVATAR,
    ...(opts.extraScene ? { [P.scene2]: 'duf-fixture', [`${P.scene2}.tip.png`]: AVATAR_SUMMERTIDE } : {}),
    [P.houdini]: 'hip-fixture',
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
    // The demo scene reports its hair item as a wearable so the groom pill resolves.
    sceneWearables: opts.demo
      ? [
          { id: 'cht-sevenly-hair', label: HAIR_ITEM, conformTarget: '#Genesis9' },
          ...(opts.extraScene
            ? [{ id: 'nova-ponytail-hair', label: HAIR_ITEM_2, conformTarget: '#Genesis9' }]
            : []),
        ]
      : undefined,
    // …and its base figure, so the create dialog auto-selects G9 from the scene.
    sceneFigure: opts.demo ? { id: 'Genesis9', label: 'Genesis 9' } : null,
    dufFrames: {
      [DUF.base]: FRAMES.base,
      [DUF.mouth]: FRAMES.mouth,
      [DUF.gp]: FRAMES.gp,
      [DUF.dk]: FRAMES.dk,
      [DUF.phys]: FRAMES.phys,
    },
    appDataDir: P.appData,
    activeProjectFile: opts.activeProjectFile ?? '',
    lockedFiles: opts.lockedFiles,
    version: '0.0.0-e2e',
  }
}
