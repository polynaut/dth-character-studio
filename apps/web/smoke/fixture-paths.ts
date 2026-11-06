// Node-free fixture paths, shared with the design-system screens (which run in the browser).

/** DTH release version the fixture ships — settings, provenance and the release
 *  folder name below must all agree on it (era-matching keeps staleness quiet). */
export const DTH_VERSION = '2.4.3'

export const P = {
  appData: 'C:/Users/You/AppData/Local/com.polynaut.dthcharacterstudio',
  dazLib: 'D:/DAZ 3D/My DAZ 3D Library',
  release: `X:/DazToHue/Releases/DazToHue-${DTH_VERSION}`,
  posesRoot: `X:/DazToHue/Releases/DazToHue-${DTH_VERSION}/Daz Studio Content/DazToHue/Poses`,
  project: 'D:/DTH Projects/Demo',
  dcsp: 'D:/DTH Projects/Demo/Demo.dcsp',
  characterId: 'char-kira',
  charFolder: 'D:/DTH Projects/Demo/Kira',
  /** The character's app-internal folder in the project's `.dcsmeta`: the
   *  generated PoseAsset CSV, the run log, the Execute stamps, the
   *  export-folder record. Nothing the user ever opens. */
  charMeta: 'D:/DTH Projects/Demo/.dcsmeta/characters/Kira',
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
  /** The demo character's Houdini folder — where its `.hiplc` files live,
   *  beside the shared `houdini-project` folder. */
  houdiniDir: 'D:/DTH Projects/Demo/Kira/houdini',
  /** The demo character's export directory: FIXED at `<char>/<houdini>/daz-export`
   *  since schema v29, and moved into the Houdini folder by the export-root move
   *  — derived, never picked (the panel is read-only). */
  exportDir: 'D:/DTH Projects/Demo/Kira/houdini/daz-export',
}
