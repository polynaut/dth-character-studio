// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExportTaskList } from './export-pipeline-panel'

import type { ExportTask, ExportTaskKind } from './export-pipeline-panel'

// Finished work leaves the run's list: the tick lands, gets a beat to be SEEN,
// then the row animates out and the queue closes up over it. The two halves
// are separately load-bearing — a row that vanished on the same frame as its
// tick would read as work disappearing unmarked, and a row that never left
// would push the rest of the run out of a five-row box behind jobs that are
// over.
//
// The numbers are duplicated here on purpose. The component's constants are
// module-private, and a test that imported them could only ever prove the
// component agrees with itself; these are the durations a USER experiences,
// and changing them should have to be done twice, deliberately.
const DWELL_MS = 1100
const EXIT_MS = 420

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function task(
  id: string,
  status: ExportTask['status'],
  kind: ExportTaskKind = 'daz',
): ExportTask {
  return { id, label: id, kind, status }
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-task]')].map((el) => el.getAttribute('data-task'))

/** Advance timers inside `act` — the retirement lands via setState from a
 *  timer, so React has to be told the world moved. */
const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

describe('a finished row wears its tick, then leaves', () => {
  it('keeps a done row on the list for the whole dwell', async () => {
    const { container } = render(
      <ExportTaskList tasks={[task('daz:a', 'done'), task('hou:b', 'active', 'houdini')]} />,
    )
    expect(rows(container)).toEqual(['hou:b', 'daz:a'])

    // One frame short of the dwell: still there, still ticked. This is the
    // whole point of the delay — the acknowledgement has to be seen.
    await tick(DWELL_MS - 50)
    expect(rows(container)).toEqual(['hou:b', 'daz:a'])
    expect(container.querySelector('[data-task="daz:a"]')?.getAttribute('data-task-status')).toBe(
      'done',
    )
    expect(container.querySelector('[data-task-leaving]')).toBeNull()
  })

  it('animates the row out, and only then drops it', async () => {
    const { container } = render(
      <ExportTaskList tasks={[task('daz:a', 'done'), task('hou:b', 'active', 'houdini')]} />,
    )

    // Dwell over: the row is LEAVING — still in the DOM, wearing the exit
    // animation. Dropping it here instead would cut the animation to nothing.
    await tick(DWELL_MS)
    const leaving = container.querySelector('[data-task="daz:a"]')
    expect(leaving).not.toBeNull()
    expect(leaving?.hasAttribute('data-task-leaving')).toBe(true)
    expect(leaving?.className).toContain('task-retire')

    // …and gone once the animation has run.
    await tick(EXIT_MS)
    expect(rows(container)).toEqual(['hou:b'])
  })

  it('leaves a FAILED row alone, forever — it is the row that must be seen', async () => {
    const { container } = render(
      <ExportTaskList tasks={[task('daz:a', 'failed'), task('hou:b', 'active', 'houdini')]} />,
    )
    await tick(DWELL_MS + EXIT_MS + 10_000)
    expect(rows(container)).toEqual(['hou:b', 'daz:a'])
    expect(container.querySelector('[data-task="daz:a"]')?.getAttribute('data-task-status')).toBe(
      'failed',
    )
  })

  it('a waiting row that has not finished stays put', async () => {
    const { container } = render(
      <ExportTaskList tasks={[task('daz:a', 'active'), task('hou:b', 'waiting', 'houdini')]} />,
    )
    await tick(DWELL_MS + EXIT_MS + 5_000)
    expect(rows(container)).toEqual(['hou:b', 'daz:a'])
  })
})

describe('retirement is memory, not a redraw', () => {
  it('a retired row does NOT come back when the poll re-reports it as done', async () => {
    // The run keeps every finished job in its record and re-reports it `done`
    // on every 2.5 s poll for the rest of the run. Without memory the row
    // would retire, be re-added by the next poll, retire again — a list that
    // blinks.
    const done = [task('daz:a', 'done'), task('hou:b', 'active', 'houdini')]
    const { container, rerender } = render(<ExportTaskList tasks={done} />)
    await tick(DWELL_MS + EXIT_MS)
    expect(rows(container)).toEqual(['hou:b'])

    // A fresh array with the same content, as every poll produces.
    rerender(<ExportTaskList tasks={[task('daz:a', 'done'), task('hou:b', 'active', 'houdini')]} />)
    await tick(5_000)
    expect(rows(container)).toEqual(['hou:b'])
  })

  it('FORGETS an id the run no longer lists, so the next run shows it again', async () => {
    // A leg cleared wholesale (the Daz cards drop at the Houdini baton pass),
    // or a whole new run in the same panel. Remembering across that would make
    // the scene's row never appear at all the second time.
    const { container, rerender } = render(<ExportTaskList tasks={[task('daz:a', 'done')]} />)
    await tick(DWELL_MS + EXIT_MS)
    expect(rows(container)).toEqual([])

    rerender(<ExportTaskList tasks={[task('hou:b', 'active', 'houdini')]} />)
    await tick(10)
    rerender(<ExportTaskList tasks={[task('daz:a', 'waiting')]} />)
    await tick(10)
    expect(rows(container)).toEqual(['daz:a'])
  })
})

describe('the ordinal counts the RUN, not the list', () => {
  it('a surviving row keeps its number after earlier rows retire', async () => {
    // "3." is the run's third job whether or not jobs 1 and 2 are still on
    // screen. Renumbering as rows left would make the list say a different
    // thing about the same work every few seconds.
    const { container } = render(
      <ExportTaskList
        tasks={[
          task('daz:a', 'done'),
          task('hou:b', 'done', 'houdini'),
          task('ue:c', 'active', 'unreal'),
        ]}
      />,
    )
    expect(container.querySelector('[data-task="ue:c"]')?.textContent).toContain('3.')

    await tick(DWELL_MS + EXIT_MS)
    expect(rows(container)).toEqual(['ue:c'])
    expect(container.querySelector('[data-task="ue:c"]')?.textContent).toContain('3.')
  })
})

describe('the panel is torn down mid-dwell', () => {
  it('does not fire a retirement into a dead component', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<ExportTaskList tasks={[task('daz:a', 'done')]} />)
    unmount()
    await tick(DWELL_MS + EXIT_MS + 1_000)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
