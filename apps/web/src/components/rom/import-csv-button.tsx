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
        <Upload /> Import from Daz scene
      </Button>
      <InfoPopup size="sm" label="Import from Daz scene — how it works">
        Pick a Daz scene and the studio scans its keyed frames for you: it opens the scene in
        Daz Studio, runs <strong>Scan_Frames</strong> there, and imports the result — each
        frame becomes a pose. Scans you already made are listed too, so one scan can feed
        several ROM sections.{' '}
        <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/04-first-character.html#recommended-scan-once-then-autocomplete--tools--scan--index">
          Open guide
        </GuideLink>
      </InfoPopup>
    </span>
  )
}
