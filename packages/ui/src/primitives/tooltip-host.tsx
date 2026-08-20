import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'

/** Hover delay before the tooltip appears (keyboard focus shows immediately). */
const SHOW_DELAY_MS = 700

// break-words: long unbroken tokens (absolute paths, URLs) must wrap inside the
// box — whitespace-pre-line alone only wraps at spaces, so they'd overflow.
const TIP_BASE =
  'pointer-events-none fixed top-0 left-0 z-[100] w-max max-w-xs rounded-md px-2.5 py-1.5 text-xs leading-relaxed break-words whitespace-pre-line shadow-2xl'
const TIP_DEFAULT = `${TIP_BASE} border bg-popover text-popover-foreground`
// An element with data-tooltip-variant="error" (e.g. an invalid input) gets an
// alert-style tooltip: red background, light text.
const TIP_ERROR = `${TIP_BASE} border border-destructive bg-destructive text-white`

/** The mounted host's `hide`, for {@link closeTooltip}. A Set rather than one
 *  slot so a second host (a test, a future second shell) can't strand the
 *  first one's registration. */
const hosts = new Set<() => void>()

/**
 * Hide the tooltip that is showing — and cancel one that is counting down to
 * appear.
 *
 * Tooltips are the app's TOP floating layer (`z-[100]`): above the dialogs and
 * side panels (z-50) and above the InfoPopups (z-[60]). So one still on screen
 * when an overlay opens floats over the very thing the user just asked for.
 * {@link TooltipHost}'s own hit-test refuses to paint over a covering overlay,
 * but that only guards the *moment of showing* — a tooltip already up, or a
 * hover delay already counting down, is not the overlay's to hit-test.
 *
 * Modal and SidePanel call this the moment they open, the same sweep they
 * already do for InfoPopups. Cheap and safe with no host mounted (an empty
 * Set), so a caller never has to check.
 */
export function closeTooltip() {
  for (const hide of [...hosts]) hide()
}

/**
 * App-styled tooltips for EVERY `title` attribute, mounted once in the app
 * shell. Instead of wrapping each call site in a tooltip component, one
 * document-level hover/focus listener finds the nearest `[title]` ancestor,
 * *steals* the attribute (moved to `data-tooltip`, so the native browser
 * tooltip can never double ours — and React won't restore it unless the value
 * actually changes) and shows a Floating UI-positioned tooltip instead. Every
 * existing and future `title=` migrates automatically.
 *
 * Accessibility: stealing `title` removes it from the accessible name, so
 * icon-only elements (no visible text, no aria-label) get the text copied to
 * `aria-label`. Elements with visible text keep their own name — the tooltip
 * is supplementary description there.
 */
