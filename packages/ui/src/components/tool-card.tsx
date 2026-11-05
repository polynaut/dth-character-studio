import type { ReactNode } from 'react'

import { cn } from '../cn.ts'

const tones = {
  daz: { bar: 'bg-daz-green', tint: 'bg-daz-green/5', selected: 'border-daz-green bg-daz-green/10' },
  houdini: {
    bar: 'bg-houdini-orange',
    tint: 'bg-houdini-orange/5',
    selected: 'border-houdini-orange bg-houdini-orange/10',
  },
  unreal: {
    bar: 'bg-unreal-blue',
    tint: 'bg-unreal-blue/5',
    selected: 'border-unreal-blue bg-unreal-blue/10',
  },
} as const

/** A card for one tool's thing (Daz scene, Houdini project, Unreal project), marked by a left accent bar in the tool colour. */
export function ToolCard({
  tone,
  state = 'idle',
  title,
  subtitle,
  media,
  actions,
  children,
  className,
}: {
  tone: 'daz' | 'houdini' | 'unreal'
  state?: 'idle' | 'selected' | 'attention'
  title: ReactNode
  subtitle?: ReactNode
  media?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const t = tones[tone]
  return (
    <div
      data-state={state}
      className={cn(
        'relative flex w-full items-start gap-3 self-start overflow-hidden rounded-lg border py-3 pl-5 pr-3',
        state === 'selected' ? t.selected : t.tint,
        state === 'attention' && 'border-warning-border',
        className,
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1.5', t.bar)} />
      {media && <div className="shrink-0">{media}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold" title={typeof title === 'string' ? title : undefined}>
          {title}
        </p>
        {subtitle && <div className="mt-0.5 break-words text-xs text-muted-foreground">{subtitle}</div>}
        {children && <div className="mt-2 min-w-0 break-words text-sm">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  )
}
