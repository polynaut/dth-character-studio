import { createPortal } from 'react-dom'
import { Check, CheckCheck, LayoutGrid, List, Trash2, X } from 'lucide-react'

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@dth/ui'

/** Card layout for an overview. */
export type ViewMode = 'grid' | 'list'

/** Sort order shared by the project + character overviews. */
export type SortKey = 'alpha' | 'date-desc' | 'date-asc'

const SORT_LABELS: Record<SortKey, string> = {
  alpha: 'Name (A–Z)',
  'date-desc': 'Newest first',
  'date-asc': 'Oldest first',
}

/**
 * Sort a copy of `items` by name or date. ISO timestamps compare
 * lexicographically (= chronologically); an empty date sorts oldest.
 */
export function sortItems<T>(
  items: ReadonlyArray<T>,
  sort: SortKey,
  get: { name: (item: T) => string; date: (item: T) => string },
): Array<T> {
  const arr = [...items]
  if (sort === 'alpha') {
    arr.sort((a, b) => get.name(a).localeCompare(get.name(b)))
  } else {
    arr.sort((a, b) => {
      const cmp = get.date(a).localeCompare(get.date(b))
      return sort === 'date-asc' ? cmp : -cmp
    })
  }
  return arr
}

/** Short locale date for an ISO timestamp; '' when absent / invalid.
 *  Explicitly formatted for `navigator.language` (the OS UI language, in the
 *  desktop webview) rather than relying on `toLocaleDateString()`'s implicit
 *  default — EN reads MM/DD/YYYY, DE reads DD.MM.YYYY, etc. */
export function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(navigator.language)
}

/** Grid / list segmented toggle. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex items-center rounded-lg bg-muted p-[3px]">
      {([
        ['grid', LayoutGrid, 'Grid view'],
        ['list', List, 'List view'],
      ] as const).map(([mode, Icon, title]) => (
        <button
          key={mode}
          type="button"
          title={title}
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            'flex size-7 items-center justify-center rounded-md border border-transparent transition-[color,box-shadow]',
            value === mode
              ? 'bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  )
}

/** Sort-order dropdown. */
export function SortSelect({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortKey)}>
      <SelectTrigger className="h-8 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SORT_LABELS) as Array<SortKey>).map((key) => (
          <SelectItem key={key} value={key}>
            {SORT_LABELS[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * A labelled filter dropdown whose first option is "All <label>". `options` are
 * the concrete values; `value` is '' for "all". Rendered only by the caller when
 * there's more than one value to choose between.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  renderOption,
}: {
  label: string
  value: string
  options: ReadonlyArray<string>
  onChange: (v: string) => void
  renderOption?: (value: string) => string
}) {
  return (
    <Select value={value || '__all__'} onValueChange={(v) => onChange(v === '__all__' ? '' : v)}>
      <SelectTrigger className="h-8 w-auto min-w-28 gap-1">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">All {label}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {renderOption ? renderOption(opt) : opt}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The corner selection toggle overlaid on each overview card. Stops the click
 * from bubbling to the card's navigation. Always visible while a selection is
 * active; otherwise revealed on the card's `group` hover.
 */
export function SelectCheckbox({
  checked,
  onChange,
  selecting,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  /** True when any item is selected (keeps every box visible, not just on hover). */
  selecting: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={checked ? 'Deselect' : 'Select'}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        'flex size-5 items-center justify-center rounded-[5px] border transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input hover:border-foreground',
        !selecting && !checked && 'opacity-0 group-hover:opacity-100',
        className,
      )}
    >
      {checked && <Check className="size-3.5" />}
    </button>
  )
}

/**
 * The bulk-action bar for an overview's multi-select: count, select-all, clear,
 * and the destructive Delete that opens the confirm modal. A floating pill fixed
 * to the bottom-centre of the *viewport* (portaled to <body>) — it slides up
 * from below when `open` and back down when not, so it never shifts the page
 * layout. Pointer-events are disabled while hidden. Sits below modals (z-40).
 */
export function SelectionBar({
  open,
  count,
  total,
  noun,
  onSelectAll,
  onClear,
  onDelete,
  busy,
  className,
}: {
  /** Whether a selection is active (drives the slide-in / slide-out). */
  open: boolean
  count: number
  total: number
  /** Singular item noun, e.g. "project" / "character". */
  noun: string
  onSelectAll: () => void
  onClear: () => void
  onDelete: () => void
  busy: boolean
  /** Extra pill classes — e.g. a higher `bottom-*` on pages whose viewport
   *  bottom is occupied by a docked footer bar. */
  className?: string
}) {
  return createPortal(
    <div
      aria-hidden={!open}
      className={cn(
        'fixed bottom-6 left-1/2 z-40 -translate-x-1/2 transition-[transform,opacity] duration-300 ease-out',
        open
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-[calc(100%+7rem)] opacity-0',
        className,
      )}
    >
      <div className="flex items-center gap-1 rounded-full border bg-card/95 py-2 pr-2 pl-4 shadow-lg shadow-black/25 backdrop-blur">
        <span className="text-sm font-medium whitespace-nowrap">
          {count} {noun}
          {count === 1 ? '' : 's'} selected
        </span>
        <div className="mx-1 h-5 w-px bg-border" />
        {count < total && (
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={onSelectAll}
            disabled={busy}
          >
            <CheckCheck /> All ({total})
          </Button>
        )}
        <Button variant="ghost" size="sm" className="rounded-full" onClick={onClear} disabled={busy}>
          <X /> Clear
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="rounded-full"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 /> Delete
        </Button>
      </div>
    </div>,
    document.body,
  )
}
