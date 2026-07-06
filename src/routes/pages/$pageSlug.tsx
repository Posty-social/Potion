import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'

import { Button } from '#/components/ui/button'
import { WorkspaceShell } from '#/components/workspace/workspace-shell'
import {
  workspacePageQuery,
  workspacePagesQuery,
} from '#/lib/workspace/functions'
import { pageSearchSchema } from '#/lib/workspace/schemas'

export const Route = createFileRoute('/pages/$pageSlug')({
  validateSearch: pageSearchSchema,
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
  const search = Route.useSearch()
  const { data: page } = useSuspenseQuery(workspacePageQuery(pageSlug))
  const { data: pages } = useSuspenseQuery(workspacePagesQuery())

  return <WorkspaceShell page={page} pages={pages} search={search} />
}

function PageNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--workspace-bg)] px-4 text-[var(--workspace-ink)]">
      <section className="flex max-w-md flex-col items-start gap-4 rounded-lg border border-[var(--workspace-line)] bg-white p-6 shadow-sm">
        <p className="text-muted-foreground text-sm font-semibold">
          Page unavailable
        </p>
        <h1 className="display-title text-3xl font-bold">Nothing to show</h1>
        <p className="text-muted-foreground text-sm leading-6">
          This page does not exist in the workspace or you do not have access to
          it.
        </p>
        <Button asChild>
          <Link
            to="/pages/$pageSlug"
            params={{ pageSlug: 'private-workspace' }}
            search={{ view: 'table' }}
          >
            Open workspace
          </Link>
        </Button>
      </section>
    </main>
  )
}
