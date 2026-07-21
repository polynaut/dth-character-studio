import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'

/**
 * A "read more in the guide" link for info popups. Just a styled anchor —
 * {@link InfoPopup} intercepts the click and opens external URLs in the OS
 * browser itself, so no handler is needed here. The popups keep a short in-app
 * blurb; the guide holds the full text.
 */
export function GuideLink({
  href,
  children = 'Read more in the guide',
}: {
  href: string
  children?: ReactNode
}) {
  return (
    <a href={href} className="inline-flex items-center gap-1">
      {children} <ExternalLink className="size-3.5" />
    </a>
  )
}
