import { Link } from '@tanstack/react-router'

import { cn } from '@dth/ui'

/**
 * A destructive configuration error with a trailing "change in Settings" link
 * that navigates to the Settings page — for errors the user fixes by pointing a
 * folder at the right place.
 */
export function ConfigError({ message, className }: { message: string; className?: string }) {
  return (
    <p className={cn('text-sm text-destructive', className)}>
      {message} —{' '}
      <Link to="/settings" className="underline hover:text-foreground">
        change in Settings
      </Link>
    </p>
  )
}
