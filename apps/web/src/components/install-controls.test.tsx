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

  it('groups asset steps per folder; only folders with updates start expanded', () => {
    const report: InstallReport = {
      dryRun: true,
      totalFiles: 3,
      steps: [
        step({ label: 'X:/assets/_genesis 9', status: 'header' }),
        step({ label: '67582_Meipe.zip', detail: 'already installed · 2147 files' }),
        step({ label: '67091_Meipe.zip', detail: 'already installed · 1436 files' }),
        step({ label: 'X:/assets/other', status: 'header' }),
        step({ label: 'new-thing.zip', status: 'ok', files: 3, detail: '3/3 files to copy' }),
        step({ label: 'old-thing.zip', detail: 'already installed · 9 files' }),
      ],
    }
    render(<InstallReportList report={report} />)

    // Each source folder renders as its own <details> group with the header
    // (+ asset count) as the toggle. The all-skipped folder starts collapsed;
    // the one with files to copy starts open.
    const genesis = screen.getByText(/_genesis 9/).closest('details') as HTMLDetailsElement
    const other = screen.getByText(/assets(\/|\\)other/).closest('details') as HTMLDetailsElement
    expect(document.querySelectorAll('details')).toHaveLength(2)
    expect(genesis.open).toBe(false)
    expect(other.open).toBe(true)
    expect(screen.getAllByText('· 2 asset(s)')).toHaveLength(2)

    // Asset rows live inside their folder's group.
    expect(screen.getByText('67582_Meipe.zip').closest('details')).toBe(genesis)
    expect(screen.getByText('67091_Meipe.zip').closest('details')).toBe(genesis)
    expect(screen.getByText('old-thing.zip').closest('details')).toBe(other)
  })

  it('expands a folder whose scan hit an error', () => {
    const report: InstallReport = {
      dryRun: true,
      totalFiles: 0,
      steps: [
        step({ label: 'X:/assets/broken', status: 'header' }),
        step({ label: 'corrupt.zip', status: 'error', detail: 'unzip failed' }),
      ],
    }
    render(<InstallReportList report={report} />)
    const group = screen.getByText(/broken/).closest('details') as HTMLDetailsElement
    expect(group.open).toBe(true)
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
