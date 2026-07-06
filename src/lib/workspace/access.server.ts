import { getRuntimeEnv } from '#/lib/db/connection'

import { isWorkspaceAuthRequired, type WorkspaceAccess } from './access'

export async function resolveWorkspaceAccess(
  headers: Headers,
): Promise<WorkspaceAccess> {
  const authRequired = isWorkspaceAuthRequired(
    getRuntimeEnv().WORKSPACE_AUTH_REQUIRED,
  )

  if (!authRequired) {
    return {
      authRequired: false,
      user: null,
    }
  }

  const { auth } = await import('#/lib/auth')
  const session = await auth.api.getSession({ headers })

  return {
    authRequired: true,
    user: session?.user
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
        }
      : null,
  }
}
