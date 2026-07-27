import { useEffect, useMemo, useState } from 'react'

import { PaintBucket } from 'lucide-react'

import { Button, cn, Modal } from '@dth/ui'
import { fetchAllCharacters } from '#/lib/rom/api.ts'
import { fillSectionsFrom, filledSections, sectionContentSummary } from '#/lib/fill-sections.ts'
import { SECTION_LABELS } from '@dth/rom'

import type { CharacterWithProject } from '#/lib/rom/api.ts'
import type { Character, Gender, GenesisVersion, RomSection, RomSections } from '@dth/rom'

/** What the wizard fills: the compatibility identity that filters candidates,
 *  and the current sections the picked ones replace. The ROM editor passes its
 *  draft character; the create panel passes the picked genesis/gender over the
 *  default sections, with an empty `id` (no character exists to exclude yet). */
export interface FillTarget {
  id: string
  genesis: GenesisVersion
  gender: Gender
  sections: RomSections
}

/** The non-section extras the wizard can also copy — the ROM tuning that lives
 *  beside `sections` on the character and is PORTABLE (unlike groom scenes and
 *  scene overrides, which are keyed by the source's own scene paths and would
 *  sit inert on the target). Each is a wholesale replacement when checked. */
const EXTRA_LABELS = {
  jcmRules: 'Modify JCM frames',
  preserveMorphs: 'Preserve morphs',
  preserveNodeTransforms: 'Preserve node transforms',
} as const
export type FillExtra = keyof typeof EXTRA_LABELS

/** Which extras the source has anything to offer for. The two preserve lists
 *  are offered separately, mirroring the Advanced-options editor. (The G9
 *  strength dials are deliberately NOT an extra — two visible values the user
 *  copies by hand when wanted.) */
function offeredExtras(source: Character): Array<FillExtra> {
  const out: Array<FillExtra> = []
  if (source.jcmMorphMods.length > 0) out.push('jcmRules')
  if (source.preserveMorphs.length > 0) out.push('preserveMorphs')
  if (source.preserveNodeTransforms.length > 0) out.push('preserveNodeTransforms')
  return out
}

function extraSummary(extra: FillExtra, source: Character): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (extra === 'jcmRules') return plural(source.jcmMorphMods.length, 'rule')
  if (extra === 'preserveMorphs') return plural(source.preserveMorphs.length, 'morph')
  return plural(source.preserveNodeTransforms.length, 'node transform')
}

/**
 * The ROM "Fill" wizard: step 1 picks a source character from every known
 * project (the recents list, filtered to the target's generation + gender),
 * step 2 picks which of the source's filled ROM sections to copy — plus the
 * "Also copy" extras ({@link EXTRA_LABELS}). Confirming REPLACES the picked
 * sections of the target with the source's config (`fillSectionsFrom` — GEN
 * keeps the target's scene-derived geograft plumbing), adds the checked
 * extras to the patch wholesale, and reports what was picked so the create
 * panel can stage the same fill for `createCharacter`. Nothing is persisted
 * here — the caller decides (editor draft Save / the create action).
 */
