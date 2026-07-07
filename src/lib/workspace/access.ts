export type WorkspaceUserContext = {
  id: string
  email: string
  name?: string | null
}

export type WorkspaceAccess = {
  user: WorkspaceUserContext | null
  organizationId: string | null
}

export class WorkspaceAccessError extends Error {
  constructor(
    readonly code: 'unauthenticated' | 'forbidden',
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceAccessError'
  }
}

export function hasWorkspaceAccess(
  access: WorkspaceAccess,
): access is WorkspaceAccess & {
  user: WorkspaceUserContext
  organizationId: string
} {
  return access.user !== null && access.organizationId !== null
}

export function requireWorkspaceAccess(access: WorkspaceAccess): {
  user: WorkspaceUserContext
  organizationId: string
} {
  if (!hasWorkspaceAccess(access)) {
    throw new WorkspaceAccessError(
      'unauthenticated',
      'Sign in to access this workspace.',
    )
  }

  return { user: access.user, organizationId: access.organizationId }
}
