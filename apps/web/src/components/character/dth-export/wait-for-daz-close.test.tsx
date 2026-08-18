// @vitest-environment jsdom
/**
 * The wait-for-Daz-close modal's LOOP — the half of this feature that the
 * classifier tests can't reach.
 *
 * `classifyPendingHandoff` says what each tick means; everything that goes
 * wrong here is about what the loop DOES with that answer, and both shipped
 * bugs lived on this side: the old loop settled BEFORE awaiting the launch (one
 * rejection hung the modal forever with Daz never started), and it had no
 * terminal state (a finished batch left it spinning under the finish toast).
 * So the cases below are that loop's contract: a launch is only success once
 * the batch is really worked, every failure path is retried and eventually
 * spoken out loud, and every road ends in `onDone` or a message saying why not.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The modal's only two runtime imports from the api barrel.
vi.mock('#/lib/rom/api.ts', () => ({
  pendingExportHandoffState: vi.fn(),
  launchDazForPendingJobs: vi.fn(),
}))

import { launchDazForPendingJobs, pendingExportHandoffState } from '#/lib/rom/api.ts'
import { WaitForDazCloseModal } from './rows.tsx'

import type { PendingHandoffClass } from '#/lib/rom/execute-jobs.ts'

/** Feed the loop one state per tick; the last one repeats forever after. */
function states(...queue: Array<PendingHandoffClass>) {
  let i = 0
  vi.mocked(pendingExportHandoffState).mockImplementation(async () =>
    Promise.resolve(queue[Math.min(i++, queue.length - 1)]),
  )
}

/** Everything the dialog says right now — the kit's Modal is one Radix
 *  dialog, and the loop's only visible output is its title and body. */
function dialogText() {
  return screen.getByRole('dialog').textContent ?? ''
}

/** One second of the loop — the mount tick is `ticks(0)`. */
async function ticks(count: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(count * 1000)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(launchDazForPendingJobs).mockResolvedValue(true)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('WaitForDazCloseModal — the per-second loop', () => {
  it('launches once the process is gone, then holds on until the batch is worked', async () => {
    const onDone = vi.fn()
    states('waiting', 'launch', 'waiting', 'working')
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(0)
    expect(launchDazForPendingJobs).not.toHaveBeenCalled()
    await ticks(1)
    expect(launchDazForPendingJobs).toHaveBeenCalledTimes(1)
    // The launch is NOT the finish: a Daz that forwards into a not-fully-dead
    // instance and dies would have closed this modal on a lie.
    expect(onDone).not.toHaveBeenCalled()
    expect(dialogText()).toContain('Starting Daz Studio')
    await ticks(1)
    expect(onDone).not.toHaveBeenCalled()
    await ticks(1)
    // Worked after our launch — the caller's "Daz Studio started" toast is true.
    expect(onDone).toHaveBeenCalledWith(true)
  })

  it('launches again when the launched process dies unclaimed — after a pause, not every tick', async () => {
    const onDone = vi.fn()
    states('launch')
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(0)
    expect(launchDazForPendingJobs).toHaveBeenCalledTimes(1)
    // The next four ticks leave the launch alone: a launched Daz needs a moment
    // to reach the process probe, and relaunching into it stacks processes.
    await ticks(4)
    expect(launchDazForPendingJobs).toHaveBeenCalledTimes(1)
    await ticks(1)
    expect(launchDazForPendingJobs).toHaveBeenCalledTimes(2)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('stops launching after repeated attempts and says so, instead of spawning forever', async () => {
    const onDone = vi.fn()
    states('launch')
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(60)
    // Five attempts, then words — a Daz that cannot start must not become a
    // once-a-second process spawner behind a spinner that says "starting".
    expect(launchDazForPendingJobs).toHaveBeenCalledTimes(5)
    expect(dialogText()).toContain('isn’t picking the export up')
    expect(onDone).not.toHaveBeenCalled()
  })

  it('keeps retrying a rejected launch and names it as the launch after three failures', async () => {
    const onDone = vi.fn()
    states('launch')
    vi.mocked(launchDazForPendingJobs).mockRejectedValue(new Error('Daz Studio not found'))
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(0)
    // The bug this loop was written for: settling before the launch resolved.
    expect(onDone).not.toHaveBeenCalled()
    expect(dialogText()).not.toContain('failed')
    await ticks(2)
    // A rejected launch never counted as one, so the retry is immediate.
    expect(launchDazForPendingJobs).toHaveBeenCalledTimes(3)
    expect(dialogText()).toContain(
      'Starting Daz Studio failed — still retrying: Daz Studio not found',
    )
    expect(onDone).not.toHaveBeenCalled()
  })

  it('blames the state read, not the launch, when the read is what failed', async () => {
    const onDone = vi.fn()
    vi.mocked(pendingExportHandoffState).mockRejectedValue(new Error('EBUSY'))
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(2)
    expect(dialogText()).toContain('Checking on the export failed')
    expect(launchDazForPendingJobs).not.toHaveBeenCalled()
  })

  it('clears a reported problem once a tick gets through — the count is CONSECUTIVE', async () => {
    const onDone = vi.fn()
    vi.mocked(pendingExportHandoffState).mockRejectedValue(new Error('EBUSY'))
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(2)
    expect(dialogText()).toContain('Checking on the export failed')
    states('waiting')
    await ticks(1)
    expect(dialogText()).not.toContain('failed')
  })

  it('closes itself the moment the handoff is gone — never sits under the finish toast', async () => {
    const onDone = vi.fn()
    states('gone')
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(0)
    expect(onDone).toHaveBeenCalledWith(false)
    expect(launchDazForPendingJobs).not.toHaveBeenCalled()
  })

  it('stands down when a live Daz claimed late — worked, but not by our launch', async () => {
    const onDone = vi.fn()
    states('working')
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(0)
    // false: no "Daz Studio started" toast for a Daz this modal never started.
    expect(onDone).toHaveBeenCalledWith(false)
  })

  it('waits out a torn job file, but gives up on one that stays unreadable', async () => {
    const onDone = vi.fn()
    states('unreadable')
    render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(8)
    // A torn read is routine — the Runner rewrites the file per row.
    expect(onDone).not.toHaveBeenCalled()
    await ticks(1)
    // Ten seconds of it is not: nothing here can reclaim a batch that does not
    // parse, so the modal stands down and the export watch owns the dead run.
    expect(onDone).toHaveBeenCalledWith(false)
  })

  it('stops when unmounted — no tick after the modal is gone', async () => {
    const onDone = vi.fn()
    states('waiting')
    const view = render(<WaitForDazCloseModal onDone={onDone} onCancel={() => {}} />)
    await ticks(1)
    const calls = vi.mocked(pendingExportHandoffState).mock.calls.length
    view.unmount()
    await ticks(5)
    expect(vi.mocked(pendingExportHandoffState).mock.calls.length).toBe(calls)
  })
})
