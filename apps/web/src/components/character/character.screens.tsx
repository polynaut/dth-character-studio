import { clickByName, waitFor } from '../../../design-system/drive.ts'
import { defineScreens } from '../../../design-system/screens.ts'

import { P } from '../../../smoke/fixture-paths.ts'

const route = `/projects/${encodeURIComponent(P.project)}/characters/${P.characterId}`
const HOUDINI = 'C:/Program Files/Side Effects Software/Houdini 22.0.368'
const settingsPath = `${P.appData}/settings.json`

// A scan is an hython run, so the fake needs an install to run it in.
const withHoudini = (files: Record<string, string>) => {
  files[settingsPath] = JSON.stringify({
    ...JSON.parse(files[settingsPath] ?? '{}'),
    houdiniInstallFolder: HOUDINI,
    houdiniDocsFolder: 'C:/Users/You/Documents/houdini22.0',
  })
  files[`${HOUDINI}/bin/hython.exe`] = 'hython-exe-fixture'
}

export default defineScreens('Character', [
  {
    id: 'character-editor',
    title: 'Character editor',
    route,
    seed: { demo: true, activeProjectFile: P.dcsp },
  },
  {
    id: 'export-panel',
    title: 'DTH Export panel',
    route,
    seed: { demo: true, activeProjectFile: P.dcsp, dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio6' },
    tune: (seed) => {
      withHoudini(seed.files)
      seed.materialExportSets = { [P.houdini]: ['KiraDefault'] }
    },
    drive: async (root) => {
      await clickByName(root, 'DTH Export')
      await waitFor(() => document.querySelector('[data-set="KiraDefault"]'))
    },
  },
  {
    id: 'houdini-utils-general',
    title: 'Houdini Utils: General',
    route,
    seed: { demo: true, activeProjectFile: P.dcsp },
    tune: (seed) => {
      withHoudini(seed.files)
      seed.materialScan = {
        [P.houdini]: [
          {
            path: '/obj/DazToHue/DazToHueMaterial',
            name: 'DazToHueMaterial',
            nodeType: 'material',
            networkBox: 'KiraDefault',
            materials: 2,
            uvChannels: 0,
            bakers: 0,
            layers: 0,
            bakerNames: [],
            materialNames: ['MI_Skin', 'Skin'],
            slots: [],
            sectionCounts: [],
          },
        ],
      }
      seed.materialJob = { [P.houdini]: `${P.charFolder}/houdini/houdini-project` }
    },
    drive: async (root) => {
      await clickByName(root, /^Utils/)
      await waitFor(() => document.body.textContent?.includes('Project folder ($JOB)'))
    },
  },
])
