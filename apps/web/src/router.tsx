import { Link, createRouter as createTanStackRouter } from '@tanstack/react-router'

import { Button } from '@dth/ui'

import { routeTree } from './routeTree.gen'

/**
 * App-styled not-found page, mirroring the root route's errorComponent. Routes
 * throw notFound() when a record no longer resolves — and that is reachable in
 * NORMAL use, because a project's route param IS its folder path: move, rename
 * or delete the folder in Explorer and the URL dead-ends. TanStack's bare
 * default rendered that dead end unstyled and with no way back; unlike the
 * error boundary the router itself is healthy here, so a real Link home works.
 */
function DefaultNotFoundComponent() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The project or character could not be found at this path. Its folder may have been
          moved, renamed or deleted outside the studio — if so, open it again from the Home
          screen (or re-open the <code className="rounded bg-muted px-1 py-0.5 text-xs">.dcsp</code>{' '}
          file at its new location).
        </p>
        <div className="mt-4">
          <Button asChild>
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </div>
    </main>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: DefaultNotFoundComponent,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
