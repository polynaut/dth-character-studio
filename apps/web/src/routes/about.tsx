import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { open as openExternal } from '@tauri-apps/plugin-shell'

import { fetchAppVersion } from '#/lib/rom/api.ts'

const GITHUB_URL = 'https://github.com/polynaut/dth-character-studio'

export const Route = createFileRoute('/about')({
  loader: () => fetchAppVersion(),
  component: AboutPage,
})

function AboutPage() {
  const version = Route.useLoaderData()

  return (
    <main className="p-8">
      <div className="mb-6">
        <Link
          to="/"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> All projects
        </Link>
      </div>

      <div className="mx-auto flex max-w-xl flex-col items-center text-center">
        <img
          src="/logo512.png"
          alt="DTH Character Studio logo"
          className="size-40 select-none drop-shadow-lg"
          draggable={false}
        />
        <h1 className="mt-6 text-3xl font-bold">
          DTH Character Studio{' '}
          {version && <span className="text-muted-foreground">v{version}</span>}
        </h1>
        <p className="mt-4 max-w-prose leading-relaxed text-muted-foreground">
          A companion app for the DazToHue (DTH) workflow. Define a character's morphs and
          poses once, then generate the Daz scripts and PoseAsset data that drive a clean
          Daz&nbsp;→&nbsp;Houdini&nbsp;→&nbsp;Unreal character-ROM pipeline — so every character
          exports the same way, every time.
        </p>
        <p className="mt-12 max-w-prose leading-relaxed text-muted-foreground">
          Find the source, releases and issues on{' '}
          <a
            href={GITHUB_URL}
            onClick={(e) => {
              e.preventDefault()
              void openExternal(GITHUB_URL)
            }}
            className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
          >
            GitHub <ExternalLink className="size-3.5" />
          </a>
          .
        </p>
      </div>
    </main>
  )
}
