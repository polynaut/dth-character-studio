import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { generateCharacterFiles, saveCharacter } from '#/lib/rom/api.ts'
import { useUnsavedChangesGuard } from '#/lib/use-unsaved-guard.ts'
import {
  activeSceneOverrides,
  applySceneOverride,
  romValidationErrors,
  sceneOverrideSlug,
  templateBakedPoseNames,
} from '@dth/rom'

import type { Character, RomValidationError } from '@dth/rom'

/** What one save/generate round returns (files so the UI can name them). */
export type GenerateResult = Awaited<ReturnType<typeof generateCharacterFiles>>

/** Options for {@link PersistCharacterPatch}. */
export interface PersistPatchOptions {
  /** Success toast title (defaults to `Saved “<name>”`). */
  toast?: string
  /** Custom persist step for flows whose api call saves the character itself
   *  (e.g. `relinkScene`, which also derives the avatar). Receives the merged
   *  draft; must return the persisted character. Defaults to `saveCharacter`. */
  persist?: (updated: Character) => Promise<Character>
}

/**
 * THE primitive for every immediate-persist flow (scene link/unlink, Houdini
 * link, avatar, product store, export settings, …): refuses while a save is in
 * flight, runs the same save-blocking validation as the Save button, persists
 * the patched draft AND regenerates the DTH files, then settles without
 * clobbering interim edits. The patch may be an async producer — it runs only
 * AFTER the guards, so a flow with a side effect (copying a scene file into the
 * project) can't perform it and then be refused; returning `null` aborts.
 * Resolves to the persisted character, or `null` when refused or failed.
 */
export type PersistCharacterPatch = (
  patch: Partial<Character> | (() => Promise<Partial<Character> | null>),
  options?: PersistPatchOptions,
) => Promise<Character | null>

/**
 * The character editor's draft machinery: the page owns a DRAFT copy of the
 * character, `save()` persists it and (re)generates all DTH files in the same
 * step. Everything here settles state in single paints on purpose:
 *
 * - `dirty` compares against the last-persisted `baseline` — NOT the loader
 *   data — so saving can settle the buttons immediately instead of waiting on
 *   `router.invalidate()` to complete in a second, separate render.
 * - Leaving with unsaved edits asks first (`unsavedGuard`); programmatic
 *   navigations that must never ask (post-delete) call `unsavedGuard.bypass()`.
 * - Every returned function has a STABLE identity (latest-ref pattern), so
 *   memoized children (the ROM subtree) can take them as props without
 *   re-rendering whenever the page does.
 *
 * Immediate-persist flows (anything that saves without the Save button) go
 * through {@link PersistCharacterPatch persistPatch} — never a bare
 * `saveCharacter` + `settle`, which would skip validation, race an in-flight
 * save, and leave the generated artifacts stale behind a green "Saved".
 * The one exception is the inline rename, which needs `previousName` plumbed
 * into generation and re-throws for EditableTitle — it runs the same guards
 * by hand (validate + single-flight + settle + regenerate).
 */
