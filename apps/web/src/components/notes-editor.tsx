import { useEffect, useRef, useState } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import { Check, Pencil } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@dth/ui'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { openExternal } from '#/lib/desktop.ts'
import {
  addNoteMedia,
  fetchNotes,
  NotesConflictError,
  openNoteMedia,
  resolveNoteMedia,
  saveNotes,
} from '#/lib/rom/api.ts'

/** Debounce for autosave while typing (blur saves immediately). */
const SAVE_DEBOUNCE_MS = 800

/** A `media://<file>` reference's bare filename, or null for other URLs. */
function mediaRef(src: string | undefined): string | null {
  return src?.startsWith('media://') ? src.slice('media://'.length) : null
}

/** Renders a `media://` image by resolving it to a data URL (async). */
function NoteImage({ projectId, src, alt }: { projectId: string; src?: string; alt?: string }) {
  const [url, setUrl] = useState('')
  const ref = mediaRef(src)
  useEffect(() => {
    let active = true
    if (!ref) return
    resolveNoteMedia({ data: { projectId, fileName: ref } })
      .then((u) => active && setUrl(u))
      .catch(() => active && setUrl(''))
    return () => {
      active = false
    }
  }, [projectId, ref])
  if (!ref) return <img src={src} alt={alt} className="max-w-full rounded-md" />
  if (!url) return <span className="text-xs text-muted-foreground">[{alt || 'image'}]</span>
  return <img src={url} alt={alt} className="max-w-full rounded-md" />
}

/**
 * Freeform markdown notes for a project or character — rendered markdown by
 * default with a hover pencil to edit (Done/Esc returns to the view), a
 * debounced autosave, and native drag-and-drop for media: a dropped file is
 * stored in the project's `.dcsmeta/media/` (like avatar images) and the right
 * markdown tag (image or link) lands at the cursor. `media://` images resolve
 * in the preview; other media opens with its default app.
 */
