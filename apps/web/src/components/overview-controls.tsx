import { Check, LayoutGrid, List, Trash2, X } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { cn } from '#/lib/utils.ts'

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

/** Grid / list segmented toggle. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex items-center rounded-md border p-0.5">
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
            'flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors',
            value === mode ? 'bg-muted text-foreground' : 'hover:text-foreground',
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
        'flex size-5 items-center justify-center rounded border bg-background/80 shadow-sm backdrop-blur transition-opacity',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-muted-foreground/40 hover:border-foreground',
        !selecting && !checked && 'opacity-0 group-hover:opacity-100',
        className,
      )}
    >
      {checked && <Check className="size-3.5" />}
    </button>
  )
}

/**
 * The bulk-action bar shown above an overview while ≥1 item is selected: the
 * count, select-all / clear, and the destructive Delete that opens the confirm
 * modal. Sticky so it stays reachable while scrolling a long list.
 */
export function SelectionBar({
  count,
  total,
  noun,
  onSelectAll,
  onClear,
  onDelete,
  busy,
}: {
  count: number
  total: number
  /** Singular item noun, e.g. "project" / "character". */
  noun: string
  onSelectAll: () => void
  onClear: () => void
  onDelete: () => void
  busy: boolean
}) {
  return (
    <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card/95 px-4 py-2 shadow-sm backdrop-blur">
      <span className="text-sm font-medium">
        {count} {noun}
        {count === 1 ? '' : 's'} selected
      </span>
      {count < total && (
        <Button variant="ghost" size="sm" onClick={onSelectAll} disabled={busy}>
          Select all ({total})
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
        <X /> Clear
      </Button>
      <div className="ml-auto">
        <Button variant="destructive" size="sm" onClick={onDelete} disabled={busy}>
          <Trash2 /> Delete
        </Button>
      </div>
    </div>
  )
}
