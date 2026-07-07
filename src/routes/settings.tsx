import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowLeftIcon, ChevronRightIcon } from 'lucide-react'

import { useActiveWorkspace } from '#/components/workspace/workspace-settings'
import { cn } from '#/lib/utils'
import { workspaceAccessQuery } from '#/lib/workspace/access.functions'

export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ context, location }) => {
    const access = await context.queryClient.ensureQueryData(
      workspaceAccessQuery(),
    )

    if (!access.user) {
      context.queryClient.removeQueries(workspaceAccessQuery())
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: SettingsLayout,
})

const NAV_LINK_CLASS =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--workspace-ink-soft)] no-underline hover:bg-[var(--workspace-hover)]'

function SettingsLayout() {
  const { workspace } = useActiveWorkspace()

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="hidden min-h-screen flex-col bg-[var(--workspace-side)] p-3 lg:flex">
        <Link
          to="/"
          className="mb-4 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-[var(--workspace-ink-soft)] no-underline hover:bg-[var(--workspace-hover)]"
        >
          <ArrowLeftIcon className="size-4" />
          Back to workspace
        </Link>

        <p className="px-2 pb-1 text-xs font-bold tracking-wide text-[var(--workspace-ink-soft)] uppercase">
          Settings
        </p>
        <nav className="flex flex-col gap-0.5">
          <Link
            to="/settings"
            activeOptions={{ exact: true }}
            className={NAV_LINK_CLASS}
            activeProps={{
              className: cn(
                NAV_LINK_CLASS,
                'bg-[var(--workspace-hover)] font-semibold text-[var(--workspace-ink)]',
              ),
            }}
          >
            General
          </Link>
          <Link
            to="/settings/members"
            className={NAV_LINK_CLASS}
            activeProps={{
              className: cn(
                NAV_LINK_CLASS,
                'bg-[var(--workspace-hover)] font-semibold text-[var(--workspace-ink)]',
              ),
            }}
          >
            Members
          </Link>
        </nav>
      </aside>

      <main className="min-w-0 border-l border-[var(--workspace-line)] bg-[var(--workspace-paper)]">
        <header className="flex h-14 items-center gap-1 border-b border-[var(--workspace-line)] px-6 text-sm">
          <Link
            to="/"
            className="text-[var(--workspace-ink-soft)] no-underline hover:text-[var(--workspace-ink)]"
          >
            {workspace?.name ?? 'Workspace'}
          </Link>
          <ChevronRightIcon className="size-3.5 text-[var(--workspace-ink-soft)]" />
          <span className="font-semibold">Settings</span>
        </header>

        <div className="mx-auto w-full max-w-3xl px-6 py-8 md:px-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
