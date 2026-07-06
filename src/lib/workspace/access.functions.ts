import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'

import type { WorkspaceAccess } from './access'
import { resolveWorkspaceAccess } from './access.server'

export const getWorkspaceAccess = createServerFn({ method: 'GET' }).handler(
  async (): Promise<WorkspaceAccess> =>
    resolveWorkspaceAccess(getRequestHeaders()),
)
