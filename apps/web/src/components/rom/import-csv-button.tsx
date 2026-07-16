import { Upload } from 'lucide-react'

import { Button, InfoPopup } from '@dth/ui'

/**
 * "Import from CSV" plus an info popup explaining where the CSV comes from: the
 * bundled Scan_Frames.dsa (installed at the DTH-Character-Studio scripts root)
 * exports the open Daz scene's keyed morph frames into the studio's scan
 * folder, and the import picker lists those scans.
 */
export function ImportCsvButton({ onImport }: { onImport: () => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="outline" size="sm" onClick={onImport}>
        <Upload /> Import from CSV
      </Button>
      <InfoPopup label="Import from CSV — how to produce the CSV">
        Import a DAZ morph CSV — each row becomes a pose. Produce it with{' '}
        <strong>Scan_Frames</strong> (installed with the studio's other scripts under{' '}
        <code>Scripts&nbsp;›&nbsp;DTH-Character-Studio</code>): select your character's root node
        in Daz Studio, run the script, and the scan shows up here automatically — one CSV per
        scene. You can also browse to a CSV you curated yourself.
      </InfoPopup>
    </span>
  )
}
