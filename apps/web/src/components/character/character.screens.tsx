import { defineScreens } from '../../../design-system/screens.ts'

// Literals mirror P.project / P.dcsp in smoke/fixtures.ts, which uses node:fs and can't load in the browser.
const PROJECT = 'D:/DTH Projects/Demo'

export default defineScreens('Character', [
  {
    id: 'character-editor',
    title: 'Character editor',
    route: `/projects/${encodeURIComponent(PROJECT)}/characters/char-kira`,
    seed: { demo: true, activeProjectFile: `${PROJECT}/Demo.dcsp` },
  },
])
