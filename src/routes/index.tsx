import { createFileRoute, redirect } from '@tanstack/react-router'

import { getWorkspaceAccess } from '#/lib/workspace/access.functions'
import { ensureWorkspaceSeed } from '#/lib/workspace/functions'

export const Route = createFileRoute('/')({
  beforeLoad: async ({ location }) => {
    const access = await getWorkspaceAccess()

    if (!access.user) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    const { slug } = await ensureWorkspaceSeed()

    if (!slug) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }

    throw redirect({
      to: '/pages/$pageSlug',
      params: { pageSlug: slug },
    })
  },
})
