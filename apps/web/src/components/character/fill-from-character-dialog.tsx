import { useEffect, useMemo, useState } from 'react'

import { PaintBucket } from 'lucide-react'

import { Button, cn, Modal } from '@dth/ui'
import { fetchAllCharacters } from '#/lib/rom/api.ts'
import { fillSectionsFrom, filledSections, sectionContentSummary } from '#/lib/fill-sections.ts'
import { SECTION_LABELS } from '@dth/rom'

import type { CharacterWithProject } from '#/lib/rom/api.ts'
import type { Character, RomSection } from '@dth/rom'

/**
 * The timeline panel's "Fill" wizard: step 1 picks a source character from
 * every known project (the recents list — same candidate pool as the create
 * dialog's ROM prefill, filtered to the target's generation + gender), step 2
 * picks which of the source's filled ROM sections to copy. Confirming REPLACES
 * the picked sections of the target's draft with the source's config
 * (`fillSectionsFrom` — GEN keeps the target's scene-derived geograft
 * plumbing); the change lands in the editor draft, so Save still decides.
 */
export function FillFromCharacterDialog({
  character,
  onFill,
  onClose,
}: {
  /** The target (the editor's draft) — filters candidates and receives the fill. */
  character: Character
  onFill: (sections: Character['sections']) => void
  onClose: () => void
}) {
  // null = the cross-project walk is still loading (it visits every recent
  // project's library — never pre-fetched, only paid when the wizard opens).
  const [all, setAll] = useState<Array<CharacterWithProject> | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [step, setStep] = useState<'pick' | 'sections'>('pick')
  const [checked, setChecked] = useState<ReadonlySet<RomSection>>(new Set())

  useEffect(() => {
    let active = true
    fetchAllCharacters()
      .then((list) => active && setAll(list))
      .catch(() => active && setAll([]))
    return () => {
      active = false
    }
  }, [])

  // Same compatibility filter as the create dialog's ROM prefill: definitions
  // don't transfer across generations (morph names, preset assets and frame
  // math are per-generation) or genders (the GP/DK GEN blocks).
  const candidates = useMemo(
    () =>
      (all ?? [])
        .filter(
          (c) =>
            c.id !== character.id && c.genesis === character.genesis && c.gender === character.gender,
        )
        .sort(
          (a, b) =>
            a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name),
        ),
    [all, character.id, character.genesis, character.gender],
  )
  const source = candidates.find((c) => c.id === sourceId)
  const offered = source ? filledSections(source.sections) : []

  function next() {
    if (!source) return
    // Every filled section starts checked — the user deselects what to keep.
    setChecked(new Set(filledSections(source.sections)))
    setStep('sections')
  }

  function toggle(section: RomSection, on: boolean) {
    const set = new Set(checked)
    if (on) set.add(section)
    else set.delete(section)
    setChecked(set)
  }

  function fill() {
    if (!source || checked.size === 0) return
    onFill(
      fillSectionsFrom(
        character.sections,
        source.sections,
        offered.filter((section) => checked.has(section)),
      ),
    )
    onClose()
  }

  // Step-1 rows grouped by project (candidates are already project-sorted).
  const groups: Array<{ projectId: string; projectName: string; chars: Array<CharacterWithProject> }> =
    []
  for (const c of candidates) {
    const last = groups[groups.length - 1]
    if (last && last.projectId === c.projectId) last.chars.push(c)
    else groups.push({ projectId: c.projectId, projectName: c.projectName, chars: [c] })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={step === 'pick' ? 'Fill ROM from character' : `Fill from “${source?.name ?? ''}”`}
      // A flex column whose LIST is the only scroller (overflow-hidden replaces
      // the shell's own overflow-y-auto via tailwind-merge), so the title, intro
      // and footer buttons stay pinned while a big character list scrolls. With
      // many candidates the dialog also widens.
      className={cn('flex flex-col overflow-hidden', candidates.length > 8 && 'max-w-3xl')}
    >
      {step === 'pick' ? (
        <>
          <p className="text-sm text-muted-foreground">
            Copy ROM sections from an existing character in any of your projects. Only{' '}
            <strong>
              {character.genesis} {character.gender}
            </strong>{' '}
            characters are listed — ROM definitions don’t transfer across generations or genders.
          </p>
          {all === null && <p className="text-sm text-muted-foreground">Loading characters…</p>}
          {all !== null && candidates.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No other {character.genesis} {character.gender} characters found in your projects.
            </p>
          )}
          {candidates.length > 0 && (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {groups.map((group) => (
                <div key={group.projectId}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {group.projectName}
                  </p>
                  <ul className="space-y-1">
                    {group.chars.map((c) => {
                      const empty = filledSections(c.sections).length === 0
                      return (
                        <li key={c.id}>
                          <label
                            className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm ${
                              empty
                                ? 'cursor-default opacity-50'
                                : 'cursor-pointer hover:bg-accent hover:text-accent-foreground'
                            }`}
                          >
                            <input
                              type="radio"
                              name="fill-source"
                              className="accent-primary"
                              disabled={empty}
                              checked={sourceId === c.id}
                              onChange={() => setSourceId(c.id)}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                            {empty && (
                              <span className="shrink-0 text-xs text-muted-foreground">
                                empty ROM
                              </span>
                            )}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="mr-auto" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!source} onClick={next}>
              Next
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            The checked sections <strong>replace</strong> this character’s current config with{' '}
            “{source?.name}”’s. Unchecked sections stay untouched — and nothing is saved until you
            save the character.
          </p>
          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {offered.map((section) => (
              <li key={section}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked.has(section)}
                    onChange={(e) => toggle(section, e.target.checked)}
                  />
                  <span className="font-medium">{SECTION_LABELS[section]}</span>
                  <span className="text-xs text-muted-foreground">{section}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {source ? sectionContentSummary(source.sections[section]) : ''}
                  </span>
                </label>
                {section === 'GEN' && (
                  <p className="mt-0.5 px-3 text-xs text-muted-foreground">
                    Copies the art direction / custom frames only — the Golden Palace / Dicktator
                    setup stays this character’s own (it follows the primary scene’s geograft).
                  </p>
                )}
              </li>
            ))}
          </ul>
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep('pick')}>
              Back
            </Button>
            <Button disabled={checked.size === 0} onClick={fill}>
              <PaintBucket /> Fill from character
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
