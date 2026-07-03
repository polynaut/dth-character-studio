// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { InstallReportList } from './install-controls'

import type { InstallReport, InstallStep } from '#/lib/rom/api.ts'

function step(partial: Partial<InstallStep>): InstallStep {
  return { label: '', files: 0, status: 'skipped', detail: '', ...partial }
}

describe('InstallReportList', () => {
  afterEach(cleanup)

  it('groups asset steps under a collapsible, initially-open folder header', () => {
    const report: InstallReport = {
      dryRun: true,
      totalFiles: 0,
      steps: [
        step({ label: 'X:/assets/_genesis 9', status: 'header' }),
        step({ label: '67582_Meipe.zip', detail: 'already installed · 2147 files' }),
        step({ label: '67091_Meipe.zip', detail: 'already installed · 1436 files' }),
        step({ label: 'X:/assets/other', status: 'header' }),
        step({ label: 'thing.zip', detail: 'no Daz content' }),
      ],
    }
    render(<InstallReportList report={report} />)

    // Each source folder renders as its own <details> group, open by default,
    // with the header (+ asset count) as the toggle.
    const groups = document.querySelectorAll('details')
    expect(groups).toHaveLength(2)
    for (const group of groups) expect(group.open).toBe(true)
    expect(screen.getByText(/_genesis 9/)).toBeTruthy()
    expect(screen.getByText('· 2 asset(s)')).toBeTruthy()
    expect(screen.getByText('· 1 asset(s)')).toBeTruthy()

    // Asset rows live inside their folder's group.
    const first = screen.getByText(/_genesis 9/).closest('details') as HTMLElement
    expect(screen.getByText('67582_Meipe.zip').closest('details')).toBe(first)
    expect(screen.getByText('67091_Meipe.zip').closest('details')).toBe(first)
    expect(screen.getByText('thing.zip').closest('details')).not.toBe(first)
  })

  it('renders reports without folder headers flat, with no collapsible group', () => {
    const report: InstallReport = {
      dryRun: false,
      totalFiles: 3,
      steps: [
        step({ label: 'Daz content', status: 'ok', files: 3, detail: '→ C:/lib' }),
        step({ label: 'Houdini assets', detail: 'not in release' }),
      ],
    }
    render(<InstallReportList report={report} />)
    expect(document.querySelectorAll('details')).toHaveLength(0)
    expect(screen.getByText('Daz content')).toBeTruthy()
    expect(screen.getByText('Houdini assets')).toBeTruthy()
  })
})
