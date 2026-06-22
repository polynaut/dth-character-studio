import type { CSSProperties } from 'react'
import { useEffect } from 'react'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Toaster, toast } from 'sonner'

import { ensureNetworkDrives, fetchPoseAssets } from '#/lib/rom/api.ts'
import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: RootComponent,
})

function RootComponent() {
  // On launch, re-map any known network drives that aren't currently available
  // (an elevated relaunch doesn't inherit the user's interactive mappings).
  useEffect(() => {
    void (async () => {
      const results = await ensureNetworkDrives()
      const remapped = results.filter((r) => r.status === 'remapped').map((r) => r.drive)
      const failed = results.filter((r) => r.status === 'failed')
      if (remapped.length > 0) toast.success(`Re-mapped network drive ${remapped.join(', ')}`)
      for (const f of failed) {
        toast.error(`Couldn't map ${f.drive} → ${f.unc}: ${f.detail}`)
      }
      // Warm the in-memory pose catalog now that any network drives are mapped
      // (the release often lives on a share) — so the first character open is
      // instant. Fire-and-forget; a failed scan isn't cached and just retries.
      void fetchPoseAssets()
    })()
  }, [])

  return (
    <>
      <Outlet />
      <Toaster
        theme="light"
        position="top-center"
        closeButton
        // Light-orange toast with dark text and a dark-orange border — the app's
        // brand orange (#fe5c01) family, kept legible on a light surface.
        style={
          {
            '--normal-bg': '#ffe3cc',
            '--normal-border': '#c2410c',
            '--normal-text': '#2b1200',
            '--border-radius': 'var(--radius)',
          } as CSSProperties
        }
        toastOptions={{
          classNames: {
            description: '!text-[#7a4a2c]',
            actionButton: '!bg-[#c2410c] !text-white',
            cancelButton: '!bg-black/10 !text-[#2b1200]',
            closeButton: '!border-[#c2410c]/40 !bg-[#ffd5b5] !text-[#2b1200] hover:!bg-[#ffc99e]',
          },
        }}
      />
      {/* Dev-only: never ship the devtools button to installed/end-user builds. */}
      {import.meta.env.DEV && (
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
      )}
    </>
  )
}
