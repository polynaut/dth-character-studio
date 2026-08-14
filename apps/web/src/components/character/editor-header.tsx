import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, CircleX, Pencil, Save, Undo2 } from 'lucide-react'

import { Avatar } from '#/components/avatar.tsx'
import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { DthExportAction } from '#/components/character/dth-export.tsx'
import { ExportPipelinePanel } from '#/components/character/export-pipeline-panel.tsx'
import { FolderMoveChip } from '#/components/folder-move-chip.tsx'
import { ImageDialog } from '#/components/image-dialog.tsx'
import { Button, EditableTitle, useModifierHeld, useStickyHeaderInset } from '@dth/ui'
import { useConfirm } from '#/lib/use-confirm.tsx'
import { characterSkinning, countPoses } from '@dth/rom'

import type { RootedDir } from '#/lib/character-paths.ts'
import type { ExportPipelineView } from '#/components/character/export-pipeline-panel.tsx'
import type { CharacterDraft } from '#/lib/use-character-draft.ts'

/**
 * Scroll-to-top via the NATIVE `behavior:'smooth'`. A hand-rolled rAF ease was
 * tried and reverted: its ease-out tail reads as lag. Native smooth animates
 * only where the webview supports/enables it (assorted Windows animation
 * settings can make it instant) — accepted trade-off.
 */
function smoothScrollTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
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
/** Stable empty default — see the twin in dth-export.tsx. */
const NO_UNREAL_PROJECTS: ReadonlyArray<string> = []