export function TooltipHost() {
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const tip = tipRef.current
    if (!tip) return
    let anchor: HTMLElement | null = null
    // The anchor a show-timer is currently counting down for. Without it, every
    // mouseover on a CHILD of the anchor (sweeping across a multi-element card)
    // re-resolves to the same anchor, restarts the delay and stacks another
    // cancel-listener pair — enough children and the tooltip never appears.
    let pending: HTMLElement | null = null
    // The anchor whose tooltip a click just dismissed — if the click flips its
    // title (PathCode's "Copied!"), the observer below brings the tooltip back.
    let clicked: HTMLElement | null = null
    let timer = 0
    // Was the user's last input the KEYBOARD? It decides whether a `focusin` is
    // someone asking for the description or the app moving focus around (see
    // the gate in onEnter). Tracked here rather than read off `:focus-visible`:
    // the two listeners that answer it are already installed below, and the
    // selector is an engine heuristic — Chromium agrees with this, jsdom's
    // answer shifts with whatever ran before it, and an engine that doesn't know
    // the pseudo at all makes `matches` throw inside a document-level listener.
    // Starts false: focus arriving with no input behind it (an autofocus on
    // mount) is nobody asking for a tooltip either.
    let keyboardInput = false

    const hide = () => {
      window.clearTimeout(timer)
      timer = 0
      anchor = null
      pending = null
      clicked = null
      tip.style.display = 'none'
    }

    const show = (el: HTMLElement, text: string) => {
      // The anchor may have left the DOM while the show-timer counted down (or
      // between a title flip and the observer callback) — a detached anchor
      // has no position, only a ghost tooltip. Drop it.
      if (!el.isConnected) return hide()
      // Never float a tooltip above content that's been covered — e.g. a modal
      // dialog that opened over the anchor (the tooltip is z-100, dialogs z-50).
      // If the top-most element at the anchor's centre is in a different subtree
      // (an overlay on top), stay hidden. Guarded on a real rect so it's a no-op
      // where there's no layout (jsdom returns 0×0 and an unrelated hit-test).
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (topEl && topEl !== el && !el.contains(topEl) && !topEl.contains(el)) {
          hide()
          return
        }
      }
      anchor = el
      pending = null
      tip.textContent = text
      tip.className = el.getAttribute('data-tooltip-variant') === 'error' ? TIP_ERROR : TIP_DEFAULT
      tip.style.display = 'block'
      void computePosition(el, tip, {
        placement: 'top',
        strategy: 'fixed',
        middleware: [offset(6), flip(), shift({ padding: 8 })],
      }).then(({ x, y }) => {
        // The hover may have moved on while we were measuring.
        if (anchor !== el) return
        tip.style.left = `${x}px`
        tip.style.top = `${y}px`
      })
    }

    /** Move a `title` out of the browser's reach (into `data-tooltip`), keeping
     *  icon-only controls named for assistive tech. */
    const steal = (target: HTMLElement, title: string) => {
      target.removeAttribute('title')
      if (title.trim()) target.setAttribute('data-tooltip', title)
      else target.removeAttribute('data-tooltip')
      if (!target.hasAttribute('aria-label') && !(target.textContent ?? '').trim()) {
        target.setAttribute('aria-label', title)
      }
    }

    const stillHovered = (el: Element): boolean => {
      try {
        return el.matches(':hover')
      } catch {
        return false
      }
    }

    const onEnter = (e: Event) => {
      const start = e.target as Element | null
      const target = start?.closest?.('[title], [data-tooltip]') as HTMLElement | null
      if (!target) return
      const title = target.getAttribute('title')
      if (title !== null) steal(target, title)
      const text = target.getAttribute('data-tooltip')
      // Already showing for this anchor, or its timer is already running (a
      // mouseover on one of its children) — bail before restarting the delay
      // or attaching a second cancel-listener pair.
      if (!text || target === anchor || target === pending) return
      // A focusin that isn't the keyboard's is focus the APP moved: an overlay
      // closing restores focus to the control that opened it, and a mouse click
      // lands focus on the button it pressed. Neither is a request for the
      // description, and a focus tooltip shows at 0ms — so closing a side panel
      // put the opener's tooltip straight back over the app, under a cursor that
      // never moved, undoing the sweep that hid it on open (see closeTooltip).
      // Keyboard focus still shows immediately: tabbing to an icon-only control
      // is exactly when its description is wanted.
      if (e.type === 'focusin' && !keyboardInput) return
      window.clearTimeout(timer)
      pending = target
      timer = window.setTimeout(
        () => show(target, text),
        e.type === 'focusin' ? 0 : SHOW_DELAY_MS,
      )
      // The bail above stops pairs from STACKING while a timer counts down; a
      // show → pointerdown-hide cycle on the same still-hovered anchor can
      // still attach a second pair (anchor/pending were reset by hide()).
      // That's harmless: each pair removes itself the first time it fires.
      const cancel = () => {
        target.removeEventListener('mouseleave', cancel)
        target.removeEventListener('blur', cancel)
        hide()
      }
      target.addEventListener('mouseleave', cancel)
      target.addEventListener('blur', cancel)
    }

    // React re-renders write a fresh `title` (it diffs against its own vdom, not
    // the stolen attribute). Re-steal live so a tooltip that's on screen tracks
    // the change — this is what lets click feedback like PathCode's "Copied!"
    // reach the styled tooltip at all.
    const observer = new MutationObserver((mutations) => {
      // An anchor REMOVED from the DOM emits no mouseleave and no blur — a
      // state swap under a stationary cursor (a progress button whose run just
      // finished) would otherwise leave its tooltip on screen forever, pinned
      // to a detached node. childList is observed for exactly this check; the
      // common no-tooltip case is one null test.
      if (anchor && !anchor.isConnected) hide()
      for (const m of mutations) {
        if (m.type !== 'attributes') continue
        const el = m.target as HTMLElement
        const title = el.getAttribute('title')
        if (title === null) continue // our own removeAttribute echoing back
        steal(el, title)
        const text = el.getAttribute('data-tooltip')
        if (el === anchor) {
          if (text) show(el, text)
          else hide()
        } else if (el === clicked && text && stillHovered(el)) {
          show(el, text)
        }
      }
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['title'],
      childList: true,
      subtree: true,
    })

    const onPointerDown = (e: Event) => {
      keyboardInput = false
      // Clicking usually stales the position — get out of the way. But when the
      // click lands on the anchor itself, remember it: a title flip right after
      // ("Copied!") re-shows the tooltip with the fresh text.
      const target = e.target as Node | null
      const wasAnchor = anchor && target && anchor.contains(target) ? anchor : null
      hide()
      clicked = wasAnchor
    }

    const onKey = (e: KeyboardEvent) => {
      keyboardInput = true
      if (e.key === 'Escape') hide()
    }

    // Anything that takes focus AWAY from the window strands a tooltip:
    // launching Daz Studio, Unreal or Houdini, revealing a path in Explorer,
    // opening a link — or a plain alt-tab. The pointer never moves, so neither
    // `mouseleave` nor the anchor's `blur` ever fires, and the tooltip stays
    // painted over the app until the user happens to hover that control again.
    // One window-level blur covers every such action, including launchers added
    // later, without each call site having to remember. Deliberately NOT a
    // `document.hasFocus()` guard inside show(): a missed hide is cosmetic,
    // while a hasFocus() that reads false in some webview state would suppress
    // every tooltip in the app.
    const onWindowBlur = () => hide()
    // Minimizing (or the OS hiding the webview) strands it the same way, and
    // does not always come with a blur.
    const onVisibility = () => {
      if (document.hidden) hide()
    }

    // Let the overlay layers sweep this host — see closeTooltip().
    hosts.add(hide)
    document.addEventListener('mouseover', onEnter, true)
    document.addEventListener('focusin', onEnter, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      hosts.delete(hide)
      document.removeEventListener('mouseover', onEnter, true)
      document.removeEventListener('focusin', onEnter, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onWindowBlur)
      observer.disconnect()
      hide()
    }
  }, [])

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      style={{ display: 'none' }}
      className={TIP_DEFAULT}
    />,
    document.body,
  )
}
