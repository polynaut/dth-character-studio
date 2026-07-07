import Markdown from 'react-markdown'

import { openExternal } from '#/lib/desktop.ts'

/**
 * The release notes (changesets CHANGELOG markdown) rendered as real markdown.
 * react-markdown renders to React elements (no innerHTML) and fetches nothing,
 * so it stays within the strict CSP. Links open EXTERNALLY via openExternal —
 * never navigating the webview.
 *
 * Lives in its own module (default-exported) so the update dialog can
 * `React.lazy()` it: react-markdown's remark/micromark pipeline is the app's
 * heaviest dependency and must not ship in the startup chunk just because the
 * always-mounted UpdatePromptHost might one day show notes.
 */
export function ReleaseNotes({ markdown }: { markdown: string }) {
  return (
    <div className="space-y-2 [overflow-wrap:anywhere]">
      <Markdown
        components={{
          h1: ({ children }) => (
            <h3 className="pt-1 text-sm font-semibold text-foreground">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="pt-1 text-sm font-semibold text-foreground">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="pt-1 text-sm font-semibold text-foreground">{children}</h4>
          ),
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary underline underline-offset-2"
              onClick={(e) => {
                // Never navigate the webview — release notes link to GitHub.
                e.preventDefault()
                if (href) void openExternal(href)
              }}
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-2 border-border" />,
        }}
      >
        {markdown}
      </Markdown>
    </div>
  )
}

export default ReleaseNotes
