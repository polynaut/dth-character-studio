import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, FolderOpen, Plus, Wrench, X } from 'lucide-react'
import { toast } from 'sonner'

import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { Button, RemoveAssetDialog, cn, useModifierHeld } from '@dth/ui'
import unrealLogo from '#/assets/unreal-logo.svg'
import { UnrealUtilsPanel, uprojectDisplayName } from '#/components/unreal-utils-panel.tsx'
import {
  openScene,
  revealPath,
  setUnrealProjects,
  unrealDthContentPresent,
  unrealProjectState,
} from '#/lib/rom/api.ts'
import { bridgeOutdated } from '#/lib/rom/unreal-jobs.ts'
import { pickUprojectPath } from '#/lib/desktop.ts'
import { PathCode } from '#/components/path-code.tsx'
import { browseStart, displayPath, middleTruncatePath, normalizePath, parentDir } from '#/lib/path.ts'

import type { ProjectInfo } from '#/lib/rom/api.ts'

/**
 * A linked Unreal project card in the footer bar: the U mark, name + a REAL
 * path chip (click = copy, Alt+click = Explorer). The card body itself is
 * inert — only the explicit buttons act: the open button launches the
 * `.uproject` (OS association → Unreal), and the 🔧 opens this project's
 * {@link UnrealUtilsPanel} — the same Utils button the Daz-scene and Houdini
 * cards carry, whose Install tab holds what used to be the install dialog. An
 * amber mark appears when the project is missing DTH content or holds an
 * out-of-date bridge. The hover ✕ only unlinks. The chip middle-truncates to a
 * fixed budget + width so every card lines up (only a long project NAME may
 * widen one).
 */
