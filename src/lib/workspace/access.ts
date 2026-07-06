export type WorkspaceAccess = {
  authRequired: boolean
  user: {
    id: string
    email: string
    name?: string | null
  } | null
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

export function isWorkspaceAuthRequired(value?: string) {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')
}

export function hasWorkspaceAccess(access: WorkspaceAccess) {
  return !access.authRequired || access.user !== null
}

export function requireWorkspaceAccess(access: WorkspaceAccess) {
  if (!hasWorkspaceAccess(access)) {
    throw new WorkspaceAccessError(
      'unauthenticated',
      'Sign in to access this workspace.',
    )
  }
}
