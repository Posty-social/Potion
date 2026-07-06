export type WorkspaceAccess = {
  authRequired: boolean
  user: {
    id: string
    email: string
    name?: string | null
  } | null
}

export function isWorkspaceAuthRequired(value?: string) {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')
}
