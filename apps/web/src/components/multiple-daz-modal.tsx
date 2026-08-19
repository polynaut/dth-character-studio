/**
 * The "close one Daz Studio" dialog — what a refused batch handoff shows when
 * MORE than one Daz Studio is running (`MultipleDazInstancesError`, thrown by
 * `assertSingleDazInstance` before anything touched disk). Each installation
 * is single-instance, so two processes means two installations (a DS4 next to
 * a DS6) — and every one hosts a Runner watching the same job file, so the
 * run would start in whichever Daz noticed first. The fix is always the same:
 * close all but one and start the run again. A dialog rather than the generic
 * error toast because this is a state the user has to go DO something about,
 * not a message that may scroll away under the next one.
 */
import { Button, Modal } from '@dth/ui'

export function MultipleDazModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="More than one Daz Studio is running">
      <p className="text-sm text-muted-foreground">
        Two Daz Studio versions are open side by side. Both watch for DTH jobs, so this run would
        start in whichever Daz Studio notices it first — and their progress reports would get in
        each other&rsquo;s way.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Close all but one Daz Studio, then start the run again.
      </p>
      <div className="mt-4 flex justify-end">
        <Button onClick={onClose}>Got it</Button>
      </div>
    </Modal>
  )
}
