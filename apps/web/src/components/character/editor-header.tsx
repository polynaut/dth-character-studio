import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, CircleX, Pencil, Save, Undo2 } from 'lucide-react'

import { Avatar } from '#/components/avatar.tsx'
import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { ImageDialog } from '#/components/image-dialog.tsx'
import { Button, EditableTitle, Tag, useModifierHeld } from '@dth/ui'
import { useConfirm } from '#/lib/use-confirm.tsx'
import { characterSkinning, countPoses } from '@dth/rom'

import type { RootedDir } from '#/lib/character-paths.ts'
import type { CharacterDraft } from '#/lib/use-character-draft.ts'

/**
 * Scroll the page to the top with a rAF-driven ease-out — NOT
 * `behavior: 'smooth'`, which Windows' reduced-motion setting silently turns
 * into an instant jump; this glide is part of the interaction (the scene tag
 * "travels" to the scene cards it stands for), so it always animates. A wheel
 * or touch during the glide cancels it — the user's scroll wins.
 */
function smoothScrollToTop() {
  const start = window.scrollY
  if (start === 0) return
  const duration = 400
  const t0 = performance.now()
  let cancelled = false
  const cancel = () => {
    cancelled = true
  }
  window.addEventListener('wheel', cancel, { once: true, passive: true })
  window.addEventListener('touchstart', cancel, { once: true, passive: true })
  const step = (now: number) => {
    if (cancelled) return
    const t = Math.min(1, (now - t0) / duration)
    window.scrollTo(0, Math.round(start * Math.pow(1 - t, 3)))
    if (t < 1) requestAnimationFrame(step)
    else {
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchstart', cancel)
    }
  }
  requestAnimationFrame(step)
}

/**
 * Discard + Save, in their own component ON PURPOSE: `useModifierHeld` flips
 * state on every Ctrl press/release, and as long as its consumer sat at the
 * page top level each flip re-rendered the whole editor (every open pose
 * table). Here the flip re-renders just these two buttons.
 */
function HeaderActions({ draft }: { draft: CharacterDraft }) {
  const { dirty, saving } = draft
  const confirm = useConfirm()
  // Power-user: holding Ctrl force-enables Save so the JSON can be re-written to
  // disk even when nothing changed (handy during development).
  const ctrlHeld = useModifierHeld('Control')

  // Discard throws away every unsaved edit and can't be undone — unlike leaving
  // the page, which already asks. Confirm before wiping non-trivial changes.
  async function onDiscard() {
    if (
      dirty &&
      !(await confirm('Discard all unsaved changes to this character?', {
        title: 'Discard changes',
        confirmLabel: 'Discard',
      }))
    ) {
      return
    }
    draft.discard()
  }

  return (
    <>
      <Button variant="outline" onClick={() => void onDiscard()} disabled={saving || !dirty}>
        <Undo2 /> Discard
      </Button>
      <Button
        onClick={() => void draft.save()}
        disabled={saving || (!dirty && !ctrlHeld)}
        title={ctrlHeld && !dirty ? 'Force re-save the JSON to disk (Ctrl)' : undefined}
      >
        <Save /> {saving ? 'Saving…' : dirty ? 'Save' : ctrlHeld ? 'Re-save' : 'Saved'}
      </Button>
    </>
  )
}

/**
 * The character editor's sticky header (plus the plain Back link above it):
 * avatar (click → image dialog), inline-renameable title, the selected-scene
 * tag, subtitle, folder chip, and the Discard/Save actions. Owns the flows
 * that belong to these controls — the inline rename (persist + regenerate at
 * the new name, with `previousName` cleanup) and the avatar apply.
 */
