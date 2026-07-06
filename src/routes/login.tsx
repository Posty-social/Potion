import { Link, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '#/components/ui/button'

const loginSearchSchema = z.object({
  redirect: z.string().optional(),
})

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  component: LoginRoute,
})

function LoginRoute() {
  const { redirect } = Route.useSearch()

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--workspace-bg)] px-4 text-[var(--workspace-ink)]">
      <section className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-[var(--workspace-line)] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-semibold">
            Sign in required
          </p>
          <h1 className="display-title text-3xl font-bold">
            Private workspace
          </h1>
          <p className="text-muted-foreground text-sm leading-6">
            Production workspaces use Better Auth before loading private pages.
            Local verification leaves this gate off until credentials are
            supplied.
          </p>
        </div>
        <div className="rounded-md bg-[var(--workspace-muted)] p-3 text-xs text-[var(--workspace-ink-soft)]">
          {redirect ?? '/pages/private-workspace?view=table'}
        </div>
        <Button asChild>
          <Link
            to="/pages/$pageSlug"
            params={{ pageSlug: 'private-workspace' }}
            search={{ view: 'table' }}
          >
            Open local workspace
          </Link>
        </Button>
      </section>
    </main>
  )
}
