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
        theme="dark"
        position="bottom-right"
        closeButton
        // Match the app's dark panels with an orange accent instead of Sonner's
        // default green/red rich-color fills, which clashed with the UI.
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-border': 'var(--primary)',
            '--normal-text': 'var(--foreground)',
            '--border-radius': 'var(--radius)',
          } as CSSProperties
        }
        toastOptions={{
          classNames: {
            description: 'text-muted-foreground',
            actionButton: 'bg-primary text-primary-foreground',
            cancelButton: 'bg-muted text-muted-foreground',
            closeButton: 'bg-popover border-border text-muted-foreground hover:text-foreground',
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
