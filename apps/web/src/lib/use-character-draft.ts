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
  /** The character's name BEFORE this patch — plumbed into generation so the
   *  artifacts named after the old name are cleaned up (the inline rename). */
  previousName?: string
  /** Rethrow a FAILED persist step instead of toasting it (the rollback still
   *  happens) — for callers that own the error surface, like the inline
   *  rename's EditableTitle, which resets its text and toasts on a rejection.
   *  Guard refusals (validation / a save in flight) still toast here and
   *  resolve `null`; a generate failure after a successful persist still only
   *  warns here — the change DID land. */
  rethrow?: boolean
}

/**
 * THE primitive for every immediate-persist flow (scene link/unlink, Houdini
 * link, avatar, product store, export settings, …): refuses while a save is in
 * flight, runs the same save-blocking validation as the Save button, persists
 * the patched draft AND regenerates the DTH files, then settles without
 * clobbering interim edits. The patch may be an async producer — it runs only
 * AFTER the guards, so a flow with a side effect (copying a scene file into the
 * project) can't perform it and then be refused; returning `null` aborts. Once
 * the producer HAS run, its side effects are real (a moved `.duf`, an uploaded
 * avatar) — so if interim edits typed during it make the merged result invalid,
 * the producer's patch alone is persisted against the pre-producer draft (the
 * interim edits stay as dirty edits on top); only a patch that is invalid BY
 * ITSELF refuses outright.
 * Resolves to the persisted character, or `null` when refused or the persist
 * failed. A generate failure AFTER a successful persist still resolves to the
 * persisted character (it warns; the change is on disk).
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
 * `saveCharacter` + hand-settled baseline, which would skip validation, race an
 * in-flight save, and leave the generated artifacts stale behind a green "Saved".
 * Even the inline rename routes through it (its `previousName` cleanup and
 * EditableTitle's reset-on-rejection ride the `previousName` / `rethrow`
 * options), so the single-flight flag is held for every persisting flow.
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
   * Run every save-blocking check on the current draft — or on an explicit
   * `candidate` (persistPatch re-checks the MERGED patch+interim result, which
   * React state hasn't re-rendered into the ref yet) — and toast/jump on the
   * first failure. Returns true when the draft is safe to persist+generate. Shared
   * by `save` AND every immediate-persist flow (rename, avatar, scene/Houdini link,
   * product store — via `persistPatch`) so those can never persist an invalid
   * character or regenerate broken artifacts behind the user's back.
   * Pure-check + side-effecting toast.
   */
  const validate = useCallback((candidate?: Character): boolean => {
    const { onValidationErrors } = stateRef.current
    const current = candidate ?? stateRef.current.character
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
    // Set once saveCharacter succeeded: from then on the definition IS on disk,
    // so a later failure (generation) must not read as "the save failed".
    let persisted: Character | null = null
    try {
      const saved = await saveCharacter({ data: { projectId, character: snapshot } })
      // The persist landed — settle the baseline BEFORE generating (reconciled
      // without clobbering interim edits), so a generate failure can't leave
      // the editor claiming unsaved changes for a definition already on disk.
      persisted = saved
      settleAfterSave(snapshot, saved)
      const result = await generateCharacterFiles({ data: { projectId, id: saved.id } })
      setSaving(false)
      // Refresh the loader for re-entry/navigation, but don't await it — the
      // buttons no longer depend on it, so it stays off the visible path.
      void router.invalidate()
      notifyGenerated(`Saved “${saved.name}” — ${result.files.length} files`, result)
    } catch (e) {
      setSaving(false)
      const message = e instanceof Error ? e.message : String(e)
      if (persisted) {
        // Only generation failed; the save itself is on disk — same warning
        // family as `scriptsError`, and the loader still refreshes.
        void router.invalidate()
        toast.warning(
          `Saved “${persisted.name}”, but couldn't regenerate the DTH files: ${message}`,
        )
      } else {
        toast.error(message)
      }
    }
  }, [projectId, router, validate, settleAfterSave, notifyGenerated])

  /**
   * See {@link PersistCharacterPatch}. Order of operations:
   * 1. single-flight guard (an in-flight save+generate must not interleave)
   * 2. `validate()` — the same checks that gate the Save button
   * 3. resolve the patch (an async producer runs only past the guards), THEN
   *    snapshot the draft — a producer can take seconds (it may copy scene
   *    files) while the form stays editable, so a pre-producer snapshot would
   *    silently discard everything typed during it — and re-run `validate` on
   *    the MERGED result (patch + interim edits): step 2 only saw the
   *    pre-producer draft, and what actually persists is this merge. When the
   *    merge fails but the patch applied to the PRE-producer snapshot alone is
   *    valid, THAT is persisted instead — the producer's side effects (a moved
   *    scene file, an uploaded avatar) already happened, so refusing here would
   *    strand them; the offending interim edits stay as dirty draft edits.
   *    Only a patch invalid by itself still refuses (nothing persisted)
   * 4. apply it to the draft optimistically + persist
   * 5. `settleAfterSave` — baseline := saved; interim edits are preserved —
   *    BEFORE regenerating, so a generate failure can't leave the editor
   *    claiming unsaved changes for a definition already on disk
   * 6. regenerate the DTH files; a failure here only warns (no rollback)
   * On a PERSIST failure the PATCHED fields roll back to their pre-patch values
   * while interim edits on other fields survive — the form then shows what's
   * actually persisted instead of keeping a change that never landed.
   */
  const persistPatch = useCallback<PersistCharacterPatch>(
    async (patchOrProduce, opts) => {
      if (stateRef.current.saving) {
        toast.info('Still saving the previous change — try again in a moment.')
        return null
      }
      if (!validate()) return null
      // The draft as the up-front guards saw it — step 3's fallback persists
      // the producer's patch against THIS snapshot when interim edits typed
      // during the producer invalidate the merged result.
      const preProducer = stateRef.current.character
      // Re-snapshotted AFTER the producer resolves (step 3) — it keys the
      // patch application and the rollback.
      let before = preProducer
      // Set once the patch is applied to the draft — the catch rolls exactly
      // these fields back (an abort before application has nothing to undo).
      let appliedPatch: Partial<Character> | null = null
      // Set once the persist step succeeded — from then on a failure is a
      // generation problem on top of a LANDED save: warn, never roll back.
      let persisted: Character | null = null
      setSaving(true)
      try {
        const p =
          typeof patchOrProduce === 'function' ? await patchOrProduce() : patchOrProduce
        if (p === null) {
          setSaving(false)
          return null
        }
        // Re-snapshot now: edits typed while the producer ran belong to `before`
        // (they must survive the patch application AND key the rollback).
        before = stateRef.current.character
        const merged = { ...before, ...p }
        // Re-validate the MERGED result: the step-2 check saw the PRE-producer
        // draft, but interim edits typed during a slow producer (or the patch
        // itself) can make what would actually persist invalid.
        let toPersist = merged
        if (!validate(merged)) {
          // The producer already ran — its side effects are on disk (applyAdd
          // MOVES the user's .duf; the avatar dialog uploads + deletes the old
          // image), so a flat refusal would strand them unlinked. If the patch
          // applied to the PRE-producer snapshot is valid on its own, persist
          // that: the offending interim edits stay as dirty draft edits on top
          // (validate already toasted + jumped to them). Refuse outright only
          // when the patch ITSELF is invalid.
          const patchOnly = { ...preProducer, ...p }
          if (!validate(patchOnly)) {
            setSaving(false)
            return null
          }
          toPersist = patchOnly
        }
        setCharacter(merged)
        appliedPatch = p
        const saved = opts?.persist
          ? await opts.persist(toPersist)
          : await saveCharacter({ data: { projectId, character: toPersist } })
        // The persist landed — settle BEFORE generating, preserving edits made
        // during the in-flight save (see settleAfterSave). In the patch-only
        // fallback the draft (the merge) differs from `toPersist`, so the
        // interim edits survive as dirty edits over the new baseline.
        persisted = saved
        settleAfterSave(toPersist, saved)
        const result = await generateCharacterFiles({
          data: {
            projectId,
            id: saved.id,
            ...(opts?.previousName !== undefined ? { previousName: opts.previousName } : {}),
          },
        })
        setSaving(false)
        void router.invalidate()
        notifyGenerated(opts?.toast ?? `Saved “${saved.name}”`, result)
        return saved
      } catch (e) {
        setSaving(false)
        const message = e instanceof Error ? e.message : String(e)
        if (persisted) {
          // Only generation failed; the patch itself is on disk — same warning
          // family as `scriptsError`, and the loader still refreshes.
          void router.invalidate()
          toast.warning(
            `Saved “${persisted.name}”, but couldn't regenerate the DTH files: ${message}`,
          )
          return persisted
        }
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
        if (opts?.rethrow) throw e
        toast.error(message)
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
