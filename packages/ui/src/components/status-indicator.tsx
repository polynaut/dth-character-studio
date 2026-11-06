import { Check, CircleX, Info, TriangleAlert } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '../cn.ts'

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral'

export const toneText: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive-text',
  info: 'text-info',
  neutral: 'text-muted-foreground',
}

export const toneIcon: Record<Exclude<Tone, 'neutral'>, LucideIcon> = {
  success: Check,
  warning: TriangleAlert,
  error: CircleX,
  info: Info,
}

/** Inline status line: a tone-coloured icon and text. Pass `icon={null}` for text only. */
export function StatusIndicator({
  tone,
  icon,
  children,
}: {
  tone: Tone
  icon?: LucideIcon | null
  children: ReactNode
}) {
  const Icon = icon === undefined ? (tone === 'neutral' ? null : toneIcon[tone]) : icon
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', toneText[tone])}>
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      <span className="min-w-0 break-words">{children}</span>
    </span>
  )
}