export function EditorHeader({
  projectId,
  draft,
  folderChip,
  folderMove,
  hasRunProblems,
  dazLibraryConfigured,
  unrealProjects = NO_UNREAL_PROJECTS,
}: {
  projectId: string
  draft: CharacterDraft
  /** The character's folder chip (dim library root, bright remainder), or null
   *  while the location is unresolved. */
  folderChip: RootedDir | null
  /** Enables the folder chip's edit-to-move affordance: the current subfolder to
   *  seed the input, and the move handler (null → a plain read-only chip). */
  folderMove: { editValue: string; onMove: (next: string) => Promise<unknown> } | null
  /** Show the "errors in the last ROM run" scroll-up button. */
  hasRunProblems: boolean
  /** “My DAZ 3D Library” is set (DTH Export needs it for the job file + scripts). */
  dazLibraryConfigured: boolean
  /** The project's linked `.uproject`s — the DTH Export panel's third leg. */
  unrealProjects?: ReadonlyArray<string>
}) {
  const { character } = draft
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  // The live DTH-Export pipeline view, reported up by DthExportAction —
  // rendered as the task list + progress bar anchored above the whole button
  // row (which spans more than that component's own buttons). Null = no run.
  const [exportPipeline, setExportPipeline] = useState<ExportPipelineView | null>(null)
  const swallowNavRef = useRef(false)
  const headerRef = useRef<HTMLElement>(null)

  // Publish the sticky header's live height as `--sticky-header-h` so the things
  // that must stay clear of it track it instead of a hardcoded px that silently
  // drifts: the ROM section / column-title tiers pin right below it, and
  // InfoPopup keeps its popup from overlapping it. The height is dynamic (its
  // content — and so its collapsed height — changes as the design evolves).
  useStickyHeaderInset(headerRef)

  // A character has ONE main avatar (`character.image`), shown in this big
  // portrait and everywhere else in the app — it stays constant and editable in
  // EVERY state (a scene selection never swaps it).

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

      {/* z-40: above inline info popups (z-30) so a popup reaching into the header
          is covered by it, and above the editor body; still below modal dialogs
          and dropdowns (z-50), which must cover the header when open. */}
      <header
        ref={headerRef}
        className="sticky top-0 z-40 mb-8 flex items-end gap-5 bg-background"
      >
        {/* Back stays reachable while scrolled: the page's own Back link lives
            above this sticky header, so a second one fades in here (same
            scroll-timeline as the header collapse) once that one is gone —
            joined by a "Scroll Up" that jumps back to the page top, a step
            darker so Back stays the primary action. */}
        {/* top-5 matches the avatar's mt-5, so the link tops align; left aligns
            with the title beside the avatar (168px box + gap-5). */}
        <div className="backlink-scroll absolute top-5 left-[188px] z-20 flex items-center gap-2">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="flex items-center gap-1 text-sm text-muted-foreground! no-underline hover:text-foreground!"
          >
            <ArrowLeft className="size-4" /> Back
          </Link>
          <span aria-hidden className="text-sm text-muted-foreground/60">
            |
          </span>
          <button
            type="button"
            onClick={smoothScrollTop}
            className="flex cursor-pointer items-center gap-1 text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            Scroll Up
          </button>
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
              onClick={smoothScrollTop}
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
          {/* The wrapper owns the shrink: only its height animates (224 → 96).
              At rest it's a 3:4 portrait (168×224); collapsed it's a 7:4
              landscape (168×96). It clips a fixed-size image via overflow-hidden,
              so the portrait is *cropped* top-down rather than re-fit every frame
              — the image is rasterized once and the box just changes its clip
              rect, which stays smooth even with the heavy form relaying out below
              the sticky header. */}
          <div className="avatar-scroll-shrink h-[224px] w-[168px] overflow-hidden rounded-lg bg-[#262626]">
            <Avatar
              image={character.image}
              name={character.name}
              // A square image LAID OUT at the rest over-scan size (254px = the
              // wrapper's 164px content box × the 1.55 rest scale, centred with
              // the -45px margins) so it fills the wrapper at scale 1 — no GPU
              // up-scaling of a small texture, so the resting portrait stays crisp.
              // The zoom keyframes push in from there (see avatar-scroll-pan/zoom).
              // Fixed px, not %, because a replaced <img>'s percentage width was
              // silently ignored here and % resolves against the bordered content box.
              // `max-w-none` defeats Tailwind preflight's `img { max-width: 100% }`,
              // which would otherwise cap the 254px width back to the wrapper.
              className="avatar-scroll-pan h-[254px] w-[254px] max-w-none -ml-[45px] -mt-[45px] object-top"
              fallbackClassName="text-7xl"
              // Serve the avatar pre-downscaled (Rust Lanczos3) to the painted
              // 254px × screen DPR, so it paints 1:1 — anti-aliased, no GPU
              // resampling of the 768px master.
              renderPx={254}
            />
          </div>
          {/* Hover affordance — the avatar is editable in every state now (a
              scene selection no longer replaces the portrait). */}
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Pencil className="size-8 text-white" />
          </span>
        </button>
        <div className="title-scroll pb-6">
          {/* Just the character name now — the selected-scene tag that used to sit
              beside it here moved to the docked scene footer. The wrapper's
              items-end/gap are vestigial (single child) but harmless. */}
          <div className="flex items-end gap-4">
            {/* Override EditableTitle's hardcoded text-3xl for this header only
                (arbitrary variant reaches its inner h1 + edit input). Matches the
                dth-title-text scroll animation's `from` so there's no jump; the
                -translate-y-[3px] is a small optical nudge kept from that layout.
                `title-edit-scroll` puts the edit input on the same scroll-shrink
                timeline as the h1 (styles.css). */}
            <span className="title-edit-scroll -translate-y-[3px] [&_h1]:text-[3.25rem] [&_input]:text-[3.25rem]">
              <EditableTitle
                name={character.name}
                ariaLabel="Character name"
                onEditingChange={setEditingTitle}
                onSave={onRenameCharacter}
              />
            </span>
          </div>
          <p className="title-subtitle text-muted-foreground">
            {character.gender === 'female' ? '♀' : '♂'} {character.genesis} ·{' '}
            {characterSkinning(character).toUpperCase()} · {countPoses(character.sections)} custom
            ROM frames
          </p>
          {folderChip && (
            // A div, not a <p> — FolderMoveChip's floating panel is a div,
            // invalid inside a paragraph (hydration warning).
            <div className="mt-1.5 text-xs">
              {folderMove ? (
                <FolderMoveChip
                  dir={folderChip.dir}
                  roots={[folderChip.root]}
                  editValue={folderMove.editValue}
                  editLabel="Folder"
                  onMove={folderMove.onMove}
                />
              ) : (
                <DirPathChip dir={folderChip.dir} roots={[folderChip.root]} />
              )}
            </div>
          )}
        </div>
        {/* Bottom-right in the header, on the path-chip's baseline (mb-6 lifts
            the box so the scale below anchors on that line). They ride the
            sticky header, so they stay reachable as the form scrolls. The run's
            task list + bar anchor ABOVE this row (absolute against it — see
            ExportPipelinePanel) and inherit its exact width, so the buttons
            alone size the header and a run starting cannot resize it. The
            panel does NOT dock: `pipeline-scroll` fades it out on the
            header-collapse scroll timeline (styles.css), so the docked sticky
            header shows only the buttons — the panel is a working view for the
            top of the page. */}
        <div className="actions-scroll relative mb-6 ml-auto flex shrink-0 justify-end gap-2">
          {exportPipeline && <ExportPipelinePanel view={exportPipeline} />}
          <DthExportAction
            projectId={projectId}
            character={character}
            saving={draft.saving}
            dirty={draft.dirty}
            dazLibraryConfigured={dazLibraryConfigured}
            unrealProjects={unrealProjects}
            onPipeline={setExportPipeline}
          />
          <HeaderActions draft={draft} />
        </div>
      </header>

      {imageDialogOpen && (
        <ImageDialog
          image={character.image}
          name={character.name}
          characterId={character.id}
          scenes={character.scenePath ? [character.scenePath] : []}
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
