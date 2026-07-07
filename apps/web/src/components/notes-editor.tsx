import { useEffect, useRef, useState } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import { toast } from 'sonner'

import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs.tsx'
import { openExternal } from '#/lib/desktop.ts'
import {
  addNoteMedia,
  fetchNotes,
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
 * Freeform markdown notes for a project or character — write/preview tabs, a
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
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimer = useRef(0)
  // The latest text, for unmount-flush without re-subscribing the effect.
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    let active = true
    void fetchNotes({ data: { projectId, characterId } }).then((t) => {
      if (!active) return
      setText(t)
      setLoaded(true)
    })
    return () => {
      active = false
    }
  }, [projectId, characterId])

  async function persist(value: string) {
    setSaveState('saving')
    try {
      await saveNotes({ data: { projectId, characterId, text: value } })
      setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      toast.error(e instanceof Error ? e.message : String(e))
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
        void saveNotes({ data: { projectId, characterId, text: textRef.current } }).catch(() => {})
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
      <div className="flex items-center gap-3">
        <Tabs value={mode} onValueChange={(v) => setMode(v === 'preview' ? 'preview' : 'write')}>
          <TabsList>
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="ml-auto text-xs text-muted-foreground">
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : loaded && text ? 'Saved' : ''}
        </span>
      </div>
      {mode === 'write' ? (
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
            placeholder={
              placeholder ??
              'Write notes in markdown — drop images or other files right into the editor…'
            }
            className="min-h-64 w-full resize-y rounded-md border bg-muted/40 p-3 font-mono text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
            onChange={(e) => scheduleSave(e.target.value)}
            onBlur={() => {
              window.clearTimeout(saveTimer.current)
              saveTimer.current = 0
              void persist(textRef.current)
            }}
          />
        </FileDropZone>
      ) : (
        <div className="min-h-64 rounded-md border bg-card p-4 text-sm text-muted-foreground">
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
                    <h3 className="pt-1 text-base font-semibold text-foreground">{children}</h3>
                  ),
                  h2: ({ children }) => (
                    <h4 className="pt-1 text-sm font-semibold text-foreground">{children}</h4>
                  ),
                  h3: ({ children }) => (
                    <h5 className="pt-1 text-sm font-semibold text-foreground">{children}</h5>
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
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
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
            <p className="text-xs">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
