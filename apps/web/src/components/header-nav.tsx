import { Link } from '@tanstack/react-router'
import { BookOpen, Settings as SettingsIcon } from 'lucide-react'
import { openExternal } from '#/lib/desktop.ts'

// Desktop's shell-open scope (tauri.conf.json) permits any https:// URL
// generically, so polynaut.github.io needs no extra allowlisting there.
const DOCS_URL = 'https://polynaut.github.io/dth-character-studio/guide/index.html'

/**
 * The Docs + About + Tools + Settings links shown at the top-right of the projects
 * home and the project (character) overview headers. Kept in one component so both
 * stay in sync — including the `!` override on About/Docs that beats the global
 * unlayered `a { color: primary }` rule (styles.css) so they read as muted links.
 */
export function HeaderNav() {
  return (
    <div className="flex shrink-0 items-center gap-4">
      <button
        type="button"
        onClick={() => void openExternal(DOCS_URL)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground! underline-offset-4 hover:text-foreground! hover:underline"
      >
        <BookOpen className="size-4" /> Docs
      </button>
      <Link
        to="/about"
        className="text-sm text-muted-foreground! underline-offset-4 hover:text-foreground! hover:underline"
      >
        About
      </Link>
      <Link
        to="/tools"
        className="text-sm text-muted-foreground! underline-offset-4 hover:text-foreground! hover:underline"
      >
        Tools
      </Link>
      <Link
        to="/settings"
        className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <SettingsIcon className="size-4" /> Settings
      </Link>
    </div>
  )
}
