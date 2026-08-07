/**
 * A one-shot "open the Add-scene dialog for THIS file" intent, handed from the
 * new-scene prompt to the character page it navigates to.
 *
 * Why a module store and not a search param: this is a transient UI intent, not
 * a location. Put it in the URL and it survives a reload, a Back, and a shared
 * link — each of which would re-open a dialog for a file the user has since
 * dealt with. Same reasoning (and the same shape) as `nav-origin.ts`.
 *
 * It is cleared on DELIVERY, not on read — `peek` then `clear` — and that split
 * is load-bearing rather than fussy. React StrictMode runs every effect twice
 * (mount, unmount, remount): a read that consumed would hand the request to the
 * first run, whose cleanup then cancels the delivery, and the second run would
 * find nothing. The dialog simply never opened. So the request survives until
 * something actually opens the dialog with it.
 */

interface SceneAddRequest {
  characterId: string
  scenePath: string
}

let pending: SceneAddRequest | null = null

export function requestSceneAdd(characterId: string, scenePath: string): void {
  pending = { characterId, scenePath }
}

/** The pending request for this character, left in place. Null when there is
 *  none, or when it was meant for a different character. */
export function peekSceneAddRequest(characterId: string): string | null {
  if (!pending || pending.characterId !== characterId) return null
  return pending.scenePath
}

/** Drop the pending request — called once the dialog has actually opened. */
export function clearSceneAddRequest(): void {
  pending = null
}
