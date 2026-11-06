import { defineScreens } from '../../../design-system/screens.ts'

import { P } from '../../../smoke/fixture-paths.ts'

export default defineScreens('Tools', [
  {
    id: 'tools-scan',
    title: 'Tools: Scan & index',
    route: '/tools',
    seed: {
      demo: true,
      activeProjectFile: P.dcsp,
      extraScene: true,
      dazProductsEnabled: true,
      dimManifestsFolder: 'E:/DAZ 3D/Install Manager/ManifestFiles',
      dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio4 64-bit',
    },
  },
])
