import type { ReactNode } from 'react'

import { cn } from '../cn.ts'
import { toneIcon, toneText } from './status-indicator.tsx'
import type { Tone } from './status-indicator.tsx'

const tones = {
  success: 'border-success-border bg-success-subtle',
  warning: 'border-warning-border bg-warning-subtle',
  error: 'border-destructive-border bg-destructive-subtle',
  info: 'border-info-border bg-info-subtle',
} as const

/** A tinted callout. Errors announce as `alert`, everything else as `status`. */
export function Notice({
  tone,
  title,
  action,
  children,
}: {
  tone: Exclude<Tone, 'neutral'>
  title?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  const Icon = toneIcon[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-md border p-3 text-sm', tones[tone])}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', toneText[tone])} aria-hidden />
      <div className="min-w-0 flex-1 break-words">
        {title && <p className="font-medium">{title}</p>}
        {children && (
          <div className={cn('text-foreground/80', title && 'mt-0.5')}>{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
