import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, BookOpen, ExternalLink, Globe } from 'lucide-react'
import { openExternal } from '#/lib/desktop.ts'
import { Button } from '@dth/ui'

import { detectAssetVersions, fetchAppVersion } from '#/lib/rom/api.ts'

const GITHUB_URL = 'https://github.com/polynaut/dth-character-studio'
const DISCUSSIONS_URL = `${GITHUB_URL}/discussions`
const LANDING_URL = 'https://polynaut.github.io/dth-character-studio/'
const DOCS_URL = `${LANDING_URL}guide/index.html`

export const Route = createFileRoute('/about')({
  loader: async () => ({
    version: await fetchAppVersion(),
    // Best-effort — a failed detection just hides the assets summary.
    assets: await detectAssetVersions().catch(() => null),
  }),
  component: AboutPage,
})

function AboutPage() {
  const { version, assets } = Route.useLoaderData()
  const router = useRouter()

  // The bug form's "App version" field (id: version) prefills via query param.
  const reportUrl = `${GITHUB_URL}/issues/new?template=bug_report.yml${
    version ? `&version=${encodeURIComponent(`v${version}`)}` : ''
  }`

  // About is reachable from several places, so go back to wherever we came from
  // (falling back to the projects home if there's no history to pop).
  function goBack() {
    if (router.history.canGoBack()) router.history.back()
    else void router.navigate({ to: '/' })
  }

  return (
    <main className="p-8">
      <div className="mb-6">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
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
        <p className="mt-6 max-w-prose leading-relaxed text-muted-foreground">
          The bundled Daz runtime descends from <strong>DazToHue-Scripts</strong> by Soltude —
          everything the workflow needs ships with the studio; there is nothing extra to install.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button variant="outline" size="lg" onClick={() => void openExternal(LANDING_URL)}>
            <Globe className="size-4" /> Landing page
          </Button>
          <Button variant="outline" size="lg" onClick={() => void openExternal(DOCS_URL)}>
            <BookOpen className="size-4" /> Docs
          </Button>
        </div>
        {assets && assets.total > 0 && (
          <p className="mt-6 max-w-prose leading-relaxed text-muted-foreground">
            {assets.refreshNeeded ? (
              <>
                Generated assets: <strong className="text-foreground">refresh recommended</strong> —{' '}
                {assets.staleCount} of {assets.total} character
                {assets.total === 1 ? '' : 's'} need updating.{' '}
              </>
            ) : (
              <>Generated assets are up to date (runtime v{assets.app.runtime}). </>
            )}
            <Link
              to="/tools"
              search={{ tab: 'refresh' }}
              className="font-medium text-primary underline underline-offset-2"
            >
              Refresh assets
            </Link>
            .
          </p>
        )}
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
        <p className="mt-4 max-w-prose leading-relaxed text-muted-foreground">
          Something broke?{' '}
          <a
            href={reportUrl}
            onClick={(e) => {
              e.preventDefault()
              void openExternal(reportUrl)
            }}
            className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
          >
            Report a problem <ExternalLink className="size-3.5" />
          </a>{' '}
          — the form arrives prefilled with your app version. For how-to questions, head to{' '}
          <a
            href={DISCUSSIONS_URL}
            onClick={(e) => {
              e.preventDefault()
              void openExternal(DISCUSSIONS_URL)
            }}
            className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
          >
            Discussions <ExternalLink className="size-3.5" />
          </a>
          .
        </p>
      </div>
    </main>
  )
}
