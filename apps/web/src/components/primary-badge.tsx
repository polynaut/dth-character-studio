import { cn } from '@dth/ui'

/**
 * The "primary scene" role badge: a quiet, refined LABEL (dark-green pill, mint text,
 * a softly-glowing four-point star) — NOT an interactive control. An inline SVG star
 * (not a Unicode glyph) so it renders identically everywhere. `dense` trims it for the
 * compact scene-footer pills. All styling lives in `styles.css` (`.primary-badge`).
 */
export function PrimaryBadge({ dense = false, title }: { dense?: boolean; title?: string }) {
  return (
    <span className={cn('primary-badge', dense && 'primary-badge--dense')} title={title}>
      <svg className="primary-badge__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2 C12.7 7.6 16.4 11.3 22 12 C16.4 12.7 12.7 16.4 12 22 C11.3 16.4 7.6 12.7 2 12 C7.6 11.3 11.3 7.6 12 2Z"
          fill="currentColor"
        />
      </svg>
      <span>PRIMARY</span>
    </span>
  )
}