export function useCharacterDraft(options: {
  projectId: string
  /** The loader's character — the draft and baseline both seed from it. */
  initial: Character
  /** A save was blocked on invalid custom-morph fields — jump the UI to the
   *  first offending pose row (the hook has already toasted the message). */
  onValidationErrors: (errors: Array<RomValidationError>) => void
}) {
  const { projectId, initial } = options
  const router = useRouter()
  // The page owns a draft copy; "Save" persists it and revalidates the loader.
  const [character, setCharacter] = useState<Character>(initial)
  const [baseline, setBaseline] = useState<Character>(initial)
  const [saving, setSaving] = useState(false)
  // Memoized: the two full-character serializations only re-run when the draft
  // or baseline actually change, not on every unrelated page render.
  const dirty = useMemo(
    () => JSON.stringify(character) !== JSON.stringify(baseline),
    [character, baseline],
  )
  const unsavedGuard = useUnsavedChangesGuard(
    dirty,
    'You have unsaved changes on this character — leave and lose them?',
  )

  // Latest-ref: the stable callbacks below always read the CURRENT values.
  const stateRef = useRef({ character, baseline, saving, projectId, onValidationErrors: options.onValidationErrors })
  stateRef.current = { character, baseline, saving, projectId, onValidationErrors: options.onValidationErrors }

  const patch = useCallback((p: Partial<Character>) => {
    setCharacter((c) => ({ ...c, ...p }))
  }, [])

  /** Reconcile draft + baseline on a persisted result — for the inline rename,
   *  which saves immediately outside the Save button, so the editor doesn't
   *  turn dirty over an already-saved value. */
  const settle = useCallback((saved: Character) => {
    setCharacter(saved)
    setBaseline(saved)
  }, [])

  /**
   * Settle a save WITHOUT clobbering edits the user typed while it was in flight.
   * `save`/`persistPatch` snapshot the draft, then run a multi-second
   * save+generate during which the form stays editable — replacing the draft with
   * the snapshot on completion silently reverted anything typed meanwhile. Instead:
   * update the baseline to the persisted value always, but only replace the draft
   * if it is still exactly the snapshot (no interim edits). If the user did edit,
   * their draft is kept and `dirty` correctly reports the new pending changes.
   */
  const settleAfterSave = useCallback((snapshot: Character, saved: Character) => {
    const frozen = JSON.stringify(snapshot)
    setCharacter((current) => (JSON.stringify(current) === frozen ? saved : current))
    setBaseline(saved)
  }, [])

  /** Sync just-persisted fields into the draft AND the baseline without
   *  discarding other unsaved edits — e.g. a folder move repointing the linked
   *  scene path while the user has pending form changes. */
  const syncPersisted = useCallback((p: Partial<Character>) => {
    setCharacter((c) => ({ ...c, ...p }))
    setBaseline((b) => ({ ...b, ...p }))
  }, [])

  const discard = useCallback(() => {
    setCharacter(stateRef.current.baseline)
  }, [])

  // The Generate panel was dissolved — generation feedback is a concise toast
  // (the install location lives in Settings); a script-install error still warns.
  const notifyGenerated = useCallback((title: string, result: GenerateResult) => {
    toast.success(title)
    if (result.scriptsError) {
      toast.warning(`Couldn't install the character script: ${result.scriptsError}`)
    }
  }, [])

  /**
   * Run every save-blocking check on the current draft and toast/jump on the
   * first failure. Returns true when the draft is safe to persist+generate. Shared
   * by `save` AND every immediate-persist flow (rename, avatar, scene/Houdini link,
   * product store — via `persistPatch`) so those can never persist an invalid
   * character or regenerate broken artifacts behind the user's back.
   * Pure-check + side-effecting toast.
   */
  const validate = useCallback((): boolean => {
    const { character: current, onValidationErrors } = stateRef.current
    // Invalid required custom-morph fields (empty, or a pose name with characters
    // Houdini rejects) — hand the errors to the page so it can jump to the first.
    // Template-baked pose names are reserved: a custom pose sharing one would
    // silently collide in Unreal (presets are override-invariant, so the same
    // reserved set applies to the scene-override checks below).
    const reserved = templateBakedPoseNames(current)
    const errors = romValidationErrors(current.sections, reserved)
    if (errors.length > 0) {
      onValidationErrors(errors)
      toast.error(
        errors.length === 1
          ? errors[0].message
          : `${errors.length} custom-morph fields need fixing before saving.`,
      )
      return false
    }
    // Each active scene override generates its own artifacts from the MERGED
    // sections — validate those too, so an overridden/added row can't ship a
    // broken scene script.
    for (const override of activeSceneOverrides(current)) {
      const sceneErrors = romValidationErrors(
        applySceneOverride(current.sections, override),
        reserved,
      )
      if (sceneErrors.length > 0) {
        const scene = sceneOverrideSlug(override.scenePath)
        onValidationErrors(sceneErrors)
        toast.error(
          sceneErrors.length === 1
            ? `Scene override “${scene}”: ${sceneErrors[0].message}`
            : `Scene override “${scene}”: ${sceneErrors.length} custom-morph fields need fixing before saving.`,
        )
        return false
      }
    }
    // Two linked scenes whose file names reduce to the same slug would generate
    // the same file names — refuse instead of silently overwriting one.
    const slugs = activeSceneOverrides(current).map((o) => sceneOverrideSlug(o.scenePath))
    const dupe = slugs.find((slug, i) => slugs.indexOf(slug) < i)
    if (dupe) {
      toast.error(
        `Two overridden scenes both generate as “${dupe}” — rename one scene file so the generated scripts don't clash.`,
      )
      return false
    }
    return true
  }, [])

  // Saving also (re)generates all DTH files in the same step.
  const save = useCallback(async () => {
    // Single-flight: the Save button is disabled while saving, but a keyboard
    // shortcut or a racing immediate-persist flow could still re-enter — guard so
    // two save+generate rounds can't interleave their script writes / settles.
    if (stateRef.current.saving) return
    if (!validate()) return
    setSaving(true)
    // Snapshot what we're persisting — the form stays editable during the
    // save+generate, so settle must not revert edits typed in the meantime.
    const snapshot = stateRef.current.character
    try {
      const saved = await saveCharacter({ data: { projectId, character: snapshot } })
      const result = await generateCharacterFiles({ data: { projectId, id: saved.id } })
      // Settle in one batched render: reconcile baseline (so it's no longer
      // "dirty") without clobbering any interim edits, and drop the saving flag.
      settleAfterSave(snapshot, saved)
      setSaving(false)
      // Refresh the loader for re-entry/navigation, but don't await it — the
      // buttons no longer depend on it, so it stays off the visible path.
      void router.invalidate()
      notifyGenerated(`Saved “${saved.name}” — ${result.files.length} files`, result)
    } catch (e) {
      setSaving(false)
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [projectId, router, validate, settleAfterSave, notifyGenerated])

  /**
   * See {@link PersistCharacterPatch}. Order of operations:
   * 1. single-flight guard (an in-flight save+generate must not interleave)
   * 2. `validate()` — the same checks that gate the Save button
   * 3. resolve the patch (an async producer runs only past the guards)
   * 4. apply it to the draft optimistically + persist + regenerate
   * 5. `settleAfterSave` — baseline := saved; interim edits are preserved
   * On failure the PATCHED fields roll back to their pre-patch values while
   * interim edits on other fields survive — the form then shows what's actually
   * persisted instead of keeping a change that never landed.
   */
  const persistPatch = useCallback<PersistCharacterPatch>(
    async (patchOrProduce, opts) => {
      if (stateRef.current.saving) {
        toast.info('Still saving the previous change — try again in a moment.')
        return null
      }
      if (!validate()) return null
      const before = stateRef.current.character
      // Set once the patch is applied to the draft — the catch rolls exactly
      // these fields back (an abort before application has nothing to undo).
      let appliedPatch: Partial<Character> | null = null
      setSaving(true)
      try {
        const p =
          typeof patchOrProduce === 'function' ? await patchOrProduce() : patchOrProduce
        if (p === null) {
          setSaving(false)
          return null
        }
        const updated = { ...before, ...p }
        setCharacter(updated)
        appliedPatch = p
        const saved = opts?.persist
          ? await opts.persist(updated)
          : await saveCharacter({ data: { projectId, character: updated } })
        const result = await generateCharacterFiles({ data: { projectId, id: saved.id } })
        // Preserve edits made during the in-flight save (see settleAfterSave).
        settleAfterSave(updated, saved)
        setSaving(false)
        void router.invalidate()
        notifyGenerated(opts?.toast ?? `Saved “${saved.name}”`, result)
        return saved
      } catch (e) {
        if (appliedPatch !== null) {
          // Roll back JUST the patched fields to their pre-patch values; interim
          // edits the user typed on OTHER fields during the flight are kept.
          const keys = Object.keys(appliedPatch) as Array<keyof Character>
          setCharacter((current) => {
            const rolledBack = { ...current }
            for (const key of keys) {
              Object.assign(rolledBack, { [key]: before[key] })
            }
            return rolledBack
          })
        }
        setSaving(false)
        toast.error(e instanceof Error ? e.message : String(e))
        return null
      }
    },
    [projectId, router, validate, settleAfterSave, notifyGenerated],
  )

  return {
    character,
    dirty,
    saving,
    unsavedGuard,
    patch,
    settle,
    syncPersisted,
    discard,
    save,
    validate,
    persistPatch,
    notifyGenerated,
  }
}

/** The full draft API (what {@link useCharacterDraft} returns). */
export type CharacterDraft = ReturnType<typeof useCharacterDraft>
