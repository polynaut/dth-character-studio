import { useState } from 'react'

import { Button, Input, Label, Modal } from '@dth/ui'

/**
 * Frame-range picker shown after choosing a DAZ morph CSV. A full scene scan
 * (Scan_Frames.dsa) exports the whole ROM (frames 0…N), so this lets the user
 * import only the slice that matches the section they're importing into.
 * Defaults to the full range; the live count reflects the current selection.
 * Dialog semantics (focus trap/restore, Esc / backdrop dismissal) come from
 * the kit's Modal.
 */
export function CsvImportDialog({
  sectionLabel,
  frames,
  onConfirm,
  onClose,
}: {
  sectionLabel: string
  /** Available pose frame numbers, ascending (frames with no morphs are absent). */
  frames: Array<number>
  onConfirm: (start: number, end: number) => void
  onClose: () => void
}) {
  const min = frames[0] ?? 0
  const max = frames[frames.length - 1] ?? 0
  const [start, setStart] = useState(String(min))
  const [end, setEnd] = useState(String(max))

  const startNum = Math.trunc(Number(start))
  const endNum = Math.trunc(Number(end))
  const valid =
    start.trim() !== '' &&
    end.trim() !== '' &&
    Number.isFinite(startNum) &&
    Number.isFinite(endNum) &&
    startNum <= endNum
  const count = valid ? frames.filter((f) => f >= startNum && f <= endNum).length : 0
  const submit = () => {
    if (valid && count > 0) onConfirm(startNum, endNum)
  }

  return (
    <Modal open onClose={onClose} title={`Import into ${sectionLabel}`}>
      <p className="text-sm text-muted-foreground">
        The CSV holds frames {min}–{max}. Choose the range to import — frames outside it
        are skipped, so you only add the part matching this section.
      </p>
      <div className="flex gap-3">
        <div className="flex-1">
          <Label className="mb-1 block">Start frame</Label>
          <Input
            type="number"
            autoFocus
            value={start}
            min={min}
            max={max}
            onChange={(e) => setStart(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div className="flex-1">
          <Label className="mb-1 block">End frame</Label>
          <Input
            type="number"
            value={end}
            min={min}
            max={max}
            onChange={(e) => setEnd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {valid ? (
          <>
            <strong className="text-foreground">{count}</strong> morph{count === 1 ? '' : 's'} in
            range
          </>
        ) : (
          <span className="text-destructive">End frame must be ≥ start frame.</span>
        )}
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!valid || count === 0} onClick={submit}>
          Import{count > 0 ? ` ${count}` : ''}
        </Button>
      </div>
    </Modal>
  )
}
