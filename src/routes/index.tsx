import { createFileRoute, redirect } from '@tanstack/react-router'

import {
  ensurePersonalWorkspaceForCurrentUser,
  workspaceAccessQuery,
} from '#/lib/workspace/access.functions'
import { ensureWorkspaceSeed } from '#/lib/workspace/functions'

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context, location }) => {
    const access = await context.queryClient.ensureQueryData(
      workspaceAccessQuery(),
    )

    if (!access.user) {
      context.queryClient.removeQueries(workspaceAccessQuery())
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    // A user can reach the app workspace-less if they signed up to consider an
    // invitation but never accepted or declined it (we defer personal-workspace
    // creation in that case). Landing on the app means they're going solo, so
    // provision a personal workspace, then drop the stale cached access so the
    // freshly seeded workspace is resolved.
    if (!access.organizationId) {
      await ensurePersonalWorkspaceForCurrentUser()
      context.queryClient.removeQueries(workspaceAccessQuery())
    }

    const { slug } = await ensureWorkspaceSeed()

    if (!slug) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    throw redirect({
      to: '/p/$pageSlug',
      params: { pageSlug: slug },
    })
  },
})
