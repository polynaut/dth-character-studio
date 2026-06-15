import type { CSSProperties } from 'react'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { Toaster } from 'sonner'

import TanStackQueryDevtools from '../integrations/tanstack-query/devtools'

import type { QueryClient } from '@tanstack/react-query'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  component: RootComponent,
})

function RootComponent() {
  return (
    <>
      <Outlet />
      <Toaster
        theme="light"
        position="bottom-center"
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
