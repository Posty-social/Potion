import { createFileRoute } from '@tanstack/react-router'

import { mcpToolDefinitions, resolveMcpHttpRequest } from '#/lib/mcp/tools'
import { resolveWorkspaceAccess } from '#/lib/workspace/access.server'

export const Route = createFileRoute('/mcp')({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          name: 'Potion MCP',
          status: 'ready',
          transport: 'streamable-http',
          tools: mcpToolDefinitions,
        }),
      POST: async ({ request }) => {
        const access = await resolveWorkspaceAccess(request.headers)
        const body = await request.json().catch(() => null)
        const result = await resolveMcpHttpRequest(body, { access })

        return Response.json(result.body, { status: result.status })
      },
    },
  },
})
