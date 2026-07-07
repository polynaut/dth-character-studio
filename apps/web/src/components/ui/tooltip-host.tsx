import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'

/** Hover delay before the tooltip appears (keyboard focus shows immediately). */
const SHOW_DELAY_MS = 350

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
    // The anchor whose tooltip a click just dismissed — if the click flips its
    // title (PathCode's "Copied!"), the observer below brings the tooltip back.
    let clicked: HTMLElement | null = null
    let timer = 0

    const hide = () => {
      window.clearTimeout(timer)
      timer = 0
      anchor = null
      clicked = null
      tip.style.display = 'none'
    }

    const show = (el: HTMLElement, text: string) => {
      anchor = el
      tip.textContent = text
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
      if (!text || target === anchor) return
      window.clearTimeout(timer)
      timer = window.setTimeout(
        () => show(target, text),
        e.type === 'focusin' ? 0 : SHOW_DELAY_MS,
      )
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
      for (const m of mutations) {
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
    observer.observe(document.body, { attributes: true, attributeFilter: ['title'], subtree: true })

    const onPointerDown = (e: Event) => {
      // Clicking usually stales the position — get out of the way. But when the
      // click lands on the anchor itself, remember it: a title flip right after
      // ("Copied!") re-shows the tooltip with the fresh text.
      const target = e.target as Node | null
      const wasAnchor = anchor && target && anchor.contains(target) ? anchor : null
      hide()
      clicked = wasAnchor
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('mouseover', onEnter, true)
    document.addEventListener('focusin', onEnter, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mouseover', onEnter, true)
      document.removeEventListener('focusin', onEnter, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('keydown', onKey, true)
      observer.disconnect()
      hide()
    }
  }, [])

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      style={{ display: 'none' }}
      className="pointer-events-none fixed top-0 left-0 z-[100] w-max max-w-xs rounded-md border bg-popover px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-line text-popover-foreground shadow-lg"
    />,
    document.body,
  )
}
