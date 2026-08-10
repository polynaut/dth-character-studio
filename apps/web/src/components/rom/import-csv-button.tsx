import { Upload } from 'lucide-react'

import { Button, InfoPopup } from '@dth/ui'
import { GuideLink } from '#/components/guide-link.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'

/**
 * "Import from Daz scene" plus an info popup explaining what it does: the studio
 * opens the picked scene in Daz through the job runner, runs the bundled
 * `Scan_Frames` there with no dialogs, and imports the CSV that comes back.
 * Scans already made are listed in the dialog too — one scan feeds several ROM
 * sections.
 *
 * Doubles as a DROP TARGET for a `.duf`, which is the shortest path there is:
 * drag the scene from Explorer onto the button and the dialog opens already
 * pointed at it.
 */
export function ImportCsvButton({
  onImport,
  onImportScene,
}: {
  onImport: () => void
  /** A `.duf` dropped straight on the button — opens the dialog with that scene
   *  already picked and checked, so the drop lands where it was aimed instead of
   *  opening an empty dialog to pick in again. */
  onImportScene: (scenePath: string) => void
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <FileDropZone
        accept={['duf']}
        label="Drop a Daz scene to scan"
        onDrop={(paths) => {
          const dropped = paths[0]
          if (dropped) onImportScene(dropped)
        }}
      >
        <Button variant="outline" size="sm" onClick={onImport}>
          <Upload /> Import from Daz scene
        </Button>
      </FileDropZone>
      <InfoPopup size="sm" label="Import from Daz scene — how it works">
        Pick a Daz scene and the studio scans its keyed frames for you: it opens the scene in
        Daz Studio, runs <strong>Scan_Frames</strong> there, and imports the result — each
        frame becomes a pose. Needs the <strong>Runner plugin</strong> (the same one DTH
        Export uses). Scans you already made are listed too, so one scan can feed several ROM
        sections.{' '}
        <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/custom-morphs.html">
          Open guide
        </GuideLink>
      </InfoPopup>
    </span>
  )
}
