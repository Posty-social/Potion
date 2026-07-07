import {
  Link,
  createRouter as createTanStackRouter,
} from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

import { getContext } from './integrations/tanstack-query/root-provider'
import { routeTree } from './routeTree.gen'

function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="flex max-w-md flex-col items-start gap-4 rounded-xl border border-[var(--workspace-line)] bg-[var(--workspace-paper)] p-6 shadow-sm">
        <h1 className="display-title text-2xl font-bold">Page not found</h1>
        <p className="text-muted-foreground text-sm leading-6">
          That page does not exist. It may have been moved or deleted.
        </p>
        <Link
          to="/"
          className="rounded-md bg-[var(--accent-plum)] px-3 py-1.5 text-sm font-semibold text-white no-underline"
        >
          Back to workspace
        </Link>
      </section>
    </main>
  )
}

export function getRouter() {
  const context = getContext()

  const router = createTanStackRouter({
    routeTree,
    context,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultNotFoundComponent: NotFound,
  })

  setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
