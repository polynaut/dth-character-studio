import { Upload } from 'lucide-react'

import { Button, InfoPopup } from '@dth/ui'
import { GuideLink } from '#/components/guide-link.tsx'

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
      <InfoPopup size="sm" label="Import from CSV — how to produce the CSV">
        Import a DAZ morph CSV — each row becomes a pose; produce it with the bundled{' '}
        <strong>Scan_Frames</strong> script in Daz Studio.{' '}
        <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/04-first-character.html#recommended-scan-your-morphs-once-then-autocomplete--scanmorphsgenesisdsa">
          Open guide
        </GuideLink>
      </InfoPopup>
    </span>
  )
}