function UnrealCard({
  uprojectPath,
  dthPresent,
  bridgeStale,
  disabled,
  onOpen,
  onUtils,
  onRemove,
}: {
  uprojectPath: string
  /** undefined while the Content/DazToHue probe is still running — the button
   *  stays usable either way; the drawer does its own probing. Only a definite
   *  `false` raises the attention mark: an unfinished (or failed) probe must
   *  never claim the project is missing something. */
  dthPresent: boolean | undefined
  /** The project has a DTH Character Studio Runner, but not the one this app ships —
   *  a plugin folder keeps whatever was installed the day it was installed,
   *  and the studio ships fixes to it. */
  bridgeStale: boolean
  /** A list write is in flight — the whole bar is single-flight, so the card's
   *  mutating actions (utils / unlink) disable alongside the Add button. */
  disabled: boolean
  onOpen: (e: React.MouseEvent) => void
  /** Opens this project's Utils drawer (its Install tab is the whole reason
   *  the card has a wrench today). */
  onUtils: () => void
  onRemove: () => void
}) {
  const displayName = uprojectDisplayName(uprojectPath)
  // Only a DEFINITE "no" counts — `undefined` is a probe still running or one
  // that failed, and neither is evidence of a missing install.
  const needsAttention = bridgeStale || dthPresent === false
  // Alt held → the open icon previews the alternate action (show in Explorer).
  const altHeld = useModifierHeld('Alt')
  const shownPath = displayPath(uprojectPath)
  // The chip shows the full file name (extension included); when the 40-char
  // budget forces truncation, the shown start caps at 8 chars ("D:\Unrea…") so
  // the budget goes to the file name. Natural width — the chip hugs its text.
  const chipText = middleTruncatePath(shownPath, 40, 8)
  const OpenIcon = altHeld ? FolderOpen : ExternalLink
  return (
    <div className="group/card relative">
      <div className="unreal-card flex items-center gap-3 rounded-lg border px-3 py-2 pl-4 transition-colors">
        {/* Inert body — clicking the card is a no-op; only the buttons act. */}
        <img src={unrealLogo} alt="" aria-hidden className="size-9 shrink-0 object-contain" />
        <span className="min-w-0">
          {/* max-w cap so an absurd project name still truncates eventually —
              a merely LONG one may widen the card, by design. */}
          <span className="block max-w-96 truncate text-sm font-medium">{displayName}</span>
          {/* A real path chip: click copies the full path, Alt+click reveals it
              in Explorer. Middle-ellipsized to a character budget so the drive
              AND the .uproject name always read. */}
          <PathCode
            path={shownPath}
            variant="secondary"
            className="text-[11px] leading-4 whitespace-nowrap"
          >
            {chipText}
          </PathCode>
        </span>
        {/* What this project still needs, in ONE amber mark — the Utils button
            beside it is neutral (it is a drawer, not an action), so without
            this the card lost the at-a-glance "this one isn't set up yet" the
            old highlighted install button carried. Two conditions, one fix
            (Utils → Install), so one indicator: DTH content missing, or a
            bridge older than the one this app ships (it imports with an older
            set of rules, or refuses the job outright). Clickable like the
            Houdini card's warning badge — the mark points at its own fix. */}
        {needsAttention && (
          <button
            type="button"
            onClick={onUtils}
            className="shrink-0 rounded-md p-1 text-amber-500 transition-colors hover:bg-accent"
            title={
              bridgeStale
                ? 'The DTH Character Studio Runner in this project is older than the one this app ships — re-install it in Utils → Install (and restart the editor once).'
                : 'No DTH content in this project yet — install it from Utils → Install.'
            }
            aria-label={`Needs attention: ${
              bridgeStale ? 'bridge plugin out of date' : 'DTH content not installed'
            } — fix it in Utils`}
          >
            <AlertTriangle className="size-4" />
          </button>
        )}
        {/* Utils first, OPEN at the very right — the primary action sits at
            the card's edge. Same 🔧 and the same corner-cluster adornment as
            the Daz-scene and Houdini cards' Utils button, minus their
            hover-reveal: those hide it in a cluster the card already shows on
            hover, while this one is the ONLY way into the install list — a
            control that isn't there until you hover reads as a missing
            feature on a card this small. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onUtils}
          disabled={disabled}
          aria-label={`Utils for ${displayName}`}
          title="Utils — install DTH content & plugins"
          className="group/utils shrink-0 border border-transparent hover:border-white/20 hover:bg-[#333] hover:shadow-sm dark:hover:bg-[#333]"
        >
          <Wrench className="size-3.5 text-muted-foreground transition-colors group-hover/utils:text-foreground" />
        </Button>
        <button
          type="button"
          onClick={onOpen}
          data-alt-reveal=""
          aria-label={`Open ${displayName} in Unreal Engine`}
          title={altHeld ? 'Show in Explorer' : 'Open in Unreal Engine'}
          className="shrink-0 rounded-md border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-unreal-blue"
        >
          <OpenIcon className="size-4" />
        </button>
      </div>
      {/* Unreal-cyan left accent bar — painted over the card's left edge, rounded
          to follow the corners (matching the Daz / Houdini cards). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-unreal-blue"
      />
      {/* Always rendered (hover only fades it in) so it stays in the tab order —
          `hidden` removed keyboard users from unlinking entirely. Same recipe as
          the Home screen's remove-from-recents button. */}
      <button
        type="button"
        title="Unlink from project (the file is kept)"
        aria-label={`Unlink ${displayName}`}
        disabled={disabled}
        className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border bg-card text-muted-foreground opacity-0 transition-[opacity,color] group-hover/card:opacity-100 focus-visible:opacity-100 hover:text-destructive disabled:hover:text-muted-foreground"
        onClick={onRemove}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

/**
 * The project's linked Unreal projects (`.uproject`) as a footer bar docked to
 * the bottom of the viewport — always visible while browsing the project.
 * Links only: files stay in place, unlinking never deletes. Add via the picker
 * or by dropping a `.uproject` onto the bar. Pages rendering it need bottom
 * padding so content can scroll clear of the bar.
 */
export function UnrealProjectsBar({ project }: { project: ProjectInfo }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  // Ref twin of `busy` for the single-flight guard in `save` — a state read in a
  // just-created closure can be one render stale (e.g. two drops in one tick).
  const busyRef = useRef(false)
  // The freshest known list. The loader prop only refreshes once
  // `router.invalidate()` completes, so right after a save it is STALE — a
  // second mutation in that window (unlink A, then quickly unlink B) computed
  // from the prop would resurrect the first change. `save` updates this ref
  // with the just-written list; the effect re-syncs it when the loader lands.
  const latestPaths = useRef(project.unrealProjects)
  useEffect(() => {
    latestPaths.current = project.unrealProjects
  }, [project.unrealProjects])
  // Per-project `Content/DazToHue` presence (undefined = probe in flight) —
  // drives the install button's dim; the install dialog probes for itself.
  const [dthStatus, setDthStatus] = useState<Record<string, boolean | undefined>>({})
  /** Which linked projects hold a bridge older than the one this app ships. */
  const [bridgeStale, setBridgeStale] = useState<Record<string, boolean>>({})
  // The card whose Utils button was clicked — the drawer's entire scope, like
  // the Daz-scene and Houdini Utils drawers. '' = closed.
  const [utilsFor, setUtilsFor] = useState('')
  // The card whose hover-✕ was clicked — unlinking pauses on a confirm dialog
  // (same recipe as removing a Daz scene / Houdini project from a character).
  const [pendingRemove, setPendingRemove] = useState('')

  // Subtle edge-fade on the cards rail: fade whichever side still has scrolled-off
  // cards, so a long list hints that it scrolls — and nothing fades when they fit.
  const railRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const update = () =>
      setFade({
        left: el.scrollLeft > 4,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      })
    update()
    el.addEventListener('scroll', update, { passive: true })
    // jsdom (component tests) has no ResizeObserver — guard so this stays inert there.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [project.unrealProjects.length])

  useEffect(() => {
    let active = true
    for (const path of project.unrealProjects) {
      void unrealDthContentPresent({ data: { uprojectPath: path } })
        .then((present) => {
          if (active) setDthStatus((s) => ({ ...s, [path]: present }))
        })
        .catch(() => {
          // A failed probe must not leave the card stuck on `undefined` (the
          // install button disables forever with no explanation). Treat it as
          // "not installed": the button enables with the default (non-overwrite)
          // install, and a genuinely broken path fails THERE with its own toast.
          if (active) setDthStatus((s) => ({ ...s, [path]: false }))
        })
    }
    // The bridge is the studio's OWN plugin, so a project can hold an older
    // copy than the app talking to it. One state read per project answers it;
    // a failed probe says nothing rather than crying wolf.
    for (const path of project.unrealProjects) {
      void unrealProjectState({ data: { uprojectPath: path } })
        .then((state) => {
          if (active) {
            setBridgeStale((s) => ({ ...s, [path]: bridgeOutdated(state.bridgeVersion) }))
          }
        })
        .catch(() => {
          if (active) setBridgeStale((s) => ({ ...s, [path]: false }))
        })
    }
    return () => {
      active = false
    }
  }, [project.unrealProjects])

  async function save(paths: Array<string>, okMessage: string) {
    // Single-flight for the whole bar: `busy` disables the buttons, but the
    // drop zone can still fire — two interleaved writes would race on disk.
    if (busyRef.current) {
      toast.info('Still saving the previous change — try again in a moment.')
      return
    }
    busyRef.current = true
    setBusy(true)
    try {
      // The loader is the single source (`router.invalidate()` refreshes the
      // `project` prop) — no saved-project callback needed.
      await setUnrealProjects({ data: { projectId: project.path, paths } })
      latestPaths.current = paths
      void router.invalidate()
      toast.success(okMessage)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function add(paths: Array<string>) {
    const current = latestPaths.current
    // Case-insensitive de-dupe on the normalised path (Windows) — `d:/x.uproject`
    // and `D:\x.uproject` are the same project, not two.
    const linked = new Set(current.map((p) => normalizePath(p).toLowerCase()))
    const fresh = paths.filter((p) => !linked.has(normalizePath(p).toLowerCase()))
    if (!fresh.length) {
      toast.info('That Unreal project is already linked.')
      return
    }
    void save([...current, ...fresh], 'Linked Unreal project')
  }

  async function onPick() {
    // Unreal projects live wherever the user keeps them — the only thing we
    // know is where the ones already linked live.
    const picked = await pickUprojectPath(
      'Select the Unreal project (.uproject)',
      browseStart(parentDir(latestPaths.current[0] ?? '')),
    )
    if (picked) add([picked])
  }

  // The add/link trigger's accessible name carries the intent (and the in-flight
  // state, which the single-flight test asserts on) — its visible label is
  // "+ Add project".
  const addLabel = busy
    ? 'Linking…'
    : project.unrealProjects.length
      ? 'Add an Unreal project'
      : 'Link an Unreal project'

  const railMask = `linear-gradient(to right, ${fade.left ? 'transparent' : '#000'}, #000 22px, #000 calc(100% - 22px), ${fade.right ? 'transparent' : '#000'})`
  const pageRail = (dir: -1 | 1) => railRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' })

  return (
    <FileDropZone
      accept={['uproject']}
      onDrop={add}
      label="Drop an Unreal project (.uproject) to link"
      className="fixed inset-x-0 bottom-0 z-20"
    >
      {/* min-h reserves the FILLED bar's height (measured 79.7px: card + the
          rail's py-2), clamping BOTH states to 80px — linking the first
          project must not shift the layout. Re-measure if the card changes. */}
      <div className="footer-3d flex min-h-[80px] items-center gap-3 px-4 backdrop-blur">
        {/* Left column: the section title with a compact "+ Add" trigger stacked
            underneath it. Kept short (h-7) so the two rows still fit the reserved
            card-row height — the footer doesn't grow taller than a linked card. */}
        <div className="mr-1 flex shrink-0 flex-col gap-1">
          <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            Unreal projects
          </span>
          <Button
            variant="outline"
            size="sm"
            className={cn('h-7 w-fit gap-1 px-2 text-xs', busy && 'animate-pulse')}
            disabled={busy}
            // aria-label only — no tooltip; the visible "+ Add project" says it.
            aria-label={addLabel}
            onClick={() => void onPick()}
          >
            <Plus className="size-3.5" /> Add project
          </Button>
        </div>
        {project.unrealProjects.length > 0 && (
          <>
            {/* Divider between the title column and the projects rail. */}
            <span className="h-9 w-px shrink-0 bg-border" aria-hidden />
            {/* Every linked project as a card in a horizontally-scrollable rail
                (fits any number, ‹ › page it) — the same dock language as the
                character page's scene dock. */}
            {/* `py-2` gives each card's hover-✕ (just outside its top-right) room
                so `overflow-x-auto` — which forces overflow-y to auto — doesn't clip
                it or spawn a stray vertical scrollbar. */}
            <div
              ref={railRef}
              className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-2 [scrollbar-width:thin]"
              style={{ maskImage: railMask, WebkitMaskImage: railMask }}
            >
              {project.unrealProjects.map((path) => (
                <UnrealCard
                  key={path}
                  uprojectPath={path}
                  dthPresent={dthStatus[path]}
                  bridgeStale={bridgeStale[path] === true}
                  disabled={busy}
                  onOpen={(e) => {
                    // Alt+click = the app-wide "show in Explorer" hotkey (same as
                    // path chips); plain click opens the project in Unreal. Failures
                    // surface as toasts — a scope/association problem otherwise looks
                    // like a dead button (exactly how the .uproject scope bug hid).
                    const action = e.altKey
                      ? revealPath({ data: { path } })
                      : openScene({ data: { scenePath: path } })
                    void action.catch((err: unknown) =>
                      toast.error(err instanceof Error ? err.message : String(err)),
                    )
                  }}
                  onUtils={() => setUtilsFor(path)}
                  onRemove={() => setPendingRemove(path)}
                />
              ))}
            </div>
            {/* Rail pager — only shown when the rail actually overflows (so a lone
                card doesn't strand ‹ › over empty space); each arrow disables at
                its end. `fade` already tracks the scrolled-off sides. */}
            {(fade.left || fade.right) && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Scroll projects left"
                  disabled={!fade.left}
                  onClick={() => pageRail(-1)}
                  className="flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Scroll projects right"
                  disabled={!fade.right}
                  onClick={() => pageRail(1)}
                  className="flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {/* Mounted only while open, like the Daz-scene and Houdini Utils drawers —
          the drawer probes the project, scans the plugin folders and detects the
          engines on mount, none of which may happen just because the bar
          rendered. Guarded against the project unlinking underneath it (the
          drawer's scope would be gone). */}
      {utilsFor && project.unrealProjects.includes(utilsFor) && (
        <UnrealUtilsPanel
          open
          // The drawer acts on THIS project alone — `utilsFor` is the card whose
          // Utils button was pressed, and it is the drawer's entire scope.
          uprojectPath={utilsFor}
          onClose={() => setUtilsFor('')}
          // The drawer's install just proved the content is there — adopt that
          // over whatever the card's probe said.
          onInstalled={(dthInstalled) => {
            const path = utilsFor
            if (dthInstalled) setDthStatus((s) => ({ ...s, [path]: true }))
            // …and the bridge's version with it. The amber warning's whole
            // message is "re-install it", and Install is where you do that —
            // leaving it up afterwards told the user the fix hadn't worked.
            // Re-READ rather than assume: the bridge row can be unticked, so an
            // install is not proof that this particular thing was installed.
            void unrealProjectState({ data: { uprojectPath: path } })
              .then((state) => {
                setBridgeStale((s) => ({ ...s, [path]: bridgeOutdated(state.bridgeVersion) }))
              })
              .catch(() => {
                // Same rule as the mount probe: a failed read says nothing.
              })
          }}
        />
      )}
      {pendingRemove && (
        <RemoveAssetDialog
          title="Unlink Unreal project?"
          description={`Unlink “${uprojectDisplayName(pendingRemove)}” from this project — the .uproject and all its files stay on disk.`}
          showDeleteFile={false}
          busy={busy}
          onConfirm={() =>
            void save(
              latestPaths.current.filter((p) => p !== pendingRemove),
              'Unlinked Unreal project',
            ).then(() => setPendingRemove(''))
          }
          onClose={() => setPendingRemove('')}
        />
      )}
    </FileDropZone>
  )
}
