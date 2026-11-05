import type { ReactNode } from 'react'

import { cn } from '../cn.ts'
import { InfoPopup } from '../primitives/info-popup.tsx'

/** Page body column: readable width by default, full width for dense screens like ROM. */
export function Page({
  width = 'default',
  children,
}: {
  width?: 'default' | 'wide'
  children: ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full space-y-6', width === 'default' && 'max-w-3xl')}>
      {children}
    </div>
  )
}

export function PageHeader({
  title,
  back,
  description,
  actions,
}: {
  title: ReactNode
  back?: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="space-y-1">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 break-words text-xl font-semibold">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </header>
  )
}

/** A titled block. Carded by default; `plain` drops the card for full-width content. */
export function Section({
  title,
  info,
  description,
  actions,
  plain,
  children,
}: {
  title?: ReactNode
  info?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  plain?: boolean
  children: ReactNode
}) {
  const hasHead = title || description || actions
  return (
    <section className={cn('space-y-4', !plain && 'rounded-lg border bg-card p-5')}>
      {hasHead && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            {title && (
              <h2 className="flex min-w-0 items-center gap-1 text-base font-semibold">
                {title}
                {info && (
                  <InfoPopup label={typeof title === 'string' ? `${title} — more information` : 'More information'}>
                    {info}
                  </InfoPopup>
                )}
              </h2>
            )}
            {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}
