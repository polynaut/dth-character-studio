import { defineScreens } from '../../../design-system/screens.ts'

import { P } from '../../../smoke/fixture-paths.ts'

export default defineScreens('Character', [
  {
    id: 'character-editor',
    title: 'Character editor',
    route: `/projects/${encodeURIComponent(P.project)}/characters/${P.characterId}`,
    seed: { demo: true, activeProjectFile: P.dcsp },
  },
])
