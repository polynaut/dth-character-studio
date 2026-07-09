import type { ReactNode } from 'react'

import { cn } from '../cn.ts'

/** Tone → border / background / text classes. Backgrounds carry 60% alpha so they
 *  sit softly on any surface; the border is a darker shade of the same hue and the
 *  text is the palette's lightest tint for contrast. */
const tones = {
  orange: 'border-orange-950 bg-orange-700/60 text-orange-50',
  green: 'border-green-950 bg-green-800/60 text-green-50',
} as const

/**
 * A small uppercase pill for inline context labels — e.g. the project header's
 * "Project" badge or a Daz scene card's "primary" badge. Its text is a touch
 * smaller than the surrounding `text-xs` so the all-caps reads at a matching size
 * next to path chips.
 */
export function Tag({
  children,
  tone = 'orange',
  className,
  title,
}: {
  children: ReactNode
  tone?: keyof typeof tones
  className?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