export function NotesEditor({
  projectId,
  characterId,
  placeholder,
}: {
  projectId: string
  characterId?: string
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [mode, setMode] = useState<'write' | 'preview'>('preview')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimer = useRef(0)
  // The latest text, for unmount-flush without re-subscribing the effect.
  const textRef = useRef(text)
  textRef.current = text
  // The notes file's mtime as loaded / last written — threaded through every
  // save so a concurrent edit from another window conflicts instead of being
  // silently overwritten.
  const mtimeRef = useRef<number | null>(null)
  // One error toast per failure burst: debounced saves fire on every typing
  // pause, and a persistent failure must not stack a toast per keystroke.
  const saveFailedRef = useRef(false)

  useEffect(() => {
    let active = true
    void fetchNotes({ data: { projectId, characterId } }).then(({ text: stored, mtime }) => {
      if (!active) return
      mtimeRef.current = mtime
      saveFailedRef.current = false
      setText(stored)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [projectId, characterId])

  /** Load the disk version into the editor, discarding the local draft. */
  async function reloadFromDisk() {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = 0
    const { text: stored, mtime } = await fetchNotes({ data: { projectId, characterId } })
    mtimeRef.current = mtime
    saveFailedRef.current = false
    setText(stored)
    setSaveState('saved')
  }

  /** Toast a save failure (once per burst); a conflict offers Reload instead
   *  of auto-clobbering (no reload offer from the unmount flush — there's no
   *  editor left to reload into). */
  function reportSaveError(e: unknown, offerReload: boolean) {
    if (saveFailedRef.current) return
    saveFailedRef.current = true
    if (e instanceof NotesConflictError) {
      toast.error(
        'Notes changed on disk — probably another window.',
        offerReload
          ? {
              duration: 10_000,
              action: { label: 'Reload', onClick: () => void reloadFromDisk() },
            }
          : undefined,
      )
    } else {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function persist(value: string) {
    setSaveState('saving')
    try {
      mtimeRef.current = await saveNotes({
        data: { projectId, characterId, text: value, expectedMtime: mtimeRef.current },
      })
      saveFailedRef.current = false
      setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      reportSaveError(e, true)
    }
  }

  function scheduleSave(value: string) {
    setText(value)
    setSaveState('saving')
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void persist(value), SAVE_DEBOUNCE_MS)
  }

  // Flush a pending debounce on unmount so the last keystrokes never get lost.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        void saveNotes({
          data: { projectId, characterId, text: textRef.current, expectedMtime: mtimeRef.current },
        })
          .then((mtime) => {
            mtimeRef.current = mtime
            saveFailedRef.current = false
          })
          .catch((e: unknown) => reportSaveError(e, false))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, characterId])

  async function onDropMedia(paths: Array<string>) {
    const snippets: Array<string> = []
    for (const path of paths) {
      try {
        const { markdown } = await addNoteMedia({ data: { projectId, sourcePath: path } })
        snippets.push(markdown)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      }
    }
    if (!snippets.length) return
    const area = areaRef.current
    const at = area ? area.selectionStart : text.length
    const before = text.slice(0, at)
    const after = text.slice(at)
    const insert = `${before && !before.endsWith('\n') ? '\n' : ''}${snippets.join('\n')}\n`
    const next = before + insert + after
    scheduleSave(next)
    setMode('write')
    // Put the cursor after the inserted tags once the textarea re-renders.
    requestAnimationFrame(() => {
      area?.focus()
      area?.setSelectionRange(at + insert.length, at + insert.length)
    })
  }

  return (
    <div className="space-y-2">
      {mode === 'write' ? (
        <>
          <div className="flex items-center gap-3">
            <span className="ml-auto text-xs text-muted-foreground">
              {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
            </span>
            <Button variant="outline" size="sm" onClick={() => setMode('preview')}>
              <Check /> Done
            </Button>
          </div>
          <FileDropZone
            acceptFolders
            onDrop={(paths) => void onDropMedia(paths)}
            label="Drop images / media to embed"
            className="rounded-md"
          >
            <textarea
              ref={areaRef}
              value={text}
              disabled={!loaded}
              autoFocus
              // Notes are prose — keep spellcheck on here, overriding the app-wide
              // `spellcheck="false"` (index.html) that quiets the technical fields.
              spellCheck
              placeholder={
                placeholder ??
                'Write notes in markdown — drop images or other files right into the editor…'
              }
              className="min-h-64 w-full resize-y rounded-md border bg-muted/40 p-3 font-mono text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
              onChange={(e) => scheduleSave(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setMode('preview')
              }}
              onBlur={() => {
                window.clearTimeout(saveTimer.current)
                saveTimer.current = 0
                void persist(textRef.current)
              }}
            />
          </FileDropZone>
        </>
      ) : (
        // Rendered markdown is the DEFAULT view; a small pencil appears on
        // hover (an empty note is fully clickable) to switch into the editor.
        <div className="group/notes relative min-h-32 rounded-md border bg-card p-4 text-base text-muted-foreground">
          {text.trim() ? (
            <div className="space-y-2 [overflow-wrap:anywhere]">
              <Markdown
                // react-markdown's default transform strips unknown URL schemes —
                // our media:// references must survive it (they never leave the
                // preview: images resolve to data URLs, links shell-open).
                urlTransform={(url) =>
                  url.startsWith('media://') ? url : defaultUrlTransform(url)
                }
                components={{
                  h1: ({ children }) => (
                    <h3 className="pt-1 text-xl font-semibold text-foreground">{children}</h3>
                  ),
                  h2: ({ children }) => (
                    <h4 className="pt-1 text-lg font-semibold text-foreground">{children}</h4>
                  ),
                  h3: ({ children }) => (
                    <h5 className="pt-1 text-base font-semibold text-foreground">{children}</h5>
                  ),
                  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
                  ol: ({ children }) => (
                    <ol className="list-decimal space-y-1 pl-5">{children}</ol>
                  ),
                  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  strong: ({ children }) => (
                    <strong className="font-semibold text-foreground">{children}</strong>
                  ),
                  code: ({ children }) => (
                    <code className="rounded bg-muted px-1 py-0.5 text-sm">{children}</code>
                  ),
                  img: ({ src, alt }) => (
                    <NoteImage projectId={projectId} src={typeof src === 'string' ? src : undefined} alt={alt} />
                  ),
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      className="text-primary underline underline-offset-2"
                      onClick={(e) => {
                        e.preventDefault()
                        const ref = mediaRef(href)
                        if (ref)
                          void openNoteMedia({ data: { projectId, fileName: ref } }).catch(
                            (err: unknown) =>
                              toast.error(err instanceof Error ? err.message : String(err)),
                          )
                        else if (href) void openExternal(href)
                      }}
                    >
                      {children}
                    </a>
                  ),
                  hr: () => <hr className="my-2 border-border" />,
                }}
              >
                {text}
              </Markdown>
            </div>
          ) : (
            // Empty: the whole box is a silent click-to-write target (the pencil
            // appears on hover; the textarea placeholder does the teaching).
            <button
              type="button"
              aria-label="Write notes"
              className="block h-24 w-full cursor-text"
              onClick={() => setMode('write')}
            />
          )}
          <Button
            variant="outline"
            size="icon-sm"
            title="Edit notes"
            aria-label="Edit notes"
            className="absolute top-2 right-2 opacity-0 transition-opacity group-hover/notes:opacity-100 focus-visible:opacity-100"
            onClick={() => setMode('write')}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
