/**
 * Pairing a Houdini INSTALLATION folder with its user DOCUMENTS folder — the
 * one rule "Generate project" and the Settings warning share. Houdini's prefs
 * are per major.minor: the install `…/Houdini 22.0.368` reads
 * `…/Documents/houdini22.0` — so every configured install must have a
 * matching docs folder, or hython (pointed at the docs folder as
 * HOUDINI_USER_PREF_DIR) loads the WRONG version's otls/packages — or none.
 */

/** `…/Houdini 22.0.368` → `22.0` (major.minor); '' when unparseable. */
export function houdiniVersionFromInstall(installFolder: string): string {
  const base = installFolder.trim().replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
  const match = /(\d+)\.(\d+)/.exec(base)
  return match ? `${match[1]}.${match[2]}` : ''
}

/** `…/Documents/houdini22.0` → `22.0`; '' when the basename isn't houdiniX.Y. */
export function houdiniVersionFromDocs(docsFolder: string): string {
  const base = docsFolder.trim().replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
  const match = /^houdini(\d+)\.(\d+)$/i.exec(base)
  return match ? `${match[1]}.${match[2]}` : ''
}

/**
 * The configured docs folder matching the install's major.minor — null when
 * none does (the caller warns / refuses). An unparseable install version
 * also returns null: without a version there is nothing safe to pair.
 */
export function matchingHoudiniDocsFolder(
  installFolder: string,
  docsFolders: Array<string>,
): string | null {
  const version = houdiniVersionFromInstall(installFolder)
  if (!version) return null
  return (
    docsFolders.find((docs) => docs.trim() !== '' && houdiniVersionFromDocs(docs) === version) ??
    null
  )
}
