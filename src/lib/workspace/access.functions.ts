import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import type { WorkspaceAccess } from './access'
import { resolveWorkspaceAccess } from './access.server'
import { ensurePersonalWorkspace } from './personal-workspace.server'

export const getWorkspaceAccess = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WorkspaceAccess> =>
    resolveWorkspaceAccess(getRequestHeaders()),
)

/**
 * Guarantee the signed-in user owns at least one workspace, provisioning a
 * personal one if they belong to none. Used when a user ends up workspace-less
 * — e.g. after declining an invitation they signed up to accept. Returns the
 * resolved organization id (null only if the request is unauthenticated).
 */
export const ensurePersonalWorkspaceForCurrentUser = createServerFn({
  method: 'POST',
}).handler(async (): Promise<{ organizationId: string | null }> => {
  const access = await resolveWorkspaceAccess(getRequestHeaders())

  if (!access.user) {
    return { organizationId: null }
  }

  const organizationId = await ensurePersonalWorkspace(access.user.id, {
    name: access.user.name,
    email: access.user.email,
  })

  return { organizationId }
})

/**
 * Cached access check for route guards. Login and logout both leave through
 * `window.location.assign` (a full page load with a fresh QueryClient), so a
 * cached result can never outlive the session it was resolved from — route
 * `beforeLoad`s reuse it instead of paying a server round trip on every
 * navigation.
 */
export const workspaceAccessQuery = () =>
  queryOptions({
    queryKey: ['auth', 'access'],
    queryFn: () => getWorkspaceAccess(),
    staleTime: 5 * 60 * 1000,
  })
