import { Upload } from 'lucide-react'

import { useNavigate } from '@tanstack/react-router'

import { Button, InfoPopup } from '@dth/ui'

/**
 * "Import from CSV" plus an info popup explaining where the CSV comes from:
 * DthScanFrames.dsa from the DazToHue-Scripts repo (installable in Tools), which
 * exports the full morph list of an open Daz scene as a CSV importable here.
 */
export function ImportCsvButton({ onImport }: { onImport: () => void }) {
  const navigate = useNavigate()
  return (
    <span className="inline-flex items-center gap-1">
      <Button variant="outline" size="sm" onClick={onImport}>
        <Upload /> Import from CSV
      </Button>
      <InfoPopup label="Import from CSV — how to produce the CSV">
        Import a DAZ morph CSV — each row becomes a pose. Generate it with{' '}
        <strong>DthScanFrames.dsa</strong>, which exports the full morph list of an open Daz scene.
        Install it from{' '}
        <a
          href="/tools"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void navigate({ to: '/tools', search: { tab: 'daztohue' } })
          }}
        >
          Tools → DazToHue-Scripts
        </a>
        , run it in Daz Studio on your scene, then import the CSV here.
      </InfoPopup>
    </span>
  )
}