export function EditorHeader({
  projectId,
  draft,
  folderChip,
  hasRunProblems,
  sceneTag,
  sceneAvatarPath,
}: {
  projectId: string
  draft: CharacterDraft
  /** The character's folder chip (dim library root, bright remainder), or null
   *  while the location is unresolved. */
  folderChip: RootedDir | null
  /** Show the "errors in the last ROM run" scroll-up button. */
  hasRunProblems: boolean
  /** The selected scene's tag next to the title (null hides it — single scene
   *  or while renaming). */
  sceneTag: string | null
  /** With a non-primary scene selected, the portrait previews that scene's
   *  `.tip.png` instead of the stored avatar (null → stored avatar). */
  sceneAvatarPath: string | null
}) {
  const { character } = draft
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const swallowNavRef = useRef(false)

  // Inline rename from the title — persists immediately (like the avatar) so the
  // new name + folder rename stick without needing the Save button. Routed
  // through persistPatch so it runs the SAME guards as every persisting flow —
  // validation, and the single-flight flag held for the whole save+generate (the
  // old hand-rolled version checked `saving` but never SET it, letting a racing
  // Save interleave a second save+generate round mid-rename). `previousName`
  // rides into generation (renaming moves the character folder + renames the
  // generated script, so the old-named script in the shared folder is dropped);
  // `rethrow` hands a persist failure to EditableTitle, which resets its own
  // text and toasts. A refusal (validation / a save in flight) has already
  // toasted inside persistPatch — returning normally just closes the editor.
  async function onRenameCharacter(next: string) {
    await draft.persistPatch(
      { name: next },
      { toast: `Renamed to “${next}”`, previousName: character.name, rethrow: true },
    )
  }

  return (
    <>
      <div className="mb-1">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          onMouseDown={() => {
            swallowNavRef.current = editingTitle
          }}
          onClick={(e) => {
            if (swallowNavRef.current) {
              e.preventDefault()
              swallowNavRef.current = false
            }
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground! no-underline hover:text-foreground!"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
      </div>

      {/* Liquid-glass sticky header: content scrolling beneath frosts through a
          translucent background + heavy backdrop blur (echoing the native macOS
          title bar above). Opaque background is the fallback where
          backdrop-filter isn't supported (else content would bleed through
          sharp). */}
      <header className="sticky top-0 z-10 mb-8 flex items-end gap-5 bg-background backdrop-blur-xl supports-[backdrop-filter]:bg-background/65">
        {/* Back stays reachable while scrolled: the page's own Back link lives
            above this sticky header, so a second one fades in here (same
            scroll-timeline as the header collapse) once that one is gone. */}
        {/* top-5 matches the avatar's mt-5, so the link tops align; left aligns
            with the title beside the avatar (156px box + gap-5). */}
        <div className="absolute top-5 left-[176px] z-20">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="backlink-scroll flex items-center gap-1 text-sm text-muted-foreground! no-underline hover:text-foreground!"
          >
            <ArrowLeft className="size-4" /> Back
          </Link>
        </div>
        {/* Top-centered, its own standalone element. The full-width wrapper
            centers it via flexbox (robust regardless of the containing block);
            the button fades/slides in on scroll (scroll-timeline, same range as
            the subtitle collapse) so it's hidden at the top where the full report
            is already visible. Click scrolls back up to the report. */}
        {hasRunProblems && (
          <div className="pointer-events-none absolute inset-x-0 top-5 z-20 flex justify-center">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              title="Scroll to the run report"
              className="runhint-scroll pointer-events-auto flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/20"
            >
              <CircleX className="size-4 shrink-0" />
              Errors in the last ROM run — click to see details
            </button>
          </div>
        )}
        <button
          type="button"
          className="group relative mt-5 mb-5 shrink-0"
          title="Edit the character image"
          onClick={() => setImageDialogOpen(true)}
        >
          {/* The wrapper owns the shrink: only its height animates (208 → 90). At
              rest it's a 3:4 portrait (156×208) matching the gallery / scene
              thumbnails and the crop editor's letterbox guide. It clips a
              fixed-size image via overflow-hidden, so the portrait is *cropped*
              top-down rather than re-fit every frame — the image is rasterized
              once and the box just changes its clip rect, which stays smooth even
              with the heavy form relaying out below the sticky header. */}
          <div className="avatar-scroll-shrink h-[208px] w-[156px] overflow-hidden rounded-lg bg-neutral-500">
            <Avatar
              image={character.image}
              scenePath={sceneAvatarPath ?? undefined}
              name={character.name}
              className="avatar-scroll-pan h-[208px] w-[156px] object-top"
              fallbackClassName="text-6xl"
            />
          </div>
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Pencil className="size-8 text-white" />
          </span>
          {/* Previewing a NON-primary scene (sceneAvatarPath set): keep the
              character's own main avatar (the custom upload / primary snapshot)
              visible as a small badge in the corner, so the header still
              identifies the character while you inspect an outfit scene. Lives
              outside the clipping box so it's never cropped; pointer-events-none
              so the whole portrait still opens the image dialog. */}
          {sceneAvatarPath && (
            <span
              className="pointer-events-none absolute bottom-1.5 left-1.5"
              title="Main avatar"
            >
              <Avatar
                image={character.image}
                name={character.name}
                className="aspect-[3/4] w-11 rounded-md border border-neutral-900 object-top shadow-md"
                fallbackClassName="rounded-md border border-neutral-900 text-sm shadow-md"
              />
            </span>
          )}
        </button>
        <div className="title-scroll pb-6">
          <div className="flex items-center gap-2.5">
            <EditableTitle
              name={character.name}
              ariaLabel="Character name"
              onEditingChange={setEditingTitle}
              onSave={onRenameCharacter}
            />
            {/* With several scenes linked, the SELECTED scene rides the title —
                groom lists and the ROM override follow that selection, and the
                title row stays visible in the collapsed sticky header (the
                subtitle below does not). Hidden while renaming. Clicking it
                scrolls back to the top, where the scene cards are — the one
                place the selection can be switched. */}
            {sceneTag && !editingTitle && (
              <button
                type="button"
                className="cursor-pointer"
                title="The Daz scene selected in the scene cards — hair items and the ROM override follow it. Click to jump to the scene cards and switch."
                onClick={smoothScrollToTop}
              >
                <Tag
                  tone="orange"
                  // Optical nudge: the bold 3xl title's visual weight sits below
                  // the line box's geometric center, so dead-center reads high.
                  className="max-w-64 translate-y-[5px] truncate normal-case"
                >
                  {sceneTag}
                </Tag>
              </button>
            )}
          </div>
          <p className="title-subtitle text-muted-foreground">
            {character.genesis} · {characterSkinning(character).toUpperCase()} ·{' '}
            {countPoses(character.sections)} custom ROM frames
          </p>
          {folderChip && (
            <p className="mt-1.5 text-xs">
              <DirPathChip dir={folderChip.dir} roots={[folderChip.root]} />
            </p>
          )}
        </div>
        {/* Bottom-right in the header, on the path-chip's baseline (mb-6 lifts the
            box so the scale below anchors on that line). They ride the sticky
            header, so they stay reachable as the form scrolls. */}
        <div className="actions-scroll ml-auto flex shrink-0 gap-2 mb-6">
          <HeaderActions draft={draft} />
        </div>
      </header>

      {imageDialogOpen && (
        <ImageDialog
          image={character.image}
          name={character.name}
          characterId={character.id}
          scenes={[...new Set([character.scenePath, ...character.extraScenes].filter(Boolean))]}
          // Persist the avatar immediately — it's a deliberate change and
          // should survive a reload without needing the Save button. The
          // dialog hands a PRODUCER (the upload/copy runs inside it, past
          // persistPatch's single-flight/validate guards); the produced patch
          // carries the source scene ('' for uploads/URLs) so the avatar
          // auto-sync knows what to mirror. persistPatch validates, blocks
          // racing saves, regenerates and rolls back on failure.
          onApply={(produce) => draft.persistPatch(produce, { toast: 'Image updated' })}
          onClose={() => setImageDialogOpen(false)}
        />
      )}
    </>
  )
}
