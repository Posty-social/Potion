import { useSuspenseQuery } from '@tanstack/react-query'
import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { WorkspaceShell } from '#/components/workspace/workspace-shell'
import { getWorkspaceAccess } from '#/lib/workspace/access.functions'
import {
  workspacePageQuery,
  workspacePagesQuery,
} from '#/lib/workspace/functions'

export const Route = createFileRoute('/pages/$pageSlug')({
  beforeLoad: async ({ location }) => {
    const access = await getWorkspaceAccess()

    if (!access.user) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  loader: async ({ context, params }) => {
    const pages = await context.queryClient.ensureQueryData(
      workspacePagesQuery(),
    )

    if (!pages.some((page) => page.slug === params.pageSlug)) {
      throw notFound()
    }

    await context.queryClient.ensureQueryData(
      workspacePageQuery(params.pageSlug),
    )
  },
  notFoundComponent: PageNotFound,
  component: PageRoute,
})

function PageRoute() {
  const { pageSlug } = Route.useParams()
  const { data: page } = useSuspenseQuery(workspacePageQuery(pageSlug))
  const { data: pages } = useSuspenseQuery(workspacePagesQuery())

  return <WorkspaceShell page={page} pages={pages} />
}

function PageNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="flex max-w-md flex-col items-start gap-4 rounded-xl border border-[var(--workspace-line)] bg-[var(--workspace-paper)] p-6 shadow-sm">
        <h1 className="display-title text-2xl font-bold">Page not found</h1>
        <p className="text-muted-foreground text-sm leading-6">
          This page does not exist in your workspace, or you do not have access
          to it.
        </p>
        <Button asChild>
          <Link to="/">Back to workspace</Link>
        </Button>
      </section>
    </main>
  )
}
