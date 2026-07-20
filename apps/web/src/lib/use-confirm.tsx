import { createContext, useCallback, useContext, useRef, useState } from 'react'

import { Button, Modal } from '@dth/ui'

import type { ReactNode } from 'react'

export interface ConfirmOptions {
  /** The dialog heading (accessible name). */
  title?: string
  /** Confirm-button text (e.g. "Leave", "Move folders"). Default "OK". */
  confirmLabel?: string
  /** Cancel-button text. Default "Cancel". */
  cancelLabel?: string
  /** Style the confirm button destructive (the default — these are "lose it?"
   *  prompts). Pass false for a neutral, non-destructive confirm. */
  destructive?: boolean
}

/** Opens the app's confirm modal and resolves to the user's choice. */
export type ConfirmFn = (message: ReactNode, opts?: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface ConfirmState extends ConfirmOptions {
  open: boolean
  message: ReactNode
}

const CLOSED: ConfirmState = { open: false, message: '' }

/**
 * App-styled, promise-based confirm — a drop-in for the native `confirm()` /
 * Tauri `ask()` so "leave and lose your changes?" and other yes/no prompts
 * render in the app's own {@link Modal} (theme, focus trap, Escape/backdrop =
 * cancel) instead of an OS dialog. Mounted once at the root next to the other
 * app-styled dialog hosts (see `UpdatePromptHost`); routes get the async
 * `confirm` via {@link useConfirm}.
 *
 * `confirm` is stable across renders, so a once-registered router blocker or a
 * Tauri window-close handler that captured it still drives the live prompt.
 * Escape / backdrop / a replacing prompt all resolve the pending promise to
 * `false` (the safe "don't lose it" answer).
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>(CLOSED)
  const resolveRef = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    setState(CLOSED)
    const resolve = resolveRef.current
    resolveRef.current = null
    resolve?.(value)
  }, [])

  const confirm = useCallback<ConfirmFn>((message, opts) => {
    return new Promise<boolean>((resolve) => {
      // A prompt already open (a second trigger): its awaiter gets a safe false
      // before this one replaces it.
      resolveRef.current?.(false)
      resolveRef.current = resolve
      setState({ open: true, message, ...opts })
    })
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={state.open} onClose={() => settle(false)} title={state.title ?? 'Confirm'}>
        <p className="text-sm whitespace-pre-line text-muted-foreground">{state.message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => settle(false)}>
            {state.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={state.destructive === false ? 'default' : 'destructive'}
            onClick={() => settle(true)}
          >
            {state.confirmLabel ?? 'OK'}
          </Button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  )
}

/** The app's confirm function. Must be called under a {@link ConfirmProvider}. */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used within a ConfirmProvider')
  return confirm
}
