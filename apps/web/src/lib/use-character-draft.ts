import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { generateCharacterFiles, saveCharacter } from '#/lib/rom/api.ts'
import { useUnsavedChangesGuard } from '#/lib/use-unsaved-guard.ts'
import { romValidationErrors } from '@dth/rom'

import type { Character, RomValidationError } from '@dth/rom'

/** What one save/generate round returns (files so the UI can name them). */
export type GenerateResult = Awaited<ReturnType<typeof generateCharacterFiles>>

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
 */
export function useCharacterDraft(options: {
  projectId: string
  /** The loader's character — the draft and baseline both seed from it. */
  initial: Character
  /** A save was blocked on invalid custom-morph fields — jump the UI to the
   *  first offending pose row (the hook has already toasted the message). */
  onValidationErrors: (errors: Array<RomValidationError>) => void
}) {
  const { projectId, initial, onValidationErrors } = options
  const router = useRouter()
  // The page owns a draft copy; "Save" persists it and revalidates the loader.
  const [character, setCharacter] = useState<Character>(initial)
  const [baseline, setBaseline] = useState<Character>(initial)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(character) !== JSON.stringify(baseline)
  const unsavedGuard = useUnsavedChangesGuard(
    dirty,
    'You have unsaved changes on this character — leave and lose them?',
  )

  function patch(p: Partial<Character>) {
    setCharacter((c) => ({ ...c, ...p }))
  }

  /** Reconcile draft + baseline on a persisted result — for the flows that save
   *  immediately instead of going through the Save button (rename, avatar,
   *  scene link), so the editor doesn't turn dirty over an already-saved value. */
  function settle(saved: Character) {
    setCharacter(saved)
    setBaseline(saved)
  }

  /** Sync just-persisted fields into the draft AND the baseline without
   *  discarding other unsaved edits — e.g. a folder move repointing the linked
   *  scene path while the user has pending form changes. */
  function syncPersisted(p: Partial<Character>) {
    setCharacter((c) => ({ ...c, ...p }))
    setBaseline((b) => ({ ...b, ...p }))
  }

  function discard() {
    setCharacter(baseline)
  }

  // The Generate panel was dissolved — generation feedback is a concise toast
  // (the install location lives in Settings); a script-install error still warns.
  function notifyGenerated(title: string, result: GenerateResult) {
    toast.success(title)
    if (result.scriptsError) {
      toast.warning(`Couldn't install the character script: ${result.scriptsError}`)
    }
  }

  // Saving also (re)generates all DTH files in the same step.
  async function save() {
    // Block the save on invalid required custom-morph fields (empty, or a pose
    // name with characters Houdini rejects) — and hand the errors to the page
    // so it can jump to the first one (open the section, scroll the row in,
    // focus the offending field).
    const errors = romValidationErrors(character.sections)
    if (errors.length > 0) {
      onValidationErrors(errors)
      toast.error(
        errors.length === 1
          ? errors[0].message
          : `${errors.length} custom-morph fields need fixing before saving.`,
      )
      return
    }
    setSaving(true)
    try {
      const saved = await saveCharacter({ data: { projectId, character } })
      const result = await generateCharacterFiles({ data: { projectId, id: saved.id } })
      // Settle everything in one batched render: reconcile the draft + baseline
      // (so it's no longer "dirty") and drop the saving flag together.
      setCharacter(saved)
      setBaseline(saved)
      setSaving(false)
      // Refresh the loader for re-entry/navigation, but don't await it — the
      // buttons no longer depend on it, so it stays off the visible path.
      void router.invalidate()
      notifyGenerated(`Saved “${saved.name}” — ${result.files.length} files`, result)
    } catch (e) {
      setSaving(false)
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  // Export settings only take effect once the script is regenerated (the export
  // block is emitted at generation time), so persist + regenerate immediately —
  // like the inline rename — instead of leaving them as dirty edits a manual
  // Save might miss. Otherwise the on-disk script silently lags the chosen folder.
  async function patchAndRegenerate(p: Partial<Character>, toastMsg?: string) {
    // Single-flight like save(): two quick toggles previously ran overlapping
    // save+generate rounds whose out-of-order completions could settle the
    // draft/baseline to the OLDER result and interleave script writes.
    if (saving) {
      toast.info('Still saving the previous change — try again in a moment.')
      return
    }
    const updated = { ...character, ...p }
    setCharacter(updated)
    setSaving(true)
    try {
      const saved = await saveCharacter({ data: { projectId, character: updated } })
      const result = await generateCharacterFiles({ data: { projectId, id: saved.id } })
      setCharacter(saved)
      setBaseline(saved)
      setSaving(false)
      void router.invalidate()
      notifyGenerated(toastMsg ?? `Saved “${saved.name}”`, result)
    } catch (e) {
      setSaving(false)
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

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
    patchAndRegenerate,
    notifyGenerated,
  }
}