export function FillFromCharacterDialog({
  target,
  onFill,
  onClose,
}: {
  target: FillTarget
  onFill: (
    patch: Partial<Character> & { sections: RomSections },
    source: {
      id: string
      name: string
      picked: Array<RomSection>
      extras: Record<FillExtra, boolean>
    },
  ) => void
  onClose: () => void
}) {
  // null = the cross-project walk is still loading (it visits every recent
  // project's library — never pre-fetched, only paid when the wizard opens).
  const [all, setAll] = useState<Array<CharacterWithProject> | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [step, setStep] = useState<'pick' | 'sections'>('pick')
  const [checked, setChecked] = useState<ReadonlySet<RomSection>>(new Set())
  const [extras, setExtras] = useState<ReadonlySet<FillExtra>>(new Set())

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
          (c) => c.id !== target.id && c.genesis === target.genesis && c.gender === target.gender,
        )
        .sort(
          (a, b) =>
            a.projectName.localeCompare(b.projectName) || a.name.localeCompare(b.name),
        ),
    [all, target.id, target.genesis, target.gender],
  )
  const source = candidates.find((c) => c.id === sourceId)
  const offered = source ? filledSections(source.sections) : []
  const extrasAvailable = source ? offeredExtras(source) : []

  function next() {
    if (!source) return
    // Every offered section starts checked — the user deselects what to keep.
    // RET is never in the set: it has no checkbox of its own (it rides with
    // JCM, exactly like the editor's tied enable toggle). The two preserve
    // lists start UNCHECKED: they're the most target-specific tuning (which
    // morphs/nodes to hold depends on this character's own setup), so copying
    // them is a deliberate opt-in.
    setChecked(new Set(filledSections(source.sections).filter((section) => section !== 'RET')))
    setExtras(
      new Set(
        offeredExtras(source).filter(
          (extra) => extra !== 'preserveMorphs' && extra !== 'preserveNodeTransforms',
        ),
      ),
    )
    setStep('sections')
  }

  function toggle(section: RomSection, on: boolean) {
    if (section === 'RET') return // rides with JCM (backstop — the checkbox is disabled)
    const set = new Set(checked)
    if (on) set.add(section)
    else set.delete(section)
    setChecked(set)
  }

  function toggleExtra(extra: FillExtra, on: boolean) {
    const set = new Set(extras)
    if (on) set.add(extra)
    else set.delete(extra)
    setExtras(set)
  }

  function fill() {
    if (!source || (checked.size === 0 && extras.size === 0)) return
    // RET copies exactly when JCM does — the same derivation the editor and
    // generation apply (the retargeting poses are part of the JCM base ROM).
    const picked = offered.filter((section) =>
      section === 'RET' ? checked.has('JCM') : checked.has(section),
    )
    const patch: Partial<Character> & { sections: RomSections } = {
      sections: fillSectionsFrom(target.sections, source.sections, picked),
    }
    if (extras.has('jcmRules')) patch.jcmMorphMods = structuredClone(source.jcmMorphMods)
    if (extras.has('preserveMorphs')) patch.preserveMorphs = structuredClone(source.preserveMorphs)
    if (extras.has('preserveNodeTransforms'))
      patch.preserveNodeTransforms = structuredClone(source.preserveNodeTransforms)
    onFill(patch, {
      id: source.id,
      name: source.name,
      picked,
      extras: {
        jcmRules: extras.has('jcmRules'),
        preserveMorphs: extras.has('preserveMorphs'),
        preserveNodeTransforms: extras.has('preserveNodeTransforms'),
      },
    })
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
              {target.genesis} {target.gender}
            </strong>{' '}
            characters are listed — ROM definitions don’t transfer across generations or genders.
          </p>
          {all === null && <p className="text-sm text-muted-foreground">Loading characters…</p>}
          {all !== null && candidates.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              No other {target.genesis} {target.gender} characters found in your projects.
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
            {offered.map((section) => {
              // RET mirrors the editor's tied enable toggle: its checkbox
              // follows the JCM one and is never operable on its own.
              const tiedToJcm = section === 'RET'
              return (
                <li key={section}>
                  <label
                    className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm ${
                      tiedToJcm
                        ? 'cursor-default'
                        : 'cursor-pointer hover:bg-accent hover:text-accent-foreground'
                    }`}
                    title={
                      tiedToJcm
                        ? 'The retargeting poses are part of the JCM base ROM — copied together with the JCM section'
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      disabled={tiedToJcm}
                      checked={tiedToJcm ? checked.has('JCM') : checked.has(section)}
                      onChange={(e) => toggle(section, e.target.checked)}
                    />
                    <span className="font-medium">{SECTION_LABELS[section]}</span>
                    <span className="text-xs text-muted-foreground">{section}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {tiedToJcm
                        ? 'with JCM'
                        : source
                          ? sectionContentSummary(source.sections[section])
                          : ''}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {extrasAvailable.length > 0 && source && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Also copy</p>
              <ul className="space-y-1">
                {extrasAvailable.map((extra) => (
                  <li key={extra}>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={extras.has(extra)}
                        onChange={(e) => toggleExtra(extra, e.target.checked)}
                      />
                      <span className="font-medium">{EXTRA_LABELS[extra]}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {extraSummary(extra, source)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <Button variant="outline" onClick={() => setStep('pick')}>
              Back
            </Button>
            <Button disabled={checked.size === 0 && extras.size === 0} onClick={fill}>
              <PaintBucket /> Fill from character
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
